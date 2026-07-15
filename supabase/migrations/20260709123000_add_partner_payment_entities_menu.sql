begin;

with partners_module as (
  select id
  from public.ir_modules
  where technical_name = 'partners'
),
partners_root as (
  select menu.id, menu.module_id
  from public.ir_ui_menus menu
  join partners_module module on module.id = menu.module_id
  where menu.code = 'partners.root'
),
rows as (
  select *
  from (
    values
      ('العملاء', 'partners.customers', '/app/partners/customers', 'Users', 10),
      ('الموردون', 'partners.suppliers', '/app/partners/suppliers', 'Truck', 20),
      ('جهات الدفع', 'partners.payment_entities', '/app/partners/payment-entities', 'CreditCard', 30)
  ) as value(name, code, route_path, icon, sequence)
)
insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
select root.module_id, root.id, rows.name, rows.code, rows.route_path, rows.icon, rows.sequence, true
from partners_root root
cross join rows
where not exists (
  select 1
  from public.ir_ui_menus existing
  where existing.module_id = root.module_id
    and existing.code = rows.code
);

update public.ir_ui_menus
set
  name = rows.name,
  route_path = rows.route_path,
  icon = rows.icon,
  sequence = rows.sequence,
  active = true,
  updated_at = now()
from (
  values
    ('partners.customers', 'العملاء', '/app/partners/customers', 'Users', 10),
    ('partners.suppliers', 'الموردون', '/app/partners/suppliers', 'Truck', 20),
    ('partners.payment_entities', 'جهات الدفع', '/app/partners/payment-entities', 'CreditCard', 30)
) as rows(code, name, route_path, icon, sequence)
where ir_ui_menus.code = rows.code;

commit;
