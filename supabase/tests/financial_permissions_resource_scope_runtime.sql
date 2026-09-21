begin;

create temporary table financial_auth_test_context as
select
  owner_user.id owner_user_id,
  owner_user.auth_user_id owner_auth_user_id,
  member_user.id member_user_id,
  member_user.auth_user_id member_auth_user_id,
  owner_user.tenant_id,
  branch_a.id branch_a,
  branch_b.id branch_b,
  other_tenant.id other_tenant_id
from public.tenant_users owner_user
join lateral (
  select candidate.*
  from public.tenant_users candidate
  where candidate.tenant_id = owner_user.tenant_id
    and candidate.role <> 'owner'
    and candidate.is_active
    and candidate.auth_user_id is not null
    and not exists (
      select 1 from public.account_accounts account
      where account.tenant_id = candidate.tenant_id
        and account.responsible_user_id = candidate.id
        and account.active
    )
  order by candidate.id
  limit 1
) member_user on true
join lateral (
  select branch.* from public.branches branch
  where branch.tenant_id = owner_user.tenant_id and branch.is_active
  order by branch.id limit 1
) branch_a on true
join lateral (
  select branch.* from public.branches branch
  where branch.tenant_id = owner_user.tenant_id
    and branch.is_active and branch.id <> branch_a.id
  order by branch.id limit 1
) branch_b on true
join lateral (
  select tenant.id from public.tenants tenant
  where tenant.id <> owner_user.tenant_id order by tenant.id limit 1
) other_tenant on true
where owner_user.role = 'owner'
  and owner_user.is_active
  and owner_user.auth_user_id is not null
limit 1;

do $$
begin
  if not exists (select 1 from financial_auth_test_context) then
    raise exception 'FINANCIAL_AUTH_TEST_FIXTURE_UNAVAILABLE';
  end if;
end
$$;

create temporary table financial_auth_test_resources (
  account_a uuid,
  account_b uuid,
  custody_account uuid,
  permission_group uuid
);

do $$
declare
  context financial_auth_test_context%rowtype;
  resources financial_auth_test_resources%rowtype;
  suffix text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into context from financial_auth_test_context;

  insert into public.account_accounts(tenant_id, code, name, account_type, reconcile, active)
  values(context.tenant_id, 'FBA' || left(suffix, 7), 'Financial Bank A ' || suffix, 'asset', false, true)
  returning id into resources.account_a;
  insert into public.account_accounts(tenant_id, code, name, account_type, reconcile, active)
  values(context.tenant_id, 'FBB' || left(suffix, 7), 'Financial Bank B ' || suffix, 'asset', false, true)
  returning id into resources.account_b;
  insert into public.account_accounts(
    tenant_id, code, name, account_type, reconcile, active, responsible_user_id
  ) values(
    context.tenant_id, 'FCU' || left(suffix, 7), 'Financial Custody ' || suffix,
    'asset', false, true, context.member_user_id
  ) returning id into resources.custody_account;

  insert into public.res_groups(tenant_id, name, code, category, is_system, active)
  values(context.tenant_id, 'Financial auth test', 'financial_auth_' || left(suffix, 12), 'Tenant', false, true)
  returning id into resources.permission_group;

  insert into public.res_users_groups(tenant_id, user_id, group_id)
  values(context.tenant_id, context.member_user_id, resources.permission_group);

  insert into public.auth_group_permissions(group_id, permission_id)
  select resources.permission_group, permission.id
  from public.auth_permissions permission
  where permission.code in ('financial.payment.confirm', 'financial.payment.create');

  insert into public.user_branch_access(tenant_id, user_id, branch_id)
  values(context.tenant_id, context.member_user_id, context.branch_a);

  insert into public.user_financial_account_access(
    tenant_id, user_id, account_id, branch_id, access_type, created_by
  ) values
    (context.tenant_id, context.member_user_id, resources.account_a, context.branch_a, 'confirm', context.owner_user_id),
    (context.tenant_id, context.member_user_id, resources.account_a, context.branch_a, 'view', context.owner_user_id),
    (context.tenant_id, context.member_user_id, resources.account_a, context.branch_a, 'pay_out', context.owner_user_id);

  insert into financial_auth_test_resources values(resources.*);
