begin;

insert into public.ir_modules (
  technical_name, name, description, icon, icon_color, route_path,
  application, technical, installable, is_removable, active, sequence
)
values (
  'paperwork', 'إدارة أوراق الملكية',
  'إدارة طلبات أوراق الملكية والمستندات وحركة الحيازة والخزنة.',
  'Files', '#2563EB', '/apps/paperwork', true, false, true, true, true, 66
)
on conflict (technical_name) do update set
  name=excluded.name, description=excluded.description, icon=excluded.icon,
  icon_color=excluded.icon_color, route_path=excluded.route_path,
  application=true, technical=false, installable=true, is_removable=true,
  active=true, sequence=excluded.sequence, updated_at=now();

insert into public.auth_permissions (
  code, name, description, resource, action, active,
  permission_type, module_code, sort_order
)
values (
  'paperwork.access', 'فتح تطبيق إدارة أوراق الملكية',
  'صلاحية عامة لفتح واستخدام نطاق إدارة أوراق الملكية.',
  'paperwork', 'access', true, 'app_access', 'paperwork', 10
)
on conflict (code) do update set
  name=excluded.name, description=excluded.description, resource='paperwork',
  action='access', active=true, permission_type='app_access',
  module_code='paperwork', sort_order=10, updated_at=now();

-- Preserve installation availability for tenants that already run Customer Care.
insert into public.tenant_modules (tenant_id, module_id, state, installed_at)
select customer_care.tenant_id, paperwork.id, 'installed', now()
from public.tenant_modules customer_care
join public.ir_modules old_module on old_module.id=customer_care.module_id
cross join public.ir_modules paperwork
where old_module.technical_name in ('moto_customer_care','moto-customer-care')
  and customer_care.state='installed' and paperwork.technical_name='paperwork'
on conflict (tenant_id, module_id) do update set
  state='installed', installed_at=coalesce(public.tenant_modules.installed_at, excluded.installed_at),
  uninstalled_at=null, updated_at=now();

with app as (select id from public.ir_modules where technical_name='paperwork'), root as (
  insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active)
  select id,null,'إدارة أوراق الملكية','paperwork.root','/apps/paperwork','Files',10,true from app
  where not exists(select 1 from public.ir_ui_menus where code='paperwork.root')
  returning id,module_id
), resolved_root as (
  select id,module_id from root union all
  select menu.id,menu.module_id from public.ir_ui_menus menu join app on app.id=menu.module_id
  where menu.code='paperwork.root' limit 1
)
insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active)
select root.module_id,root.id,item.name,item.code,item.route_path,item.icon,item.sequence,true
from (values
  ('طلبات الأوراق','paperwork.requests','/apps/paperwork/requests','ClipboardList',10),
  ('المستندات','paperwork.documents','/apps/paperwork/documents','Files',20),
  ('الخزنة','paperwork.vault','/apps/paperwork/vault','Archive',30)
) item(name,code,route_path,icon,sequence)
cross join resolved_root root
where not exists(select 1 from public.ir_ui_menus menu where menu.code=item.code);

update public.ir_ui_menus set active=true,updated_at=now()
where code in ('paperwork.root','paperwork.requests','paperwork.documents','paperwork.vault');

create or replace function public.can_access_paperwork(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.tenant_modules tenant_module
       join public.ir_modules module on module.id=tenant_module.module_id
       where tenant_module.tenant_id=p_tenant_id and tenant_module.state='installed'
         and module.technical_name='paperwork' and module.active
     )
     and public.has_permission('paperwork.access',p_tenant_id)
$$;
revoke all on function public.can_access_paperwork(uuid) from public,anon;
grant execute on function public.can_access_paperwork(uuid) to authenticated;

create or replace function public.require_paperwork_access(p_tenant_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not public.can_access_paperwork(p_tenant_id) then
    raise exception 'PAPERWORK_APP_ACCESS_REQUIRED' using errcode='42501';
  end if;
end;
$$;
revoke all on function public.require_paperwork_access(uuid) from public,anon;
grant execute on function public.require_paperwork_access(uuid) to authenticated;

-- Add a restrictive app boundary without replacing or widening existing tenant RLS.
do $$ declare table_name text; begin
  foreach table_name in array array[
    'paperwork_requests','paperwork_request_events','paperwork_documents','paperwork_document_moves'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists paperwork_app_access_boundary on public.%I',table_name);
    execute format(
      'create policy paperwork_app_access_boundary on public.%I as restrictive for all to authenticated using (public.can_access_paperwork(tenant_id)) with check (public.can_access_paperwork(tenant_id))',
      table_name
    );
  end loop;
end $$;

-- Existing signatures and business bodies remain intact; only the common app gate is injected.
do $$
declare function_record record; definition text; guarded_definition text;
  guarded_names text[]:=array[
    'confirm_sale_paperwork_request','send_paperwork_request_to_processor',
    'receive_paperwork_request_from_processor','notify_paperwork_customer',
    'deliver_paperwork_to_customer','create_manual_paperwork_receipt',
    'link_vault_paperwork_request','link_existing_vault_document_to_request',
    'create_legacy_delivered_paperwork_request','record_previous_customer_paperwork_delivery',
    'record_previous_customer_paperwork_delivery_bulk','cancel_paperwork_request',
    'reopen_cancelled_paperwork_request','confirm_processor_paperwork_cancellation',
    'cancel_paperwork_document','record_previous_paperwork_document_delivery',
    'authorize_paperwork_document_release','set_paperwork_document_owner_partner'
  ];
begin
  for function_record in
    select procedure.oid,procedure.proname,pg_get_functiondef(procedure.oid) function_definition
    from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='public' and procedure.prokind='f'
      and procedure.proname=any(guarded_names)
      and pg_get_function_identity_arguments(procedure.oid) ilike '%p_tenant_id uuid%'
  loop
    definition:=function_record.function_definition;
    if definition ilike '%require_paperwork_access(p_tenant_id)%' then continue; end if;
    guarded_definition:=regexp_replace(
      definition, E'\\r?\\n(begin|BEGIN)\\r?\\n',
      E'\n\\1\n  perform public.require_paperwork_access(p_tenant_id);\n', ''
    );
    if guarded_definition=definition then
      raise exception 'Could not install Paperwork access boundary in function %',function_record.proname;
    end if;
    execute guarded_definition;
  end loop;

  if exists (
    select 1 from unnest(guarded_names) name
    where not exists (
      select 1 from pg_proc procedure join pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='public' and procedure.proname=name
        and pg_get_function_identity_arguments(procedure.oid) ilike '%p_tenant_id uuid%'
        and pg_get_functiondef(procedure.oid) ilike '%require_paperwork_access(p_tenant_id)%'
    )
  ) then raise exception 'Paperwork RPC boundary assertion failed'; end if;
end $$;

do $$ begin
  if (select count(*) from public.auth_permissions where code='paperwork.access' and permission_type='app_access' and action='access' and active)<>1 then
    raise exception 'paperwork.access registration assertion failed';
  end if;
  if exists(select 1 from public.auth_permissions where module_code='paperwork' and permission_type='action') then
    raise exception 'Phase 1 must not create Paperwork action permissions';
  end if;
end $$;

notify pgrst,'reload schema';
commit;
