begin;

with accountant_module as (
  select id
  from public.ir_modules
  where technical_name = 'accountant_app'
),
permission_groups(name, code, description) as (
  values
    ('مستخدم المحاسب', 'accountant_app_user', 'صلاحية استخدام تطبيق المحاسب.'),
    ('مدير المحاسب', 'accountant_app_manager', 'صلاحية إدارة عمليات تطبيق المحاسب.')
)
insert into public.res_groups (
  tenant_id,
  module_id,
  name,
  code,
  description,
  category,
  is_system,
  active
)
select
  null,
  accountant_module.id,
  permission_groups.name,
  permission_groups.code,
  permission_groups.description,
  'Accounting',
  true,
  true
from accountant_module
cross join permission_groups
where not exists (
  select 1
  from public.res_groups existing
  where existing.tenant_id is null
    and existing.code = permission_groups.code
);

-- Repair both global and tenant-specific copies without deleting memberships.
with accountant_module as (
  select id
  from public.ir_modules
  where technical_name = 'accountant_app'
),
permission_groups(name, code, description) as (
  values
    ('مستخدم المحاسب', 'accountant_app_user', 'صلاحية استخدام تطبيق المحاسب.'),
    ('مدير المحاسب', 'accountant_app_manager', 'صلاحية إدارة عمليات تطبيق المحاسب.')
)
update public.res_groups target
set
  module_id = accountant_module.id,
  name = permission_groups.name,
  description = permission_groups.description,
  category = 'Accounting',
  is_system = true,
  active = true,
  updated_at = now()
from accountant_module, permission_groups
where target.code = permission_groups.code
   or target.name = permission_groups.name;

commit;
