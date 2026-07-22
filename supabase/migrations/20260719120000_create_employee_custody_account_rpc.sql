begin;

create or replace function public.create_employee_custody_account(
  p_tenant_id uuid,
  p_responsible_user_id uuid,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.account_accounts%rowtype;
  v_employee public.tenant_users%rowtype;
  v_account public.account_accounts%rowtype;
  v_name text := nullif(btrim(p_name), '');
  v_code text;
  v_max_code numeric;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;

  if not exists (
    select 1
    from public.tenant_users current_user_record
    where current_user_record.tenant_id = p_tenant_id
      and current_user_record.auth_user_id = auth.uid()
      and current_user_record.is_active = true
  ) then
    raise exception 'لا يمكنك إدارة حسابات هذه المؤسسة.';
  end if;

  if v_name is null then
    raise exception 'اكتب اسم حساب العهدة.';
  end if;

  select employee.*
  into v_employee
  from public.tenant_users employee
  where employee.id = p_responsible_user_id
    and employee.tenant_id = p_tenant_id;

  if v_employee.id is null then
    raise exception 'الموظف المحدد غير موجود داخل المؤسسة.';
  end if;

  select account.*
  into v_parent
  from public.account_accounts account
  where account.tenant_id = p_tenant_id
    and (
      account.name = 'نقدية لدى الموظفين'
      or account.code::text = '111003'
    )
  order by
    (account.code::text = '111003') desc,
    (account.name = 'نقدية لدى الموظفين') desc,
    account.active desc,
    account.id
  limit 1
  for update;

  if v_parent.id is null then
    raise exception 'حساب نقدية لدى الموظفين غير موجود في شجرة الحسابات.';
  end if;

  if v_parent.group_id is null then
    raise exception 'حساب نقدية لدى الموظفين غير مرتبط بمجموعة حسابات.';
  end if;

  if exists (
    select 1
    from public.account_accounts account
    where account.tenant_id = p_tenant_id
      and account.responsible_user_id = p_responsible_user_id
      and account.active = true
  ) then
    raise exception 'هذا الموظف لديه حساب عهدة نشط بالفعل.';
  end if;

  if exists (
    select 1
    from public.account_accounts account
    where account.tenant_id = p_tenant_id
      and lower(btrim(account.name)) = lower(v_name)
  ) then
    raise exception 'يوجد حساب بنفس الاسم داخل المؤسسة.';
  end if;

  select max(account.code::text::numeric)
  into v_max_code
  from public.account_accounts account
  where account.tenant_id = p_tenant_id
    and account.group_id = v_parent.group_id
    and account.code::text ~ '^[0-9]+$';

  if v_max_code is null then
    raise exception 'لا يوجد كود رقمي داخل مجموعة حساب نقدية لدى الموظفين.';
  end if;

  v_code := trunc(v_max_code + 1)::text;

  while exists (
      select 1
      from public.account_accounts account
      where account.tenant_id = p_tenant_id
        and account.code::text = v_code
  ) loop
    v_code := trunc(v_code::numeric + 1)::text;
  end loop;

  insert into public.account_accounts (
    tenant_id,
    group_id,
    code,
    name,
    account_type,
    reconcile,
    responsible_user_id,
    active
  ) values (
    p_tenant_id,
    v_parent.group_id,
    v_code,
    v_name,
    'asset',
    false,
    p_responsible_user_id,
    true
  )
  returning * into v_account;

  return jsonb_build_object(
    'id', v_account.id,
    'tenant_id', v_account.tenant_id,
    'group_id', v_account.group_id,
    'code', v_account.code,
    'name', v_account.name,
    'responsible_user_id', v_account.responsible_user_id,
    'active', v_account.active
  );
end;
$$;

revoke all on function public.create_employee_custody_account(uuid, uuid, text) from public;
grant execute on function public.create_employee_custody_account(uuid, uuid, text) to authenticated;

comment on function public.create_employee_custody_account(uuid, uuid, text) is
'Creates one active employee custody account in the نقدية لدى الموظفين group with an atomic numeric code.';

commit;
