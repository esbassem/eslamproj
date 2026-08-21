begin;

do $$ declare name text; begin
  if not exists(select 1 from public.ir_modules where technical_name='paperwork' and route_path='/apps/paperwork' and application and active) then
    raise exception 'TEST_FAILED: paperwork module registration missing';
  end if;
  if not exists(select 1 from public.auth_permissions where code='paperwork.access' and permission_type='app_access' and action='access' and active) then
    raise exception 'TEST_FAILED: paperwork.access missing';
  end if;
  if (select count(*) from public.auth_permissions where module_code='paperwork' and permission_type='action' and active) <> 6 then
    raise exception 'TEST_FAILED: Paperwork action permission matrix is incomplete';
  end if;
  foreach name in array array[
    'send_paperwork_request_to_processor','receive_paperwork_request_from_processor',
    'deliver_paperwork_to_customer',
    'create_manual_paperwork_receipt','cancel_paperwork_request'
  ] loop
    if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=name and pg_get_functiondef(p.oid) ilike '%require_paperwork_access(p_tenant_id)%') then
      raise exception 'TEST_FAILED: RPC app boundary missing for %',name;
    end if;
  end loop;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='notify_paperwork_customer') then
    raise exception 'TEST_FAILED: removed customer-notification RPC still exists';
  end if;
end $$;

rollback;
