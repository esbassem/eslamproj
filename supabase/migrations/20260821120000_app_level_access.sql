begin;

-- App access is registered only for active, user-facing application modules.
insert into public.auth_permissions (code, name, description, resource, action, active)
select
  regexp_replace(lower(module.technical_name), '[^a-z0-9_]+', '_', 'g') || '.access',
  'فتح تطبيق ' || module.name,
  'صلاحية عامة لفتح تطبيق ' || module.name || ' عندما يكون مثبتًا للشركة.',
  regexp_replace(lower(module.technical_name), '[^a-z0-9_]+', '_', 'g'),
  'access',
  true
from public.ir_modules module
where module.application = true
  and module.technical = false
  and module.active = true
  and module.technical_name <> 'team'
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    resource = excluded.resource,
    action = 'access',
    active = true,
    updated_at = now();

-- Existing module-linked groups are the compatibility bridge. No new groups or
-- individual user assignments are created.
insert into public.auth_group_permissions (group_id, permission_id)
select groups.id, permission.id
from public.res_groups groups
join public.ir_modules module
  on module.id = groups.module_id
 and module.application = true
 and module.technical = false
 and module.active = true
 and module.technical_name <> 'team'
join public.auth_permissions permission
  on permission.code = regexp_replace(lower(module.technical_name), '[^a-z0-9_]+', '_', 'g') || '.access'
where groups.active = true
on conflict (group_id, permission_id) do nothing;

-- Abort the transaction if permission-based access differs from the legacy
-- group.module_id decision for any active non-owner user and installed app.
do $$
declare
  mismatch_count bigint;
begin
  with installed_apps as (
    select tenant_module.tenant_id, module.id as module_id,
      regexp_replace(lower(module.technical_name), '[^a-z0-9_]+', '_', 'g') || '.access' as permission_code
    from public.tenant_modules tenant_module
    join public.ir_modules module on module.id = tenant_module.module_id
    where tenant_module.state = 'installed'
      and module.application = true and module.technical = false and module.active = true
      and module.technical_name <> 'team'
  ), comparisons as (
    select tenant_user.id, app.module_id,
      exists (
        select 1 from public.res_users_groups membership
        join public.res_groups groups on groups.id = membership.group_id
        where membership.tenant_id = tenant_user.tenant_id
          and membership.user_id = tenant_user.id and groups.active = true
          and groups.module_id = app.module_id
          and (groups.tenant_id is null or groups.tenant_id = tenant_user.tenant_id)
      ) as old_access,
      exists (
        select 1 from public.res_users_groups membership
        join public.res_groups groups on groups.id = membership.group_id
        join public.auth_group_permissions grant_row on grant_row.group_id = groups.id
        join public.auth_permissions permission on permission.id = grant_row.permission_id
        where membership.tenant_id = tenant_user.tenant_id
          and membership.user_id = tenant_user.id and groups.active = true
          and (groups.tenant_id is null or groups.tenant_id = tenant_user.tenant_id)
          and permission.active = true and permission.code = app.permission_code
      ) as new_access
    from public.tenant_users tenant_user
    join installed_apps app on app.tenant_id = tenant_user.tenant_id
    where tenant_user.is_active = true and tenant_user.role <> 'owner'
  )
  select count(*) into mismatch_count from comparisons where old_access is distinct from new_access;

  if mismatch_count <> 0 then
    raise exception 'App access backfill aborted: % OLD/NEW access mismatches found.', mismatch_count;
  end if;
end
$$;

comment on column public.auth_permissions.action is
  'Canonical action; action=access represents application-level entry, not an application-specific operation.';

commit;
