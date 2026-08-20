begin;

-- Remote drift contained this legacy overload even though no local caller uses it.
-- Keep its signature as a compatibility wrapper while using the canonical core.
create or replace function public.has_permission(target_tenant_id uuid, permission_code text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.has_permission(permission_code, target_tenant_id)
$$;

revoke all on function public.has_permission(uuid, text) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated;

comment on function public.has_permission(uuid, text) is
  'Legacy argument-order compatibility wrapper for has_permission(text, uuid).';

commit;
