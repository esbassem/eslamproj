begin;

alter table public.auth_permissions
  add column if not exists module_code text,
  add column if not exists permission_type text,
  add column if not exists sort_order integer not null default 100;

update public.auth_permissions permission
set permission_type = case when permission.action = 'access' then 'app_access' else 'action' end,
    module_code = coalesce(
      (select min(module.technical_name)
       from public.auth_group_permissions grant_row
       join public.res_groups groups on groups.id = grant_row.group_id
       join public.ir_modules module on module.id = groups.module_id
       where grant_row.permission_id = permission.id),
      permission.resource
    ),
    sort_order = case when permission.action = 'access' then 10 else 100 end,
    updated_at = now()
where permission.module_code is null
   or permission.permission_type is null;

alter table public.auth_permissions
  alter column module_code set not null,
  alter column permission_type set not null;

alter table public.auth_permissions
  drop constraint if exists auth_permissions_permission_type_check;
alter table public.auth_permissions
  add constraint auth_permissions_permission_type_check
  check (permission_type in ('app_access', 'action'));

create index if not exists auth_permissions_catalog_idx
  on public.auth_permissions (active, module_code, permission_type, sort_order, name);

create or replace function public.set_tenant_group_permissions(
  p_group_id uuid,
  p_permission_ids uuid[]
)
returns table(permission_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_tenant_id uuid := public.current_tenant_id();
  target_tenant_id uuid;
  normalized_permission_ids uuid[] := coalesce(p_permission_ids, array[]::uuid[]);
begin
  if caller_tenant_id is null or not public.is_current_tenant_owner(caller_tenant_id) then
    raise exception using errcode = '42501', message = 'Only the tenant owner can manage group permissions.';
  end if;

  select groups.tenant_id into target_tenant_id
  from public.res_groups groups
  where groups.id = p_group_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Group not found.';
  end if;

  if target_tenant_id is null then
    raise exception using errcode = '42501', message = 'Global system groups are read-only for tenant owners.';
  end if;

  if target_tenant_id <> caller_tenant_id then
    raise exception using errcode = '42501', message = 'Cross-tenant group modification is not allowed.';
  end if;

  if exists (
    select 1 from unnest(normalized_permission_ids) requested(id)
    left join public.auth_permissions permission on permission.id = requested.id and permission.active = true
    where permission.id is null
  ) then
    raise exception using errcode = '22023', message = 'Unknown or inactive permission requested.';
  end if;

  delete from public.auth_group_permissions existing
  where existing.group_id = p_group_id
    and not (existing.permission_id = any(normalized_permission_ids));

  insert into public.auth_group_permissions (group_id, permission_id)
  select p_group_id, requested.id
  from unnest(normalized_permission_ids) requested(id)
  on conflict (group_id, permission_id) do nothing;

  return query
  select grant_row.permission_id
  from public.auth_group_permissions grant_row
  where grant_row.group_id = p_group_id
  order by grant_row.permission_id;
end
$$;

revoke all on function public.set_tenant_group_permissions(uuid, uuid[]) from public, anon;
grant execute on function public.set_tenant_group_permissions(uuid, uuid[]) to authenticated;

comment on column public.auth_permissions.module_code is 'User-facing application/module namespace used by the dynamic permission catalog.';
comment on column public.auth_permissions.permission_type is 'app_access for application entry, action for existing application operations.';
comment on column public.auth_permissions.sort_order is 'Stable display ordering inside a module/type section.';
comment on function public.set_tenant_group_permissions(uuid, uuid[]) is 'Atomic owner-only replacement for a tenant-owned group; global system groups are intentionally immutable.';

commit;
