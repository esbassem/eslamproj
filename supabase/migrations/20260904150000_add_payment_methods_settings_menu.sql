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
  where module_id = v_settings_module_id
    and code = 'settings.financial_setup'
  order by created_at, id limit 1;

  if v_settings_module_id is null or v_financial_setup_id is null then
    raise exception 'Financial Setup navigation is required before adding Payment Methods.';
  end if;

  select id into v_menu_id
  from public.ir_ui_menus
  where module_id = v_settings_module_id
    and code = 'settings.financial.payment_methods'
  order by created_at, id limit 1;

  if v_menu_id is null then
    insert into public.ir_ui_menus (
      module_id, parent_id, name, code, route_path, icon, sequence, active
    ) values (
      v_settings_module_id, v_financial_setup_id, 'طرق الدفع',
      'settings.financial.payment_methods', '/app/settings/financial/payment-methods',
      'CreditCard', 20, true
    );
  else
    update public.ir_ui_menus
    set parent_id = v_financial_setup_id,
        name = 'طرق الدفع',
        route_path = '/app/settings/financial/payment-methods',
        icon = 'CreditCard',
        sequence = 20,
        active = true,
        updated_at = now()
    where id = v_menu_id;
  end if;

  if (
    select count(*)
    from public.ir_ui_menus
    where module_id = v_settings_module_id
      and parent_id = v_financial_setup_id
      and code = 'settings.financial.payment_methods'
      and route_path = '/app/settings/financial/payment-methods'
      and icon = 'CreditCard'
      and sequence = 20
      and active
  ) <> 1 then
    raise exception 'Payment Methods navigation assertion failed.';
  end if;
end
$$;

commit;
