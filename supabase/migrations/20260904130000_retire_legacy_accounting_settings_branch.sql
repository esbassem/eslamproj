begin;

do $$
declare
  v_settings_module_id uuid;
  v_accounting_menu_id uuid;
begin
  select id into v_settings_module_id
  from public.ir_modules
  where technical_name = 'settings'
  order by created_at, id
  limit 1;

  if v_settings_module_id is null then
    raise exception 'The settings module is required before retiring legacy Accounting Settings navigation.';
  end if;

  select id into v_accounting_menu_id
  from public.ir_ui_menus
  where module_id = v_settings_module_id
    and code = 'settings.accounting'
  order by created_at, id
  limit 1;

  update public.ir_ui_menus
  set active = false,
      updated_at = now()
  where module_id = v_settings_module_id
    and active = true
    and (
      id = v_accounting_menu_id
      or parent_id = v_accounting_menu_id
      or code like 'settings.accounting.%'
    );

  if exists (
    select 1
    from public.ir_ui_menus
    where module_id = v_settings_module_id
      and active = true
      and (
        id = v_accounting_menu_id
        or parent_id = v_accounting_menu_id
        or code like 'settings.accounting.%'
      )
  ) then
    raise exception 'Legacy Accounting Settings branch retirement failed.';
  end if;

  if not exists (
    select 1
    from public.ir_ui_menus
    where module_id = v_settings_module_id
      and code = 'settings.financial_setup'
      and route_path = '/app/settings/financial'
      and active = true
  ) or not exists (
    select 1
    from public.ir_ui_menus
    where module_id = v_settings_module_id
      and code = 'settings.money_destinations'
      and route_path = '/app/settings/financial/money-destinations'
      and active = true
  ) then
    raise exception 'Canonical Financial Settings navigation must remain active.';
  end if;
end
$$;

commit;
