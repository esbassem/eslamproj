begin;

do $$
declare
  v_module_id uuid;
  v_root_id uuid;
begin
  select id into v_module_id
  from public.ir_modules
  where technical_name = 'paperwork'
  order by created_at, id
  limit 1;

  if v_module_id is null then
    raise exception 'Paperwork module is required before adding its home navigation item';
  end if;

  select id into v_root_id
  from public.ir_ui_menus
  where module_id = v_module_id
    and code = 'paperwork.root'
  order by created_at, id
  limit 1;

  if v_root_id is null then
    raise exception 'paperwork.root is required before adding the Paperwork home navigation item';
  end if;

  insert into public.ir_ui_menus (
    module_id, parent_id, name, code, route_path, icon, sequence, active
  )
  select v_module_id, v_root_id, 'الرئيسية', 'paperwork.overview',
         '/apps/paperwork', 'Home', 10, true
  where not exists (
    select 1
    from public.ir_ui_menus
    where module_id = v_module_id
      and code = 'paperwork.overview'
  );

  update public.ir_ui_menus
  set parent_id = v_root_id,
      name = 'الرئيسية',
      route_path = '/apps/paperwork',
      icon = 'Home',
      sequence = 10,
      active = true,
      updated_at = now()
  where module_id = v_module_id
    and code = 'paperwork.overview';

  update public.ir_ui_menus
  set parent_id = v_root_id,
      name = 'طلبات الأوراق',
      route_path = '/apps/paperwork/requests',
      icon = 'ClipboardList',
      sequence = 20,
      active = true,
      updated_at = now()
  where module_id = v_module_id
    and code = 'paperwork.requests';

  update public.ir_ui_menus
  set parent_id = v_root_id,
      name = 'المستندات',
      route_path = '/apps/paperwork/documents',
      icon = 'Files',
      sequence = 30,
      active = true,
      updated_at = now()
  where module_id = v_module_id
    and code = 'paperwork.documents';

  update public.ir_ui_menus
  set active = false,
      updated_at = now()
  where module_id = v_module_id
    and code in ('paperwork.processors', 'paperwork.vault');

  if (
    select count(*)
    from public.ir_ui_menus
    where module_id = v_module_id
      and parent_id = v_root_id
      and active = true
      and code in ('paperwork.overview', 'paperwork.requests', 'paperwork.documents')
  ) <> 3 then
    raise exception 'Paperwork root must expose home, requests, and documents as its three primary menus';
  end if;
end
$$;

commit;
