begin;

create extension if not exists pgcrypto;

create table if not exists public.ir_modules (
  id uuid primary key default gen_random_uuid(),
  technical_name text not null unique,
  name text not null,
  icon text,
  route_path text,
  application boolean not null default true,
  technical boolean not null default false,
  active boolean not null default true,
  sequence integer not null default 10,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ir_modules
  add column if not exists icon text,
  add column if not exists route_path text,
  add column if not exists application boolean not null default true,
  add column if not exists technical boolean not null default false,
  add column if not exists active boolean not null default true,
  add column if not exists sequence integer not null default 10,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ir_modules_technical_name_key'
      and conrelid = 'public.ir_modules'::regclass
  ) then
    alter table public.ir_modules
      add constraint ir_modules_technical_name_key unique (technical_name);
  end if;
end $$;

create table if not exists public.ir_ui_menus (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.ir_modules(id) on delete cascade,
  parent_id uuid references public.ir_ui_menus(id) on delete cascade,
  name text not null,
  code text,
  route_path text,
  icon text,
  sequence integer not null default 10,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ir_ui_menus
  add column if not exists code text,
  add column if not exists route_path text,
  add column if not exists icon text,
  add column if not exists sequence integer not null default 10,
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.tenant_modules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  module_id uuid not null references public.ir_modules(id) on delete cascade,
  state text not null default 'installed',
  installed_at timestamptz,
  uninstalled_at timestamptz,
  enabled_by uuid references public.tenant_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tenant_modules
  add column if not exists state text not null default 'installed',
  add column if not exists installed_at timestamptz,
  add column if not exists uninstalled_at timestamptz,
  add column if not exists enabled_by uuid references public.tenant_users(id),
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists ir_modules_application_active_idx
  on public.ir_modules (application, active, sequence, name);

create index if not exists ir_ui_menus_module_sequence_idx
  on public.ir_ui_menus (module_id, active, sequence, name);

create index if not exists ir_ui_menus_parent_sequence_idx
  on public.ir_ui_menus (parent_id, active, sequence, name);

create index if not exists tenant_modules_tenant_state_idx
  on public.tenant_modules (tenant_id, state);

insert into public.ir_modules (technical_name, name, icon, route_path, application, technical, active, sequence)
values
  ('products', 'Products', 'Package', '/app/products', true, false, true, 10),
  ('sales', 'Sales', 'FileText', '/app/sales', true, false, true, 20),
  ('accounting', 'Accounting', 'CreditCard', '/app/accounting', true, false, true, 30),
  ('inventory', 'Inventory', 'Warehouse', '/app/inventory', true, false, true, 40),
  ('pos', 'POS', 'ShoppingCart', '/app/pos', true, false, true, 50),
  ('partners', 'Partners', 'Handshake', '/app/partners', true, false, true, 60),
  ('contracts', 'Contracts', 'FileSignature', '/app/contracts', true, false, true, 70),
  ('team', 'Team', 'Users2', '/app/team', true, false, true, 80),
  ('settings', 'Settings', 'Settings', '/app/settings', true, false, true, 90)
on conflict (technical_name) do update
set
  name = excluded.name,
  icon = excluded.icon,
  route_path = excluded.route_path,
  application = excluded.application,
  technical = excluded.technical,
  active = excluded.active,
  sequence = excluded.sequence,
  updated_at = now();

update public.tenant_modules tenant_module
set state = 'installed', updated_at = now()
from public.ir_modules modules
where tenant_module.module_id = modules.id
  and modules.technical_name in ('products', 'sales', 'accounting', 'inventory', 'pos', 'partners', 'contracts', 'team', 'settings')
  and tenant_module.state <> 'installed';

insert into public.tenant_modules (tenant_id, module_id, state, installed_at)
select tenants.id, modules.id, 'installed'
from public.tenants tenants
cross join public.ir_modules modules
where modules.technical_name in ('products', 'sales', 'accounting', 'inventory', 'pos', 'partners', 'contracts', 'team', 'settings')
  and not exists (
    select 1
    from public.tenant_modules existing
    where existing.tenant_id = tenants.id
      and existing.module_id = modules.id
  );

with app_modules as (
  select id, technical_name from public.ir_modules
),
root_menus as (
  insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
  select id, null, name, code, route_path, icon, sequence, true
  from (
    values
      ('products', 'Products', 'products.root', '/app/products', 'Package', 10),
      ('sales', 'Sales', 'sales.root', '/app/sales', 'FileText', 10),
      ('accounting', 'Accounting', 'accounting.root', '/app/accounting', 'CreditCard', 10),
      ('inventory', 'Inventory', 'inventory.root', '/app/inventory', 'Warehouse', 10),
      ('pos', 'POS', 'pos.root', '/app/pos', 'ShoppingCart', 10),
      ('partners', 'Partners', 'partners.root', '/app/partners', 'Handshake', 10),
      ('contracts', 'Contracts', 'contracts.root', '/app/contracts', 'FileSignature', 10),
      ('team', 'Team', 'team.root', '/app/team', 'Users2', 10),
      ('settings', 'Settings', 'settings.root', '/app/settings', 'Settings', 10)
  ) as rows(module_code, name, code, route_path, icon, sequence)
  join app_modules on app_modules.technical_name = rows.module_code
  where not exists (
    select 1 from public.ir_ui_menus existing
    where existing.module_id = app_modules.id
      and existing.code = rows.code
  )
  returning id, module_id, code
)
update public.ir_ui_menus menu
set active = false, updated_at = now()
from app_modules
where menu.module_id = app_modules.id
  and app_modules.technical_name = 'products'
  and coalesce(menu.route_path, '') not in ('/app/products', '/app/products/attributes', '/app/products/attribute-values');

with app_modules as (
  select id, technical_name from public.ir_modules
),
root_menus as (
  select id, module_id, code from public.ir_ui_menus
)
insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
select app_modules.id, parent.id, rows.name, rows.code, rows.route_path, rows.icon, rows.sequence, true
from (
  values
    ('products', 'products.root', 'Attributes', 'products.attributes', '/app/products/attributes', 'ListFilter', 20),
    ('products', 'products.root', 'Attribute Values', 'products.attribute_values', '/app/products/attribute-values', 'Layers3', 30),
    ('sales', 'sales.root', 'Invoices', 'sales.invoices', '/app/sales/invoices', 'FilePlus2', 10),
    ('sales', 'sales.root', 'Contracts', 'sales.contracts', '/app/sales/contracts', 'FileSignature', 20),
    ('accounting', 'accounting.root', 'Journals', 'accounting.journals', '/app/accounting/journals', 'BookOpen', 10),
    ('accounting', 'accounting.root', 'Payments', 'accounting.payments', '/app/accounting/payments', 'CreditCard', 20),
    ('accounting', 'accounting.root', 'Accounts', 'accounting.accounts', '/app/accounting/accounts', 'Landmark', 30),
    ('accounting', 'accounting.root', 'Reports', 'accounting.reports', '/app/accounting/reports', 'BarChart3', 40),
    ('inventory', 'inventory.root', 'Stock', 'inventory.stock', '/app/inventory/stock', 'Boxes', 10),
    ('inventory', 'inventory.root', 'Serials', 'inventory.serials', '/app/inventory/serials', 'Hash', 20),
    ('inventory', 'inventory.root', 'Moves', 'inventory.moves', '/app/inventory/moves', 'ArrowDownToLine', 30),
    ('pos', 'pos.root', 'POS', 'pos.orders', '/app/pos', 'ShoppingCart', 10)
) as rows(module_code, parent_code, name, code, route_path, icon, sequence)
join app_modules on app_modules.technical_name = rows.module_code
join public.ir_ui_menus parent on parent.module_id = app_modules.id and parent.code = rows.parent_code
where not exists (
  select 1 from public.ir_ui_menus existing
  where existing.module_id = app_modules.id
    and existing.code = rows.code
);

alter table public.ir_modules enable row level security;
alter table public.ir_ui_menus enable row level security;
alter table public.tenant_modules enable row level security;

drop policy if exists ir_modules_select_active on public.ir_modules;
create policy ir_modules_select_active
on public.ir_modules
for select
to authenticated
using (active = true);

drop policy if exists ir_ui_menus_select_active on public.ir_ui_menus;
create policy ir_ui_menus_select_active
on public.ir_ui_menus
for select
to authenticated
using (active = true);

drop policy if exists tenant_modules_select_member on public.tenant_modules;
create policy tenant_modules_select_member
on public.tenant_modules
for select
to authenticated
using (public.is_tenant_member(tenant_id));

commit;
