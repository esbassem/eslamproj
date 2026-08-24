begin;

do $$
declare
  v_module_id uuid;
  v_root_id uuid;
  v_menu_id uuid;
  v_code text;
begin
  select id
    into v_module_id
  from public.ir_modules
  where technical_name = 'paperwork'
  order by created_at, id
  limit 1;

  if v_module_id is null then
    raise exception 'Paperwork module is required before fixing its primary navigation';
  end if;

  select id
    into v_root_id
  from public.ir_ui_menus
  where module_id = v_module_id
    and code = 'paperwork.root'
  order by created_at, id
  limit 1;

  if v_root_id is null then
    raise exception 'paperwork.root is required before fixing Paperwork primary navigation';
  end if;

  -- Preserve every existing child if an earlier deployment created duplicate roots.
  update public.ir_ui_menus
  set parent_id = v_root_id,
      updated_at = now()
  where parent_id in (
    select id
    from public.ir_ui_menus
    where module_id = v_module_id
      and code = 'paperwork.root'
      and id <> v_root_id
  );

  delete from public.ir_ui_menus
  where module_id = v_module_id
    and code = 'paperwork.root'
    and id <> v_root_id;

  update public.ir_ui_menus
  set parent_id = null,
      name = 'إدارة أوراق الملكية',
      route_path = '/apps/paperwork',
      icon = 'Files',
      sequence = 10,
      active = true,
      updated_at = now()
  where id = v_root_id;

  foreach v_code in array array[
    'paperwork.overview',
    'paperwork.requests',
    'paperwork.processors',
    'paperwork.vault',
    'paperwork.documents'
  ]
  loop
    select id
      into v_menu_id
    from public.ir_ui_menus
    where module_id = v_module_id
      and code = v_code
    order by created_at, id
    limit 1;

    if v_menu_id is not null then
      update public.ir_ui_menus
      set parent_id = v_menu_id,
          updated_at = now()
      where parent_id in (
        select id
        from public.ir_ui_menus
        where module_id = v_module_id
          and code = v_code
          and id <> v_menu_id
      );

      delete from public.ir_ui_menus
      where module_id = v_module_id
        and code = v_code
        and id <> v_menu_id;
    end if;
  end loop;

  insert into public.ir_ui_menus (
    module_id, parent_id, name, code, route_path, icon, sequence, active
  )
  select v_module_id, v_root_id, item.name, item.code,
         item.route_path, item.icon, item.sequence, true
  from (values
    ('paperwork.overview', 'الرئيسية', '/apps/paperwork', 'Home', 10),
    ('paperwork.requests', 'الطلبات', '/apps/paperwork/requests', 'ClipboardList', 20),
    ('paperwork.processors', 'عند الجهات', '/apps/paperwork/processors', 'Building2', 30),
    ('paperwork.vault', 'الخزنة', '/apps/paperwork/vault', 'Archive', 40),
    ('paperwork.documents', 'المستندات', '/apps/paperwork/documents', 'Files', 50)
  ) item(code, name, route_path, icon, sequence)
  where not exists (
    select 1
    from public.ir_ui_menus menu
    where menu.module_id = v_module_id
      and menu.code = item.code
  );

  update public.ir_ui_menus menu
  set parent_id = v_root_id,
      name = item.name,
      route_path = item.route_path,
      icon = item.icon,
      sequence = item.sequence,
      active = true,
      updated_at = now()
  from (values
    ('paperwork.overview', 'الرئيسية', '/apps/paperwork', 'Home', 10),
    ('paperwork.requests', 'الطلبات', '/apps/paperwork/requests', 'ClipboardList', 20),
    ('paperwork.processors', 'عند الجهات', '/apps/paperwork/processors', 'Building2', 30),
    ('paperwork.vault', 'الخزنة', '/apps/paperwork/vault', 'Archive', 40),
    ('paperwork.documents', 'المستندات', '/apps/paperwork/documents', 'Files', 50)
  ) item(code, name, route_path, icon, sequence)
  where menu.module_id = v_module_id
    and menu.code = item.code;

  if (
    select count(*)
    from public.ir_ui_menus
    where module_id = v_module_id
      and code in (
        'paperwork.root',
        'paperwork.overview',
        'paperwork.requests',
        'paperwork.processors',
        'paperwork.vault',
        'paperwork.documents'
      )
  ) <> 6 then
    raise exception 'Paperwork primary navigation must contain exactly six canonical menu rows';
  end if;

  if exists (
    select code
    from public.ir_ui_menus
    where module_id = v_module_id
      and code like 'paperwork.%'
    group by code
    having count(*) > 1
  ) then
    raise exception 'Duplicate Paperwork menu codes remain after primary navigation repair';
  end if;
end
$$;

commit;
