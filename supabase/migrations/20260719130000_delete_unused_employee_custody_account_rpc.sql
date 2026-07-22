begin;

create or replace function public.delete_unused_employee_custody_account(
  p_tenant_id uuid,
  p_account_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.account_accounts%rowtype;
  v_account public.account_accounts%rowtype;
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

  select parent_account.*
  into v_parent
  from public.account_accounts parent_account
  where parent_account.tenant_id = p_tenant_id
    and (
      parent_account.name = 'نقدية لدى الموظفين'
      or parent_account.code::text = '111003'
    )
  order by
    (parent_account.code::text = '111003') desc,
    (parent_account.name = 'نقدية لدى الموظفين') desc,
    parent_account.active desc,
    parent_account.id
  limit 1;

  select account.*
  into v_account
  from public.account_accounts account
  where account.id = p_account_id
    and account.tenant_id = p_tenant_id
  for update;

  if v_account.id is null
    or v_account.responsible_user_id is null
    or v_parent.group_id is null
    or v_account.group_id is distinct from v_parent.group_id then
    raise exception 'حساب العهدة المحدد غير موجود.';
  end if;

  if exists (
    select 1
    from public.account_move_lines line
    where line.tenant_id = p_tenant_id
      and line.account_id = p_account_id
  ) then
    raise exception 'لا يمكن حذف حساب العهدة لوجود قيود محاسبية عليه.';
  end if;

  begin
    delete from public.account_accounts account
    where account.id = p_account_id
      and account.tenant_id = p_tenant_id;
  exception
    when foreign_key_violation then
      raise exception 'لا يمكن حذف حساب العهدة لارتباطه ببيانات محاسبية.';
  end;

  return jsonb_build_object(
    'id', v_account.id,
    'deleted', true
  );
end;
$$;

revoke all on function public.delete_unused_employee_custody_account(uuid, uuid) from public;
grant execute on function public.delete_unused_employee_custody_account(uuid, uuid) to authenticated;

comment on function public.delete_unused_employee_custody_account(uuid, uuid) is
'Deletes an employee custody account only when no account move lines reference it.';

commit;
