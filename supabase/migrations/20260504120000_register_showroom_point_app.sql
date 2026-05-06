begin;

alter table public.ir_modules
  add column if not exists icon_color text,
  add column if not exists installable boolean not null default true,
  add column if not exists is_removable boolean not null default true;

insert into public.ir_modules (
  technical_name,
  name,
  icon,
  icon_color,
  route_path,
  application,
  technical,
  installable,
  is_removable,
  active,
  sequence
)
values (
  'showroom_point',
  'Showroom',
  'Store',
  '#0F766E',
  '/app/showroom_point',
  true,
  false,
  true,
  true,
  true,
  55
)
on conflict (technical_name) do update
set
  name = excluded.name,
  icon = excluded.icon,
  icon_color = excluded.icon_color,
  route_path = excluded.route_path,
  application = excluded.application,
  technical = excluded.technical,
  installable = excluded.installable,
  is_removable = excluded.is_removable,
  active = excluded.active,
  sequence = excluded.sequence,
  updated_at = now();

with app_module as (
  select id
  from public.ir_modules
  where technical_name = 'showroom_point'
),
root_menu as (
  insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
  select id, null, 'Showroom', 'showroom_point.root', '/app/showroom_point', 'Store', 10, true
  from app_module
  where not exists (
    select 1
    from public.ir_ui_menus existing
    where existing.module_id = app_module.id
      and existing.code = 'showroom_point.root'
  )
  returning id, module_id
),
resolved_root_menu as (
  select id, module_id
  from root_menu
  union all
  select menu.id, menu.module_id
  from public.ir_ui_menus menu
  join app_module on app_module.id = menu.module_id
  where menu.code = 'showroom_point.root'
  limit 1
)
insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
select resolved_root_menu.module_id, resolved_root_menu.id, rows.name, rows.code, rows.route_path, rows.icon, rows.sequence, true
from (
  values
    ('Sales', 'showroom_point.list', '/app/showroom_point', 'ReceiptText', 10),
    ('New Sale', 'showroom_point.create', '/app/showroom_point/new', 'PlusCircle', 20),
    ('Customers', 'showroom_point.customers', '/app/showroom_point/customers', 'Users', 30),
    ('Settings', 'showroom_point.settings', '/app/showroom_point/settings', 'Settings', 40)
) as rows(name, code, route_path, icon, sequence)
cross join resolved_root_menu
where not exists (
  select 1
  from public.ir_ui_menus existing
  where existing.module_id = resolved_root_menu.module_id
    and existing.code = rows.code
);

update public.ir_ui_menus
set route_path = '/app/showroom_point', updated_at = now()
where code in ('showroom_point.root', 'showroom_point.list');

update public.ir_ui_menus
set route_path = '/app/showroom_point/new', updated_at = now()
where code = 'showroom_point.create';

update public.ir_ui_menus
set route_path = '/app/showroom_point/customers', updated_at = now()
where code = 'showroom_point.customers';

update public.ir_ui_menus
set route_path = '/app/showroom_point/settings', updated_at = now()
where code = 'showroom_point.settings';

commit;
