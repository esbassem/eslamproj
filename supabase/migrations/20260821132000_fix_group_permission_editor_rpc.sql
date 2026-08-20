begin;

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
  select groups.tenant_id into target_tenant_id from public.res_groups groups where groups.id = p_group_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Group not found.'; end if;
  if target_tenant_id is null then raise exception using errcode = '42501', message = 'Global system groups are read-only for tenant owners.'; end if;
  if target_tenant_id <> caller_tenant_id then raise exception using errcode = '42501', message = 'Cross-tenant group modification is not allowed.'; end if;
  if exists (select 1 from unnest(normalized_permission_ids) requested(id) left join public.auth_permissions permission on permission.id = requested.id and permission.active where permission.id is null) then
    raise exception using errcode = '22023', message = 'Unknown or inactive permission requested.';
  end if;
  delete from public.auth_group_permissions existing where existing.group_id = p_group_id and not (existing.permission_id = any(normalized_permission_ids));
  insert into public.auth_group_permissions (group_id, permission_id)
  select p_group_id, requested.id from unnest(normalized_permission_ids) requested(id)
  on conflict on constraint auth_group_permissions_group_permission_key do nothing;
  return query select grant_row.permission_id from public.auth_group_permissions grant_row where grant_row.group_id = p_group_id order by grant_row.permission_id;
end
$$;

revoke all on function public.set_tenant_group_permissions(uuid, uuid[]) from public, anon;
grant execute on function public.set_tenant_group_permissions(uuid, uuid[]) to authenticated;

commit;
