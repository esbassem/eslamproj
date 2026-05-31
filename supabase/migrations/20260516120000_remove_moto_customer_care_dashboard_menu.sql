begin;

update public.ir_modules
set
  route_path = '/app/moto-customer-care/sales',
  updated_at = now()
where technical_name in ('moto_customer_care', 'moto-customer-care');

update public.ir_ui_menus
set
  route_path = '/app/moto-customer-care/sales',
  updated_at = now()
where code in ('moto_customer_care.root', 'moto-customer-care.root', 'moto_customer_care.sales', 'moto-customer-care.sales')
   or route_path in ('/app/moto-customer-care', '/apps/moto-customer-care');

update public.ir_ui_menus
set
  active = false,
  updated_at = now()
where route_path in ('/app/moto-customer-care/dashboard', '/apps/moto-customer-care/dashboard')
   or code in ('moto_customer_care.dashboard', 'moto-customer-care.dashboard')
   or (
     lower(coalesce(name, '')) in ('dashboard', 'لوحة المتابعة')
     and module_id in (
       select id
       from public.ir_modules
       where technical_name in ('moto_customer_care', 'moto-customer-care')
     )
   );

commit;
