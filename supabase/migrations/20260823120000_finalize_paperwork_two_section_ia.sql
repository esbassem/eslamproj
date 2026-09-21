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
    raise exception 'Paperwork module is required before finalizing its information architecture';
  end if;

  select id into v_root_id
  from public.ir_ui_menus
  where module_id = v_module_id and code = 'paperwork.root'
  order by created_at, id
  limit 1;

  if v_root_id is null then
    raise exception 'paperwork.root is required before finalizing Paperwork information architecture';
  end if;

  update public.ir_ui_menus
  set parent_id = v_root_id,
      updated_at = now()
  where module_id = v_module_id
    and code in ('paperwork.requests', 'paperwork.documents');

  update public.ir_ui_menus
  set name = 'طلبات الأوراق',
      route_path = '/apps/paperwork',
      icon = 'ClipboardList',
      sequence = 10,
      active = true,
      updated_at = now()
  where module_id = v_module_id
    and code = 'paperwork.requests';

  update public.ir_ui_menus
  set name = 'المستندات',
      route_path = '/apps/paperwork/documents',
      icon = 'Files',
      sequence = 20,
      active = true,
      updated_at = now()
  where module_id = v_module_id
    and code = 'paperwork.documents';

  -- Keep route metadata rows for compatibility, but remove them from primary navigation.
  update public.ir_ui_menus
  set active = false,
      updated_at = now()
  where module_id = v_module_id
    and code in ('paperwork.overview', 'paperwork.processors', 'paperwork.vault');

  if (
    select count(*)
    from public.ir_ui_menus
    where module_id = v_module_id
      and parent_id = v_root_id
      and active = true
  ) <> 2 then
    raise exception 'Paperwork root must expose exactly two active primary menus';
  end if;

  if exists (
    select code
    from public.ir_ui_menus
    where module_id = v_module_id
      and code like 'paperwork.%'
    group by code
    having count(*) > 1
  ) then
    raise exception 'Duplicate Paperwork menu codes remain';
  end if;
end
$$;

commit;
