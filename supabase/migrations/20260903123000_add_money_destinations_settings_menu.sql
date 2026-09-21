begin;

do $$
declare
  v_settings_module_id uuid;
  v_financial_setup_id uuid;
  v_menu_id uuid;
begin
  select id into v_settings_module_id
  from public.ir_modules
  where technical_name = 'settings'
  order by created_at, id limit 1;

  select id into v_financial_setup_id
  from public.ir_ui_menus
  where module_id = v_settings_module_id and code = 'settings.financial_setup'
  order by created_at, id limit 1;

  if v_settings_module_id is null or v_financial_setup_id is null then
    raise exception 'Financial Setup navigation is required before adding Money Destinations.';
  end if;

  select id into v_menu_id
  from public.ir_ui_menus
  where module_id = v_settings_module_id and code = 'settings.money_destinations'
  order by created_at, id limit 1;

  if v_menu_id is null then
    insert into public.ir_ui_menus (
      module_id, parent_id, name, code, route_path, icon, sequence, active
    ) values (
      v_settings_module_id, v_financial_setup_id, 'أماكن الأموال',
      'settings.money_destinations', '/app/settings/financial/money-destinations',
      'Landmark', 10, true
    );
  else
    update public.ir_ui_menus
    set parent_id = v_financial_setup_id,
        name = 'أماكن الأموال',
        route_path = '/app/settings/financial/money-destinations',
        icon = 'Landmark', sequence = 10, active = true, updated_at = now()
    where id = v_menu_id;
  end if;

  if (
    select count(*) from public.ir_ui_menus
    where module_id = v_settings_module_id and parent_id = v_financial_setup_id
      and code = 'settings.money_destinations'
      and route_path = '/app/settings/financial/money-destinations'
      and icon = 'Landmark' and sequence = 10 and active
  ) <> 1 then
    raise exception 'Money Destinations navigation assertion failed.';
  end if;
end
$$;

commit;
