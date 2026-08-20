begin;

create or replace function public.fill_auth_permission_catalog_metadata()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  new.module_code := coalesce(nullif(btrim(new.module_code), ''), new.resource);
  new.permission_type := coalesce(nullif(btrim(new.permission_type), ''), case when new.action = 'access' then 'app_access' else 'action' end);
  if new.sort_order is null then
    new.sort_order := case when new.action = 'access' then 10 else 100 end;
  end if;
  return new;
end
$$;

drop trigger if exists auth_permissions_fill_catalog_metadata on public.auth_permissions;
create trigger auth_permissions_fill_catalog_metadata
before insert or update of resource, action, module_code, permission_type, sort_order
on public.auth_permissions
for each row execute function public.fill_auth_permission_catalog_metadata();

revoke all on function public.fill_auth_permission_catalog_metadata() from public, anon, authenticated;

commit;
