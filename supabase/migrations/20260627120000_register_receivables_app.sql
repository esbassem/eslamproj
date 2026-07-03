begin;

create extension if not exists pgcrypto;

alter table public.ir_modules
  add column if not exists description text,
  add column if not exists summary text,
  add column if not exists category text,
  add column if not exists state text not null default 'uninstalled',
  add column if not exists icon_color text,
  add column if not exists installable boolean not null default true,
  add column if not exists is_removable boolean not null default true;

create table if not exists public.res_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  module_id uuid references public.ir_modules(id) on delete cascade,
  name text not null,
  code text not null,
  description text,
  category text,
  is_system boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.res_groups
  add column if not exists tenant_id uuid references public.tenants(id) on delete cascade,
  add column if not exists module_id uuid references public.ir_modules(id) on delete cascade,
  add column if not exists description text,
  add column if not exists category text,
  add column if not exists is_system boolean not null default true,
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists res_groups_tenant_code_key
  on public.res_groups (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), code);

create table if not exists public.res_users_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references public.tenant_users(id) on delete cascade,
  group_id uuid not null references public.res_groups(id) on delete cascade,
  created_at timestamptz not null default now()
);

create unique index if not exists res_users_groups_tenant_user_group_key
  on public.res_users_groups (tenant_id, user_id, group_id);

create table if not exists public.ir_model_access (
  id uuid primary key default gen_random_uuid(),
  module_id uuid references public.ir_modules(id) on delete cascade,
  group_id uuid references public.res_groups(id) on delete cascade,
  model_name text not null,
  perm_read boolean not null default false,
  perm_create boolean not null default false,
  perm_write boolean not null default false,
  perm_unlink boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ir_model_access_group_model_key
  on public.ir_model_access (group_id, model_name);

insert into public.ir_modules (
  technical_name,
  name,
  summary,
  description,
  category,
  icon,
  icon_color,
  route_path,
  application,
  technical,
  installable,
  is_removable,
  state,
  active,
  sequence
)
values (
  'receivables',
  'المديونيات',
  'إدارة المديونيات والاستحقاقات',
  'إدارة رأس المديونية والاستحقاقات والأحداث الإدارية لكل عميل أو طرف.',
  'Accounting',
  'WalletCards',
  '#0F766E',
  '/app/receivables',
  true,
  false,
  true,
  true,
  'uninstalled',
  true,
  35
)
on conflict (technical_name) do update
set
  name = excluded.name,
  summary = excluded.summary,
  description = excluded.description,
  category = excluded.category,
  icon = excluded.icon,
  icon_color = excluded.icon_color,
  route_path = excluded.route_path,
  application = excluded.application,
  technical = excluded.technical,
  installable = excluded.installable,
  is_removable = excluded.is_removable,
  state = excluded.state,
  active = excluded.active,
  sequence = excluded.sequence,
  updated_at = now();

with app_module as (
  select id
  from public.ir_modules
  where technical_name = 'receivables'
),
root_menu as (
  insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
  select id, null, 'المديونيات', 'receivables.all', '/app/receivables', 'WalletCards', 10, true
  from app_module
  where not exists (
    select 1
    from public.ir_ui_menus existing
    where existing.module_id = app_module.id
      and existing.code = 'receivables.all'
  )
  returning id, module_id
),
resolved_root_menu as (
  select id, module_id from root_menu
  union all
  select menu.id, menu.module_id
  from public.ir_ui_menus menu
  join app_module on app_module.id = menu.module_id
  where menu.code = 'receivables.all'
  limit 1
)
insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
select resolved_root_menu.module_id, resolved_root_menu.id, 'الاستحقاقات', 'receivables.installments', '/app/receivables/installments', 'CalendarClock', 20, true
from resolved_root_menu
where not exists (
  select 1
  from public.ir_ui_menus existing
  where existing.module_id = resolved_root_menu.module_id
    and existing.code = 'receivables.installments'
);

update public.ir_ui_menus
set name = 'كل المديونيات', route_path = '/app/receivables', icon = 'WalletCards', active = true, updated_at = now()
where code = 'receivables.all';

update public.ir_ui_menus
set name = 'الاستحقاقات', route_path = '/app/receivables/installments', icon = 'CalendarClock', active = true, updated_at = now()
where code = 'receivables.installments';

with app_module as (
  select id from public.ir_modules where technical_name = 'receivables'
)
insert into public.res_groups (tenant_id, module_id, name, code, description, category, is_system, active)
select null, app_module.id, rows.name, rows.code, rows.description, 'Accounting', true, true
from app_module
cross join (
  values
    ('Receivables User', 'receivables_user', 'صلاحية قراءة فقط لتطبيق المديونيات.'),
    ('Receivables Manager', 'receivables_manager', 'صلاحية قراءة وإنشاء وتعديل لتطبيق المديونيات بدون حذف.')
) as rows(name, code, description)
where not exists (
  select 1
  from public.res_groups existing
  where existing.tenant_id is null
    and existing.code = rows.code
);

with app_module as (
  select id from public.ir_modules where technical_name = 'receivables'
),
rows as (
  select *
  from (
    values
      ('Receivables User', 'receivables_user', 'صلاحية قراءة فقط لتطبيق المديونيات.'),
      ('Receivables Manager', 'receivables_manager', 'صلاحية قراءة وإنشاء وتعديل لتطبيق المديونيات بدون حذف.')
  ) as values_table(name, code, description)
)
update public.res_groups target
set
  module_id = app_module.id,
  name = rows.name,
  description = rows.description,
  category = 'Accounting',
  is_system = true,
  active = true,
  updated_at = now()
from app_module, rows
where target.tenant_id is null
  and target.code = rows.code;

with app_module as (
  select id from public.ir_modules where technical_name = 'receivables'
),
groups as (
  select id, code
  from public.res_groups
  where code in ('receivables_user', 'receivables_manager')
    and tenant_id is null
),
access_rows as (
  select groups.id as group_id, model_name, true as perm_read,
    (groups.code = 'receivables_manager') as perm_create,
    (groups.code = 'receivables_manager') as perm_write,
    false as perm_unlink
  from groups
  cross join (
    values
      ('receivables'),
      ('receivable_installments'),
      ('receivable_events')
  ) as models(model_name)
)
insert into public.ir_model_access (module_id, group_id, model_name, perm_read, perm_create, perm_write, perm_unlink, active)
select app_module.id, access_rows.group_id, access_rows.model_name, access_rows.perm_read, access_rows.perm_create, access_rows.perm_write, access_rows.perm_unlink, true
from app_module
cross join access_rows
on conflict (group_id, model_name) do update
set
  module_id = excluded.module_id,
  perm_read = excluded.perm_read,
  perm_create = excluded.perm_create,
  perm_write = excluded.perm_write,
  perm_unlink = excluded.perm_unlink,
  active = excluded.active,
  updated_at = now();

create or replace function public.has_receivables_group(p_tenant_id uuid, p_group_codes text[])
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tenant_user
    where tenant_user.tenant_id = p_tenant_id
      and tenant_user.auth_user_id = auth.uid()
      and tenant_user.is_active = true
      and tenant_user.role = 'owner'
  )
  or exists (
    select 1
    from public.tenant_users tenant_user
    join public.res_users_groups membership
      on membership.tenant_id = tenant_user.tenant_id
     and membership.user_id = tenant_user.id
    join public.res_groups app_group
      on app_group.id = membership.group_id
    where tenant_user.tenant_id = p_tenant_id
      and tenant_user.auth_user_id = auth.uid()
      and tenant_user.is_active = true
      and app_group.active = true
      and app_group.code = any(p_group_codes)
      and (app_group.tenant_id is null or app_group.tenant_id = p_tenant_id)
  );
