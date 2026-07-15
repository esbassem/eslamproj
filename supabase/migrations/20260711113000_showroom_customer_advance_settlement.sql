begin;

create or replace function public.get_showroom_customer_advance_balances(
  p_tenant_id uuid,
  p_customer_id uuid
)
returns table (
  payment_entity_id uuid,
  payment_entity_name text,
  display_config jsonb,
  available_amount numeric
)
language sql
security definer
set search_path = public
as $$
  with entity_account as (
    select id
    from public.account_accounts
    where tenant_id = p_tenant_id
      and active = true
      and (code = '114002' or name = 'ذمم الشركات والجهات')
    order by case when code = '114002' then 0 else 1 end
    limit 1
  )
  select
    aml.partner_id,
    p.name,
    p.display_config,
    round(sum(aml.debit - aml.credit), 2) as available_amount
  from public.account_move_lines aml
  join public.account_moves am on am.id = aml.move_id
  join public.partners p on p.id = aml.partner_id and p.tenant_id = p_tenant_id
  where aml.tenant_id = p_tenant_id
    and am.tenant_id = p_tenant_id
    and am.partner_id = p_customer_id
    and am.state = 'posted'
    and aml.account_id = (select id from entity_account)
    and (
      aml.label like 'اعتماد دفعة من جهة%'
      or aml.label like 'استخدام دفعة مسبقة%'
    )
  group by aml.partner_id, p.name, p.display_config
  having round(sum(aml.debit - aml.credit), 2) > 0
  order by p.name;
$$;

grant execute on function public.get_showroom_customer_advance_balances(uuid, uuid) to authenticated;

create or replace function public.settle_showroom_sale_payments(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant_id uuid := nullif(payload ->> 'tenant_id', '')::uuid;
  v_sale_id uuid := nullif(payload ->> 'sale_id', '')::uuid;
  v_customer_id uuid := nullif(payload ->> 'customer_id', '')::uuid;
  v_created_by uuid := nullif(payload ->> 'created_by', '')::uuid;
  v_cash numeric := greatest(coalesce(nullif(payload ->> 'cash_amount', '')::numeric, 0), 0);
  v_allocations jsonb := coalesce(payload -> 'advance_allocations', '[]'::jsonb);
  v_total numeric;
  v_paid numeric;
  v_entity_account uuid;
  v_advance_account uuid;
  v_item jsonb;
  v_entity_id uuid;
  v_amount numeric;
  v_note text;
  v_available numeric;
  v_move_id uuid;
  v_payment_id uuid;
begin
  if v_tenant_id is null or v_sale_id is null or v_customer_id is null then
    raise exception 'بيانات تسوية الفاتورة غير مكتملة.';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_tenant_id::text || ':' || v_customer_id::text));

  select total_amount into v_total
  from public.showroom_sales
  where id = v_sale_id and tenant_id = v_tenant_id and customer_id = v_customer_id
  for update;

  if not found then raise exception 'فاتورة البيع غير موجودة.'; end if;

  select id into v_entity_account from public.account_accounts
  where tenant_id = v_tenant_id and active = true and (code = '114002' or name = 'ذمم الشركات والجهات')
  order by case when code = '114002' then 0 else 1 end limit 1;
  select id into v_advance_account from public.account_accounts
  where tenant_id = v_tenant_id and active = true and (code = '212001' or name = 'الدفعات المقدمة من العملاء')
  order by case when code = '212001' then 0 else 1 end limit 1;

  if v_entity_account is null or v_advance_account is null then
    raise exception 'حسابات الدفعات المسبقة غير مكتملة.';
  end if;

  v_paid := v_cash;
  for v_item in select value from jsonb_array_elements(v_allocations)
  loop
    v_entity_id := nullif(v_item ->> 'payment_entity_id', '')::uuid;
    v_amount := round(coalesce(nullif(v_item ->> 'amount', '')::numeric, 0), 2);
    v_note := nullif(trim(coalesce(v_item ->> 'note', '')), '');
    if v_entity_id is null or v_amount <= 0 then continue; end if;

    select coalesce(sum(aml.debit - aml.credit), 0) into v_available
    from public.account_move_lines aml
    join public.account_moves am on am.id = aml.move_id
    where aml.tenant_id = v_tenant_id and am.tenant_id = v_tenant_id
      and am.partner_id = v_customer_id and am.state = 'posted'
      and aml.account_id = v_entity_account and aml.partner_id = v_entity_id
      and (aml.label like 'اعتماد دفعة من جهة%' or aml.label like 'استخدام دفعة مسبقة%');

    if v_amount > round(v_available, 2) then
      raise exception 'الرصيد المتاح لدى الجهة لا يكفي لهذه التسوية.';
    end if;

    v_move_id := gen_random_uuid();
    insert into public.account_moves (id, tenant_id, name, move_type, state, partner_id, amount_total, ref, date, created_by)
    values (v_move_id, v_tenant_id, 'SHOWROOM-ADV-' || upper(substr(replace(v_move_id::text, '-', ''), 1, 10)), 'payment', 'posted', v_customer_id, v_amount, 'showroom_sale:' || v_sale_id, now(), v_created_by);

    insert into public.account_move_lines (tenant_id, move_id, account_id, partner_id, label, quantity, unit_price, debit, credit, created_by)
    values
      (v_tenant_id, v_move_id, v_advance_account, v_customer_id, 'استخدام دفعة مسبقة - العميل', 1, 0, v_amount, 0, v_created_by),
      (v_tenant_id, v_move_id, v_entity_account, v_entity_id, 'استخدام دفعة مسبقة - جهة الدفع', 1, 0, 0, v_amount, v_created_by);

    insert into public.showroom_sale_payments (tenant_id, sale_id, amount, payment_date, payment_method, payment_type, financier_partner_id, notes, created_by, account_move_id)
    values (v_tenant_id, v_sale_id, v_amount, current_date, 'advance_credit', 'advance_credit', v_entity_id, coalesce(v_note, 'خصم من دفعة مسبقة للعميل'), v_created_by, v_move_id)
    returning id into v_payment_id;
    v_paid := v_paid + v_amount;
  end loop;

  if v_paid > v_total then raise exception 'إجمالي الدفع أكبر من قيمة الفاتورة.'; end if;

  if v_cash > 0 then
    insert into public.showroom_sale_payments (tenant_id, sale_id, amount, payment_date, payment_method, payment_type, notes, created_by)
    values (v_tenant_id, v_sale_id, v_cash, current_date, 'cash', 'cash', nullif(payload ->> 'cash_notes', ''), v_created_by);
  end if;

  update public.showroom_sales
  set paid_amount = v_paid, remaining_amount = greatest(v_total - v_paid, 0), updated_at = now()
  where id = v_sale_id;

  return jsonb_build_object('paid_amount', v_paid, 'remaining_amount', greatest(v_total - v_paid, 0));
end;
$$;

grant execute on function public.settle_showroom_sale_payments(jsonb) to authenticated;

commit;
