begin;

create or replace function public.settle_showroom_sale_balance(
  p_sale_id uuid,
  p_amount numeric,
  p_mode text,
  p_destination_account_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.tenant_users%rowtype;
  v_sale public.showroom_sales%rowtype;
  v_sale_move_id uuid;
  v_receivable_account_id uuid;
  v_destination_account public.account_accounts%rowtype;
  v_invoice_line_id uuid;
  v_settlement_move_id uuid := gen_random_uuid();
  v_settlement_receivable_line_id uuid := gen_random_uuid();
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_paid numeric := 0;
  v_remaining numeric := 0;
  v_branch_id uuid;
  v_mode text := lower(trim(coalesce(p_mode, '')));
  v_move_type text;
  v_pay_method text;
  v_destination_label text;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولاً.'; end if;
  if v_mode not in ('cash', 'account') then raise exception 'اختر نوع تسوية صحيح.'; end if;
  if v_amount <= 0 then raise exception 'مبلغ التسوية يجب أن يكون أكبر من صفر.'; end if;

  select * into v_sale from public.showroom_sales where id = p_sale_id for update;
  if v_sale.id is null then raise exception 'فاتورة الشوروم غير موجودة.'; end if;
  if v_sale.status <> 'confirmed' then raise exception 'لا يمكن تسوية فاتورة غير مؤكدة.'; end if;

  select tu.* into v_user
  from public.tenant_users tu
  where tu.auth_user_id = auth.uid()
    and tu.tenant_id = v_sale.tenant_id
    and coalesce(tu.is_active, true) = true
  order by tu.created_at
  limit 1;
  if v_user.id is null then raise exception 'لا تملك صلاحية تسوية هذه الفاتورة.'; end if;

  select am.id into v_sale_move_id
  from public.account_moves am
  where am.tenant_id = v_sale.tenant_id
    and am.move_type = 'sale'
    and am.state = 'posted'
    and (am.id = v_sale.account_move_id or am.ref = 'showroom_sale:' || v_sale.id)
  order by case when am.id = v_sale.account_move_id then 0 else 1 end, am.created_at
  limit 1;
  if v_sale_move_id is null then raise exception 'لا يوجد قيد بيع مرحل مرتبط بالفاتورة.'; end if;

  select aa.id into v_receivable_account_id
  from public.account_accounts aa
  where aa.tenant_id = v_sale.tenant_id and aa.code = '114001' and aa.active = true
  limit 1;
  if v_receivable_account_id is null then raise exception 'حساب ذمم العملاء 114001 غير موجود.'; end if;

  if v_mode = 'cash' then
    select * into v_destination_account
    from public.account_accounts aa
    where aa.tenant_id = v_sale.tenant_id and aa.code = '111001' and aa.active = true
    limit 1;
    v_move_type := 'payment';
    v_pay_method := 'cash';
    v_destination_label := 'تحصيل نقدي لفاتورة شو روم';
  else
    if p_destination_account_id is null then raise exception 'اختر حساب التسوية.'; end if;
    select * into v_destination_account
    from public.account_accounts aa
    where aa.id = p_destination_account_id
      and aa.tenant_id = v_sale.tenant_id
      and aa.active = true;
    v_move_type := 'journal';
    v_pay_method := 'account_settlement';
    v_destination_label := 'تسوية مديونية فاتورة على حساب ' || coalesce(v_destination_account.name, 'آخر');
  end if;

  if v_destination_account.id is null then raise exception 'حساب التسوية غير موجود أو غير نشط.'; end if;
  if v_destination_account.id = v_receivable_account_id then raise exception 'لا يمكن التسوية على حساب ذمم العملاء نفسه.'; end if;

  select aml.id into v_invoice_line_id
  from public.account_move_lines aml
  where aml.tenant_id = v_sale.tenant_id
    and aml.move_id = v_sale_move_id
    and aml.account_id = v_receivable_account_id
    and aml.debit > 0
  order by aml.debit desc
  limit 1
  for update;
  if v_invoice_line_id is null then raise exception 'قيد الفاتورة لا يحتوي على سطر ذمم مدين.'; end if;

  select round(coalesce(sum(apr.amount), 0), 2) into v_paid
  from public.account_partial_reconcile apr
  where apr.tenant_id = v_sale.tenant_id and apr.debit_move_id = v_invoice_line_id;

  v_remaining := round(greatest(coalesce(v_sale.total_amount, 0) - v_paid, 0), 2);
  if v_remaining <= 0 then raise exception 'الفاتورة مسددة بالكامل محاسبيًا.'; end if;
  if v_amount > v_remaining then raise exception 'مبلغ التسوية أكبر من المتبقي المحاسبي %.', v_remaining; end if;

  select coalesce(v_sale.branch_id, sc.branch_id) into v_branch_id
  from public.showroom_configs sc
  where sc.id = v_sale.showroom_config_id and sc.tenant_id = v_sale.tenant_id;

  insert into public.account_moves (
    id, tenant_id, branch_id, name, move_type, partner_id, invoice_date, date,
    amount_total, state, ref, notes, pay_method, currency_code, created_by
  ) values (
    v_settlement_move_id, v_sale.tenant_id, v_branch_id,
    case when v_mode = 'cash' then 'SHOWROOM-CASH-' else 'SHOWROOM-SETTLE-' end
      || upper(substr(replace(v_settlement_move_id::text, '-', ''), 1, 12)),
    v_move_type, v_sale.customer_id, current_date, now(), v_amount, 'posted',
    'showroom_sale:' || v_sale.id, nullif(trim(coalesce(p_notes, '')), ''),
    v_pay_method, 'EGP', v_user.id
  );

  insert into public.account_move_lines (
    id, tenant_id, move_id, account_id, partner_id, label, quantity, unit_price,
    debit, credit, line_type, is_reconciled, amount_residual,
    amount_residual_currency, parent_state, currency_code, created_by
  ) values
    (gen_random_uuid(), v_sale.tenant_id, v_settlement_move_id, v_destination_account.id, null,
     v_destination_label, 1, v_amount, v_amount, 0,
     case when v_mode = 'cash' then 'liquidity' else 'other' end,
     true, 0, 0, 'posted', 'EGP', v_user.id),
    (v_settlement_receivable_line_id, v_sale.tenant_id, v_settlement_move_id,
     v_receivable_account_id, v_sale.customer_id, 'تسوية ذمم فاتورة شو روم',
     1, v_amount, 0, v_amount, 'receivable', true, 0, 0, 'posted', 'EGP', v_user.id);

  insert into public.account_partial_reconcile (
    tenant_id, debit_move_id, credit_move_id, amount, max_date, created_by
  ) values (
    v_sale.tenant_id, v_invoice_line_id, v_settlement_receivable_line_id,
    v_amount, current_date, v_user.id
  );

  v_paid := round(v_paid + v_amount, 2);
  v_remaining := round(greatest(v_sale.total_amount - v_paid, 0), 2);

  update public.account_move_lines
  set amount_residual = v_remaining,
      amount_residual_currency = v_remaining,
      is_reconciled = (v_remaining = 0)
  where id = v_invoice_line_id;

  update public.showroom_sales
  set account_move_id = v_sale_move_id,
      paid_amount = v_paid,
      remaining_amount = v_remaining,
      updated_at = now()
  where id = v_sale.id;

  return jsonb_build_object(
    'success', true,
    'sale_id', v_sale.id,
    'settlement_move_id', v_settlement_move_id,
    'mode', v_mode,
    'destination_account_id', v_destination_account.id,
    'destination_account_code', v_destination_account.code,
    'destination_account_name', v_destination_account.name,
    'amount', v_amount,
    'paid_amount', v_paid,
    'remaining_amount', v_remaining
  );
end;
$$;

grant execute on function public.settle_showroom_sale_balance(uuid, numeric, text, uuid, text) to authenticated;

commit;
