update public.ir_modules
set route_path = '/apps/accounting',
    updated_at = now()
where technical_name = 'accounting';

update public.ir_ui_menus
set route_path = case code
    when 'accounting.root' then '/apps/accounting'
    when 'accounting.journals' then '/apps/accounting/journals'
    when 'accounting.payments' then '/apps/accounting/payments'
    when 'accounting.accounts' then '/apps/accounting/accounts'
    when 'accounting.reports' then '/apps/accounting/reports'
    else route_path
  end,
  updated_at = now()
where code in (
  'accounting.root',
  'accounting.journals',
  'accounting.payments',
  'accounting.accounts',
  'accounting.reports'
);