$$;

alter table public.receivables enable row level security;
alter table public.receivable_installments enable row level security;
alter table public.receivable_events enable row level security;
alter table public.res_groups enable row level security;
alter table public.res_users_groups enable row level security;
alter table public.ir_model_access enable row level security;

drop policy if exists receivables_select_receivables_groups on public.receivables;
create policy receivables_select_receivables_groups
on public.receivables
for select
to authenticated
using (public.has_receivables_group(tenant_id, array['receivables_user', 'receivables_manager']));

drop policy if exists receivables_insert_receivables_manager on public.receivables;
create policy receivables_insert_receivables_manager
on public.receivables
for insert
to authenticated
with check (public.has_receivables_group(tenant_id, array['receivables_manager']));

drop policy if exists receivables_update_receivables_manager on public.receivables;
create policy receivables_update_receivables_manager
on public.receivables
for update
to authenticated
using (public.has_receivables_group(tenant_id, array['receivables_manager']))
with check (public.has_receivables_group(tenant_id, array['receivables_manager']));

drop policy if exists receivable_installments_select_receivables_groups on public.receivable_installments;
create policy receivable_installments_select_receivables_groups
on public.receivable_installments
for select
to authenticated
using (public.has_receivables_group(tenant_id, array['receivables_user', 'receivables_manager']));

drop policy if exists receivable_installments_insert_receivables_manager on public.receivable_installments;
create policy receivable_installments_insert_receivables_manager
on public.receivable_installments
for insert
to authenticated
with check (public.has_receivables_group(tenant_id, array['receivables_manager']));

drop policy if exists receivable_installments_update_receivables_manager on public.receivable_installments;
create policy receivable_installments_update_receivables_manager
on public.receivable_installments
for update
to authenticated
using (public.has_receivables_group(tenant_id, array['receivables_manager']))
with check (public.has_receivables_group(tenant_id, array['receivables_manager']));

drop policy if exists receivable_events_select_receivables_groups on public.receivable_events;
create policy receivable_events_select_receivables_groups
on public.receivable_events
for select
to authenticated
using (public.has_receivables_group(tenant_id, array['receivables_user', 'receivables_manager']));

drop policy if exists receivable_events_insert_receivables_manager on public.receivable_events;
create policy receivable_events_insert_receivables_manager
on public.receivable_events
for insert
to authenticated
with check (public.has_receivables_group(tenant_id, array['receivables_manager']));

drop policy if exists res_groups_select_member on public.res_groups;
create policy res_groups_select_member
on public.res_groups
for select
to authenticated
using (tenant_id is null or public.is_tenant_member(tenant_id));

drop policy if exists res_users_groups_select_member on public.res_users_groups;
create policy res_users_groups_select_member
on public.res_users_groups
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists res_users_groups_insert_owner on public.res_users_groups;
create policy res_users_groups_insert_owner
on public.res_users_groups
for insert
to authenticated
with check (public.is_tenant_owner(tenant_id));

drop policy if exists res_users_groups_delete_owner on public.res_users_groups;
create policy res_users_groups_delete_owner
on public.res_users_groups
for delete
to authenticated
using (public.is_tenant_owner(tenant_id));

drop policy if exists ir_model_access_select_authenticated on public.ir_model_access;
create policy ir_model_access_select_authenticated
on public.ir_model_access
for select
to authenticated
using (active = true);

commit;
