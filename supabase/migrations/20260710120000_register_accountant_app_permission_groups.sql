with app_module as (
  select id
  from public.ir_modules
  where technical_name = 'accountant_app'
)
insert into public.res_groups (tenant_id, module_id, name, code, description, category, is_system, active)
select null, app_module.id, rows.name, rows.code, rows.description, 'Accounting', true, true
from app_module
cross join (
  values
    ('مستخدم المحاسب', 'accountant_app_user', 'صلاحية استخدام تطبيق المحاسب.'),
    ('مدير المحاسب', 'accountant_app_manager', 'صلاحية إدارة عمليات تطبيق المحاسب.')
) as rows(name, code, description)
where not exists (
  select 1
  from public.res_groups existing
  where existing.tenant_id is null
    and existing.code = rows.code
);

with app_module as (
  select id
  from public.ir_modules
  where technical_name = 'accountant_app'
),
rows as (
  select *
  from (
    values
      ('مستخدم المحاسب', 'accountant_app_user', 'صلاحية استخدام تطبيق المحاسب.'),
      ('مدير المحاسب', 'accountant_app_manager', 'صلاحية إدارة عمليات تطبيق المحاسب.')
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
