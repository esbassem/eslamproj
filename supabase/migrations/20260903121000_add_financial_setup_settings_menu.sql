begin;

do $$
declare
  v_settings_module_id uuid;
  v_settings_root_id uuid;
  v_menu_id uuid;
begin
  select id into v_settings_module_id
  from public.ir_modules
  where technical_name = 'settings'
  order by created_at, id
  limit 1;

  if v_settings_module_id is null then
    raise exception 'The settings module is required before adding Financial Setup navigation.';
  end if;

  select id into v_settings_root_id
  from public.ir_ui_menus
  where module_id = v_settings_module_id and code = 'settings.root'
  order by created_at, id
  limit 1;

  if v_settings_root_id is null then
    raise exception 'The settings root menu is required before adding Financial Setup navigation.';
  end if;

  select id into v_menu_id
  from public.ir_ui_menus
  where module_id = v_settings_module_id and code = 'settings.financial_setup'
  order by created_at, id
  limit 1;

  if v_menu_id is null then
    insert into public.ir_ui_menus (
      module_id, parent_id, name, code, route_path, icon, sequence, active
    ) values (
      v_settings_module_id, v_settings_root_id, 'الإعداد المالي',
      'settings.financial_setup', '/app/settings/financial', 'WalletCards', 15, true
    );
  else
    update public.ir_ui_menus
    set parent_id = v_settings_root_id,
        name = 'الإعداد المالي',
        route_path = '/app/settings/financial',
        icon = 'WalletCards',
        sequence = 15,
        active = true,
        updated_at = now()
    where id = v_menu_id;
  end if;

  if (
    select count(*)
    from public.ir_ui_menus
    where module_id = v_settings_module_id
      and parent_id = v_settings_root_id
      and code = 'settings.financial_setup'
      and route_path = '/app/settings/financial'
      and icon = 'WalletCards'
      and sequence = 15
      and active = true
  ) <> 1 then
    raise exception 'Financial Setup navigation assertion failed.';
  end if;
end
$$;

commit;
