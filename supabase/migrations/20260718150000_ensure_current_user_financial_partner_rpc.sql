begin;

create or replace function public.ensure_current_user_financial_partner(
  p_tenant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users%rowtype;
  v_partner public.partners%rowtype;
  v_account public.account_accounts%rowtype;
  v_employee_cash_group_id uuid;
  v_account_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;

  select tenant_user.*
  into v_user
  from public.tenant_users tenant_user
  where tenant_user.auth_user_id = auth.uid()
    and tenant_user.tenant_id = p_tenant_id
    and tenant_user.is_active = true
  order by tenant_user.created_at
  limit 1
  for update;

  if v_user.id is null then
    raise exception 'تعذر تحديد مستخدم الشركة الحالي.';
  end if;

  select account.group_id
  into v_employee_cash_group_id
  from public.account_accounts account
  where account.tenant_id = p_tenant_id
    and (account.code::text = '111003' or account.name = 'نقدية لدى الموظفين')
  order by (account.code::text = '111003') desc, account.active desc, account.id
  limit 1;

  if v_employee_cash_group_id is null then
    raise exception 'حساب نقدية لدى الموظفين غير موجود في شجرة الحسابات.';
  end if;

  select count(*)
  into v_account_count
  from public.account_accounts account
  where account.tenant_id = p_tenant_id
    and account.group_id = v_employee_cash_group_id
    and account.responsible_user_id = v_user.id
    and account.active = true;

  if v_account_count = 0 then
    raise exception 'لا يوجد حساب عهدة نشط للموظف الحالي.';
  end if;

  if v_account_count > 1 then
    raise exception 'يوجد أكثر من حساب عهدة نشط للموظف الحالي.';
  end if;

  select account.*
  into v_account
  from public.account_accounts account
  where account.tenant_id = p_tenant_id
    and account.group_id = v_employee_cash_group_id
    and account.responsible_user_id = v_user.id
    and account.active = true
  limit 1;

  if v_user.partner_id is null then
    insert into public.partners (
      tenant_id,
      name,
      phone1,
      mobile,
      email,
      contact_type,
      is_company,
      is_external_contact,
      customer_rank,
      supplier_rank,
      financer_rank,
      active
    ) values (
      v_user.tenant_id,
      coalesce(nullif(btrim(v_user.full_name), ''), 'مستخدم داخلي'),
      nullif(btrim(v_user.phone), ''),
      nullif(btrim(v_user.phone), ''),
      nullif(btrim(v_user.email), ''),
      'person',
      false,
      false,
      0,
      0,
      0,
      true
    )
    returning * into v_partner;

    update public.tenant_users tenant_user
    set partner_id = v_partner.id,
        updated_at = now()
    where tenant_user.id = v_user.id;
  else
    select partner.*
    into v_partner
    from public.partners partner
    where partner.id = v_user.partner_id
      and partner.tenant_id = v_user.tenant_id
      and partner.active = true;

    if v_partner.id is null then
      raise exception 'الملف المالي للمستخدم الحالي غير موجود أو غير نشط.';
    end if;
  end if;

  return jsonb_build_object(
    'account_id', v_account.id,
    'account_code', v_account.code,
    'account_name', v_account.name,
    'tenant_user_id', v_user.id,
    'employee_name', v_user.full_name,
    'partner_id', v_partner.id,
    'partner_name', v_partner.name
  );
end;
$$;

revoke all on function public.ensure_current_user_financial_partner(uuid) from public;
grant execute on function public.ensure_current_user_financial_partner(uuid) to authenticated;

comment on function public.ensure_current_user_financial_partner(uuid) is
'Returns the employee cash destination and atomically provisions the current tenant user internal partner when missing.';

commit;
