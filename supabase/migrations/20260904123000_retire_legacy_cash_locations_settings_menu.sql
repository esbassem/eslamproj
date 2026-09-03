begin;

do $$
declare
  v_settings_module_id uuid;
  v_stale_count integer;
begin
  select id into v_settings_module_id
  from public.ir_modules
  where technical_name = 'settings'
  order by created_at, id
  limit 1;

  if v_settings_module_id is null then
    raise exception 'The settings module is required before retiring legacy Cash Locations navigation.';
  end if;

  select count(*) into v_stale_count
  from public.ir_ui_menus
  where module_id = v_settings_module_id
    and active = true
    and (
      route_path = '/app/settings/accounting/cash-locations'
      or name = 'الخزائن والعهد'
      or code in ('settings.accounting.cash_locations', 'settings.cash_locations', 'settings.cashLocationsSettings', 'cashLocationsSettings')
    );

  raise notice 'Active legacy Cash Locations Settings menu rows before retirement: %', v_stale_count;

  update public.ir_ui_menus
  set active = false,
      updated_at = now()
  where module_id = v_settings_module_id
    and active = true
    and (
      route_path = '/app/settings/accounting/cash-locations'
      or name = 'الخزائن والعهد'
      or code in ('settings.accounting.cash_locations', 'settings.cash_locations', 'settings.cashLocationsSettings', 'cashLocationsSettings')
    );

  if exists (
    select 1
    from public.ir_ui_menus
    where module_id = v_settings_module_id
      and active = true
      and (
        route_path = '/app/settings/accounting/cash-locations'
        or name = 'الخزائن والعهد'
        or code in ('settings.accounting.cash_locations', 'settings.cash_locations', 'settings.cashLocationsSettings', 'cashLocationsSettings')
      )
  ) then
    raise exception 'Legacy Cash Locations Settings navigation retirement failed.';
  end if;

  if not exists (
    select 1
    from public.ir_ui_menus
    where module_id = v_settings_module_id
      and code = 'settings.accounting'
      and route_path = '/app/settings?section=accounting'
      and active = true
  ) then
    raise exception 'Current Accounting Settings navigation must remain active.';
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
