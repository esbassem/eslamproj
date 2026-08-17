do $$
declare
  v_settings_module_id uuid;
  v_settings_root_id uuid;
  v_branches_menu_id uuid;
begin
  select id into v_settings_module_id from public.ir_modules where technical_name = 'settings';
  if v_settings_module_id is null then
    raise exception 'The settings module is required before adding the branches menu.';
  end if;

  select id into v_settings_root_id
  from public.ir_ui_menus
  where module_id = v_settings_module_id and code = 'settings.root'
  order by created_at limit 1;
  if v_settings_root_id is null then
    raise exception 'The settings root menu is required before adding the branches menu.';
  end if;

  select id into v_branches_menu_id
  from public.ir_ui_menus
  where module_id = v_settings_module_id
    and (code = 'settings.branches' or route_path = '/app/settings/branches')
  order by created_at limit 1;

  if v_branches_menu_id is null then
    insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
    values (v_settings_module_id, v_settings_root_id, 'الفروع', 'settings.branches', '/app/settings/branches', 'MapPinned', 30, true)
    returning id into v_branches_menu_id;
  else
    update public.ir_ui_menus
    set parent_id = v_settings_root_id, name = 'الفروع', code = 'settings.branches',
        route_path = '/app/settings/branches', icon = 'MapPinned', sequence = 30,
        active = true, updated_at = now()
    where id = v_branches_menu_id;
  end if;

  if (
    select count(*) from public.ir_ui_menus
    where module_id = v_settings_module_id and active = true
      and (code = 'settings.branches' or route_path = '/app/settings/branches')
  ) <> 1 then
    raise exception 'Settings branches menu assertion failed: expected exactly one active menu.';
  end if;

  if not exists (
    select 1 from public.ir_ui_menus
    where id = v_branches_menu_id and parent_id = v_settings_root_id
      and code = 'settings.branches' and route_path = '/app/settings/branches'
      and sequence = 30 and active = true
  ) then
    raise exception 'Settings branches menu assertion failed: menu metadata is invalid.';
  end if;
end $$;
