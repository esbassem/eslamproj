begin;

create or replace function public.settle_showroom_sale_with_advance_credit(
  p_sale_id uuid,
  p_payment_entity_id uuid,
  p_amount numeric,
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
  v_entity_account_id uuid;
  v_advance_account_id uuid;
  v_invoice_line_id uuid;
  v_payment_move_id uuid := gen_random_uuid();
  v_payment_receivable_line_id uuid := gen_random_uuid();
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_paid numeric := 0;
  v_remaining numeric := 0;
  v_available numeric := 0;
  v_invoice_total numeric := 0;
  v_branch_id uuid;
  v_entity_name text;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولاً.'; end if;
  if p_payment_entity_id is null then raise exception 'اختر جهة الدفع.'; end if;
  if v_amount <= 0 then raise exception 'مبلغ التسوية يجب أن يكون أكبر من صفر.'; end if;

  select * into v_sale from public.showroom_sales where id = p_sale_id for update;
  if v_sale.id is null then raise exception 'فاتورة الشو روم غير موجودة.'; end if;
  if v_sale.status <> 'confirmed' then raise exception 'لا يمكن تسوية فاتورة غير مؤكدة.'; end if;
  if v_sale.customer_id is null then raise exception 'الفاتورة غير مرتبطة بعميل.'; end if;

  select tu.* into v_user
  from public.tenant_users tu
  where tu.auth_user_id = auth.uid()
    and tu.tenant_id = v_sale.tenant_id
    and coalesce(tu.is_active, true) = true
  order by tu.created_at
  limit 1;
  if v_user.id is null then raise exception 'لا تملك صلاحية تسوية هذه الفاتورة.'; end if;

  select p.name into v_entity_name
  from public.partners p
  where p.id = p_payment_entity_id
    and p.tenant_id = v_sale.tenant_id
    and p.active = true;
  if v_entity_name is null then raise exception 'جهة الدفع غير موجودة أو غير نشطة.'; end if;

  select am.id into v_sale_move_id
  from public.account_moves am
  where am.tenant_id = v_sale.tenant_id
    and am.move_type = 'sale'
    and am.state = 'posted'
    and (am.id = v_sale.account_move_id or am.ref = 'showroom_sale:' || v_sale.id)
  order by case when am.id = v_sale.account_move_id then 0 else 1 end, am.created_at
  limit 1;
  if v_sale_move_id is null then raise exception 'لا يوجد قيد بيع مرحل مرتبط بالفاتورة.'; end if;

  select id into v_receivable_account_id from public.account_accounts
  where tenant_id = v_sale.tenant_id and code = '114001' and active = true limit 1;
  select id into v_entity_account_id from public.account_accounts
  where tenant_id = v_sale.tenant_id and code = '114002' and active = true limit 1;
  select id into v_advance_account_id from public.account_accounts
  where tenant_id = v_sale.tenant_id and code = '212001' and active = true limit 1;
  if v_receivable_account_id is null then raise exception 'حساب ذمم العملاء 114001 غير موجود.'; end if;
  if v_entity_account_id is null then raise exception 'حساب ذمم الجهات 114002 غير موجود.'; end if;
  if v_advance_account_id is null then raise exception 'حساب الدفعات المقدمة 212001 غير موجود.'; end if;

  select aml.id, aml.debit into v_invoice_line_id, v_invoice_total
  from public.account_move_lines aml
  where aml.tenant_id = v_sale.tenant_id
    and aml.move_id = v_sale_move_id
    and aml.account_id = v_receivable_account_id
    and aml.debit > 0
  order by aml.debit desc
  limit 1
  for update;
  if v_invoice_line_id is null then raise exception 'قيد الفاتورة لا يحتوي على سطر ذمم مدين.'; end if;

  perform pg_advisory_xact_lock(hashtext(v_sale.tenant_id::text || ':' || v_sale.customer_id::text));

  select round(coalesce(sum(apr.amount), 0), 2) into v_paid
  from public.account_partial_reconcile apr
  where apr.tenant_id = v_sale.tenant_id and apr.debit_move_id = v_invoice_line_id;
  v_remaining := round(greatest(v_invoice_total - v_paid, 0), 2);
  if v_remaining <= 0 then raise exception 'الفاتورة مسددة بالكامل محاسبيًا.'; end if;
  if v_amount > v_remaining then raise exception 'المبلغ أكبر من المتبقي على الفاتورة %.', v_remaining; end if;

  select round(
    coalesce((
      select sum(aml.debit - aml.credit)
      from public.account_move_lines aml
      join public.account_moves am on am.id = aml.move_id
      where aml.tenant_id = v_sale.tenant_id
        and aml.account_id = v_entity_account_id
        and aml.partner_id = p_payment_entity_id
        and am.partner_id = v_sale.customer_id
        and am.state = 'posted'
    ), 0)
    - coalesce((
      select sum(aml.debit)
      from public.account_move_lines aml
      join public.account_moves am on am.id = aml.move_id
      where aml.tenant_id = v_sale.tenant_id
        and aml.account_id = v_advance_account_id
        and aml.partner_id = v_sale.customer_id
        and am.partner_id = p_payment_entity_id
        and am.pay_method = 'advance_credit'
        and am.state = 'posted'
    ), 0),
    2
  ) into v_available;
  if v_amount > v_available then
    raise exception 'رصيد العميل لدى الجهة % غير كافٍ. المتاح % والمطلوب %.', v_entity_name, v_available, v_amount;
  end if;

  select coalesce(v_sale.branch_id, sc.branch_id) into v_branch_id
  from public.showroom_configs sc
  where sc.id = v_sale.showroom_config_id and sc.tenant_id = v_sale.tenant_id;

  insert into public.account_moves (
    id, tenant_id, branch_id, name, move_type, partner_id, invoice_date, date,
    amount_total, state, ref, notes, pay_method, currency_code, created_by
  ) values (
    v_payment_move_id, v_sale.tenant_id, v_branch_id,
    'SHOWROOM-ADV-' || upper(substr(replace(v_payment_move_id::text, '-', ''), 1, 12)),
    'payment', p_payment_entity_id, current_date, now(), v_amount, 'posted',
    'showroom_sale:' || v_sale.id, nullif(trim(coalesce(p_notes, '')), ''),
    'advance_credit', 'EGP', v_user.id
  );

  insert into public.account_move_lines (
    id, tenant_id, move_id, account_id, partner_id, label, quantity, unit_price,
    debit, credit, line_type, is_reconciled, amount_residual,
    amount_residual_currency, parent_state, currency_code, created_by
  ) values
    (gen_random_uuid(), v_sale.tenant_id, v_payment_move_id, v_advance_account_id,
     v_sale.customer_id, 'استخدام دفعة مقدمة للعميل', 1, v_amount, v_amount, 0,
     'payable', true, 0, 0, 'posted', 'EGP', v_user.id),
    (v_payment_receivable_line_id, v_sale.tenant_id, v_payment_move_id, v_receivable_account_id,
     v_sale.customer_id, 'تسوية رصيد مسبق مع فاتورة العميل', 1, v_amount, 0, v_amount,
     'receivable', true, 0, 0, 'posted', 'EGP', v_user.id);

  insert into public.account_partial_reconcile (
    tenant_id, debit_move_id, credit_move_id, amount, max_date, created_by
  ) values (
    v_sale.tenant_id, v_invoice_line_id, v_payment_receivable_line_id,
    v_amount, current_date, v_user.id
  );

  v_paid := round(v_paid + v_amount, 2);
  v_remaining := round(greatest(v_invoice_total - v_paid, 0), 2);

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
    'payment_move_id', v_payment_move_id,
    'payment_entity_id', p_payment_entity_id,
    'payment_entity_name', v_entity_name,
    'amount', v_amount,
    'paid_amount', v_paid,
    'remaining_amount', v_remaining
  );
end;
$$;

grant execute on function public.settle_showroom_sale_with_advance_credit(uuid, uuid, numeric, text) to authenticated;

notify pgrst, 'reload schema';

commit;
