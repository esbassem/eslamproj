begin;

do $$
declare
  v_settings_module_id uuid;
  v_settings_root_id uuid;
  v_item record;
  v_menu_id uuid;
begin
  select id into v_settings_module_id
  from public.ir_modules
  where technical_name = 'settings'
  order by created_at, id
  limit 1;

  if v_settings_module_id is null then
    raise exception 'The settings module is required before unifying Settings navigation.';
  end if;

  select id into v_settings_root_id
  from public.ir_ui_menus
  where module_id = v_settings_module_id and code = 'settings.root'
  order by created_at, id
  limit 1;

  if v_settings_root_id is null then
    raise exception 'The settings root menu is required before unifying Settings navigation.';
  end if;

  for v_item in
    select * from (values
      ('settings.general', 'عام', '/app/settings', 'Building2', 10),
      ('settings.accounting', 'المحاسبة', '/app/settings?section=accounting', 'Landmark', 20),
      ('settings.branches', 'الفروع', '/app/settings/branches', 'MapPinned', 30),
      ('settings.pos', 'نقاط البيع', '/app/settings?section=pos', 'Store', 40),
      ('settings.team', 'المستخدمون والفريق', '/app/settings/team', 'Users2', 50),
      ('settings.permissions', 'الأدوار والصلاحيات', '/app/settings/permissions', 'ShieldCheck', 60)
    ) rows(code, name, route_path, icon, sequence)
  loop
    select id into v_menu_id
    from public.ir_ui_menus
    where module_id = v_settings_module_id and code = v_item.code
    order by created_at, id
    limit 1;

    if v_menu_id is null then
      insert into public.ir_ui_menus (
        module_id, parent_id, name, code, route_path, icon, sequence, active
      ) values (
        v_settings_module_id, v_settings_root_id, v_item.name, v_item.code,
        v_item.route_path, v_item.icon, v_item.sequence, true
      ) returning id into v_menu_id;
    else
      update public.ir_ui_menus
      set parent_id = v_settings_root_id,
          name = v_item.name,
          route_path = v_item.route_path,
          icon = v_item.icon,
          sequence = v_item.sequence,
          active = true,
          updated_at = now()
      where id = v_menu_id;
    end if;
  end loop;

  if exists (
    select code
    from public.ir_ui_menus
    where module_id = v_settings_module_id and active = true
      and code in (
        'settings.general', 'settings.accounting', 'settings.branches',
        'settings.pos', 'settings.team', 'settings.permissions'
      )
    group by code
    having count(*) <> 1
  ) then
    raise exception 'Settings navigation assertion failed: duplicate active menu codes.';
  end if;

  if (
    select count(*)
    from public.ir_ui_menus
    where module_id = v_settings_module_id and parent_id = v_settings_root_id
      and active = true
      and (code, route_path, sequence) in (
        ('settings.general', '/app/settings', 10),
        ('settings.accounting', '/app/settings?section=accounting', 20),
        ('settings.branches', '/app/settings/branches', 30),
        ('settings.pos', '/app/settings?section=pos', 40),
        ('settings.team', '/app/settings/team', 50),
        ('settings.permissions', '/app/settings/permissions', 60)
      )
  ) <> 6 then
    raise exception 'Settings navigation assertion failed: expected parent, route, or sequence is missing.';
  end if;
end
$$;

commit;
