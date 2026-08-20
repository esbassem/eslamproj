begin;

do $$
begin
  if to_regclass('public.auth_permissions') is null
     or to_regclass('public.auth_group_permissions') is null then
    raise exception 'authorization core tables are missing';
  end if;
end
$$;

create temporary table authz_test_context as
select
  owner_user.id owner_tenant_user_id,
  owner_user.auth_user_id owner_auth_user_id,
  member_user.id member_tenant_user_id,
  member_user.auth_user_id member_auth_user_id,
  owner_user.tenant_id,
  other_tenant.id other_tenant_id
from public.tenant_users owner_user
join lateral (
  select candidate.*
  from public.tenant_users candidate
  where candidate.tenant_id = owner_user.tenant_id
    and candidate.role <> 'owner'
    and candidate.is_active
    and candidate.auth_user_id is not null
  limit 1
) member_user on true
join lateral (
  select tenant.id
  from public.tenants tenant
  where tenant.id <> owner_user.tenant_id
  limit 1
) other_tenant on true
where owner_user.role = 'owner'
  and owner_user.is_active
  and owner_user.auth_user_id is not null
limit 1;

do $$
begin
  if not exists (select 1 from authz_test_context) then
    raise exception 'test requires an active owner, non-owner in the same tenant, and a second tenant';
  end if;
end
$$;

grant select on authz_test_context to authenticated;

-- Set up one deterministic permission through existing groups. Rolled back below.
insert into public.res_groups (tenant_id, module_id, name, code, is_system, active)
select context.tenant_id, installed.module_id,
  'Authorization runtime test', 'authorization_runtime_test', false, true
from authz_test_context context
join lateral (
  select tenant_module.module_id
  from public.tenant_modules tenant_module
  where tenant_module.tenant_id = context.tenant_id
    and tenant_module.state = 'installed'
  limit 1
) installed on true
on conflict do nothing;

insert into public.auth_group_permissions (group_id, permission_id)
select permission_group.id, permission.id
from authz_test_context context
join public.res_groups permission_group
  on permission_group.tenant_id = context.tenant_id
 and permission_group.code = 'authorization_runtime_test'
join public.auth_permissions permission on permission.code = 'crm.read'
on conflict do nothing;

insert into public.res_users_groups (tenant_id, user_id, group_id)
select context.tenant_id, context.member_tenant_user_id, permission_group.id
from authz_test_context context
join public.res_groups permission_group
  on permission_group.tenant_id = context.tenant_id
 and permission_group.code = 'authorization_runtime_test'
on conflict do nothing;

select set_config('request.jwt.claim.sub', member_auth_user_id::text, true)
from authz_test_context;
set local role authenticated;

do $$
declare
  context authz_test_context%rowtype;
  blocked boolean;
begin
  select * into context from authz_test_context;

  if public.current_tenant_user_id() is distinct from context.member_tenant_user_id then
    raise exception 'identity: wrong tenant user';
  end if;
  if public.current_tenant_id() is distinct from context.tenant_id then
    raise exception 'identity: wrong tenant';
  end if;
  if not public.has_permission('crm.read') then
    raise exception 'permissions: group permission was not resolved';
  end if;
  if not public.has_permission(context.tenant_id, 'crm.read') then
    raise exception 'permissions: legacy wrapper did not resolve canonical permission';
  end if;
  if public.has_permission('crm.read', context.other_tenant_id) then
    raise exception 'permissions: cross-tenant permission was granted';
  end if;
  if exists (
    select 1 from public.account_accounts account
    where account.tenant_id = context.other_tenant_id
  ) then
    raise exception 'tenant isolation: member read another tenant accounting data';
  end if;
  if not exists (
    select 1
    from public.res_users_groups membership
    join public.res_groups permission_group on permission_group.id = membership.group_id
    join public.tenant_modules tenant_module
      on tenant_module.module_id = permission_group.module_id
     and tenant_module.tenant_id = membership.tenant_id
     and tenant_module.state = 'installed'
    where membership.user_id = context.member_tenant_user_id
      and permission_group.code = 'authorization_runtime_test'
  ) then
    raise exception 'regression: grouped member cannot resolve assigned installed app';
  end if;

  blocked := false;
  begin
    update public.tenant_users set role = 'owner'
    where id = context.member_tenant_user_id;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'privilege escalation: member changed own role';
  end if;

  blocked := false;
  begin
    insert into public.res_users_groups (tenant_id, user_id, group_id)
    select context.tenant_id, context.member_tenant_user_id, permission_group.id
    from public.res_groups permission_group
    where permission_group.code = 'inventory_user'
    limit 1;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'privilege escalation: member added own group';
  end if;

  blocked := false;
  begin
    insert into public.auth_permissions (code, name, resource, action)
    values ('test.escalate', 'test', 'test', 'escalate');
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'privilege escalation: member created permission';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', owner_auth_user_id::text, true)
from authz_test_context;
set local role authenticated;

do $$
declare context authz_test_context%rowtype;
begin
  select * into context from authz_test_context;
  if not public.has_permission('accounting.reverse', context.tenant_id) then
    raise exception 'owner override failed in own tenant';
  end if;
  if public.has_permission('accounting.reverse', context.other_tenant_id) then
    raise exception 'owner override leaked across tenants';
  end if;
  if not exists (
    select 1 from public.tenant_modules where tenant_id = context.tenant_id
  ) then
    raise exception 'regression: owner cannot read installed apps';
  end if;
  if not exists (select 1 from public.res_groups where active) then
    raise exception 'regression: permissions groups page cannot read groups';
  end if;
end
$$;

reset role;
set local role anon;

do $$
declare blocked boolean := false;
begin
  begin
    insert into public.auth_permissions (code, name, resource, action)
    values ('test.anon', 'test', 'test', 'anon');
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'anon modified authorization tables';
  end if;

  blocked := false;
  begin
    perform 1 from public.account_accounts limit 1;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then
    raise exception 'anon read sensitive accounting data';
  end if;
end
$$;

rollback;