end
$$;

grant select on financial_auth_test_context, financial_auth_test_resources to authenticated;

select set_config('request.jwt.claim.sub', member_auth_user_id::text, true)
from financial_auth_test_context;
set local role authenticated;

do $$
declare
  context financial_auth_test_context%rowtype;
  resources financial_auth_test_resources%rowtype;
  blocked boolean := false;
begin
  select * into context from financial_auth_test_context;
  select * into resources from financial_auth_test_resources;

  if not public.can_perform_financial_action(
    context.tenant_id, 'financial.payment.confirm', resources.account_a,
    'confirm', context.branch_a, true
  ) then raise exception 'ACTION_AND_RESOURCE_WERE_DENIED'; end if;

  if public.can_perform_financial_action(
    context.tenant_id, 'financial.payment.confirm', resources.account_b,
    'confirm', context.branch_a, true
  ) then raise exception 'ACTION_WITHOUT_RESOURCE_WAS_ALLOWED'; end if;

  if public.can_perform_financial_action(
    context.tenant_id, 'financial.payment.refund', resources.account_a,
    'pay_out', context.branch_a, true
  ) then raise exception 'RESOURCE_WITHOUT_ACTION_WAS_ALLOWED'; end if;

  if public.can_perform_financial_action(
    context.tenant_id, 'financial.payment.confirm', resources.account_a,
    'confirm', context.branch_b, true
  ) then raise exception 'OUT_OF_SCOPE_BRANCH_WAS_ALLOWED'; end if;

  if public.can_perform_financial_action(
    context.tenant_id, 'financial.payment.confirm', resources.account_a,
    'confirm', context.branch_a, false
  ) then raise exception 'INVALID_STATE_TRANSITION_WAS_ALLOWED'; end if;

  if not public.can_perform_financial_action(
    context.tenant_id, 'financial.payment.create', resources.custody_account,
    'initiate', context.branch_a, true
  ) then raise exception 'OWN_CUSTODY_INITIATE_WAS_DENIED'; end if;

  if public.has_financial_resource_access(
    context.tenant_id, resources.custody_account, 'confirm', context.branch_a
  ) or public.has_financial_resource_access(
    context.tenant_id, resources.custody_account, 'pay_out', context.branch_a
  ) or public.has_financial_resource_access(
    context.tenant_id, resources.custody_account, 'transfer_from', context.branch_a
  ) then raise exception 'OWN_CUSTODY_RECEIVED_PRIVILEGED_ACCESS'; end if;

  begin
    insert into public.user_financial_account_access(
      tenant_id, user_id, account_id, branch_id, access_type
    ) values(
      context.tenant_id, context.member_user_id, resources.account_b,
      context.branch_a, 'confirm'
    );
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'MEMBER_GRANTED_OWN_FINANCIAL_SCOPE'; end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', owner_auth_user_id::text, true)
from financial_auth_test_context;
set local role authenticated;

do $$
declare
  context financial_auth_test_context%rowtype;
  resources financial_auth_test_resources%rowtype;
begin
  select * into context from financial_auth_test_context;
  select * into resources from financial_auth_test_resources;

  if not public.can_perform_financial_action(
    context.tenant_id, 'financial.payment.refund', resources.account_b,
    'pay_out', context.branch_b, true
  ) then raise exception 'OWNER_OVERRIDE_FAILED'; end if;

  if public.can_perform_financial_action(
    context.other_tenant_id, 'financial.payment.refund', resources.account_b,
    'pay_out', context.branch_b, true
  ) then raise exception 'OWNER_OVERRIDE_CROSSED_TENANT'; end if;
end
$$;

rollback;
