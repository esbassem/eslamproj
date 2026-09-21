begin;

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
  'accountant_app',
  'المحاسب',
  'التحصيلات والتوريدات وحركة الحسابات',
  'واجهة المحاسب التشغيلية لمتابعة النقدية والذمم والحسابات.',
  'Accounting',
  'Receipt',
  '#0F766E',
  '/apps/accountant',
  true,
  false,
  true,
  true,
  'uninstalled',
  true,
  34
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
  active = excluded.active,
  sequence = excluded.sequence,
  updated_at = now();

insert into public.auth_permissions (
  code,
  name,
  description,
  resource,
  action,
  active,
  permission_type,
  module_code,
  sort_order
)
values (
  'accountant_app.access',
  'فتح تطبيق المحاسب',
  'صلاحية عامة لفتح واستخدام تطبيق المحاسب.',
  'accountant_app',
  'access',
  true,
  'app_access',
  'accountant_app',
  10
)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  resource = excluded.resource,
  action = excluded.action,
  active = excluded.active,
  permission_type = excluded.permission_type,
  module_code = excluded.module_code,
  sort_order = excluded.sort_order,
  updated_at = now();

-- This tenant is the known local workspace that previously used the Accountant
-- UI. Matching both its stable id and name prevents installation in test or
-- unrelated tenants. Other tenants retain their existing installation state.
insert into public.tenant_modules (tenant_id, module_id, state, installed_at)
select tenant.id, module.id, 'installed', now()
from public.tenants tenant
cross join public.ir_modules module
where tenant.id = '4ee5f357-8cf5-4770-8772-64de99532dac'::uuid
  and tenant.name = 'معرض الوكيل حلوان'
  and module.technical_name = 'accountant_app'
on conflict (tenant_id, module_id) do update
set
  state = 'installed',
  installed_at = coalesce(public.tenant_modules.installed_at, excluded.installed_at),
  uninstalled_at = null,
  updated_at = now();

do $$
declare
  accountant_module_id uuid;
  root_menu_id uuid;
  payments_menu_id uuid;
begin
  select id into strict accountant_module_id
  from public.ir_modules
  where technical_name = 'accountant_app';

  select id into root_menu_id
  from public.ir_ui_menus
  where module_id = accountant_module_id
    and code = 'accountant_app.root'
  order by created_at, id
  limit 1;

  if root_menu_id is null then
    insert into public.ir_ui_menus (
      module_id, parent_id, name, code, route_path, icon, sequence, active
    )
    values (
      accountant_module_id, null, 'المحاسب', 'accountant_app.root',
      '/apps/accountant', 'Receipt', 10, true
    )
    returning id into root_menu_id;
  else
    update public.ir_ui_menus
    set parent_id = null,
        name = 'المحاسب',
        route_path = '/apps/accountant',
        icon = 'Receipt',
        sequence = 10,
        active = true,
        updated_at = now()
    where id = root_menu_id;
  end if;

  select id into payments_menu_id
  from public.ir_ui_menus
  where module_id = accountant_module_id
    and code = 'accountant_app.payments'
  order by created_at, id
  limit 1;

  if payments_menu_id is null then
    insert into public.ir_ui_menus (
      module_id, parent_id, name, code, route_path, icon, sequence, active
    )
    values (
      accountant_module_id, root_menu_id, 'التحصيلات والتوريدات',
      'accountant_app.payments', '/apps/accountant/payments', 'Receipt', 10, true
    )
    returning id into payments_menu_id;
  else
    update public.ir_ui_menus
    set parent_id = root_menu_id,
        name = 'التحصيلات والتوريدات',
        route_path = '/apps/accountant/payments',
        icon = 'Receipt',
        sequence = 10,
        active = true,
        updated_at = now()
    where id = payments_menu_id;
  end if;

  -- Earlier menu registration had no uniqueness constraint. Collapse only
  -- duplicate Accountant menu identities, preserving the canonical rows above.
  update public.ir_ui_menus
  set parent_id = root_menu_id,
      updated_at = now()
  where module_id = accountant_module_id
    and parent_id in (
      select id
      from public.ir_ui_menus
      where module_id = accountant_module_id
        and code = 'accountant_app.root'
        and id <> root_menu_id
    );

  delete from public.ir_ui_menus
  where module_id = accountant_module_id
    and code = 'accountant_app.payments'
    and id <> payments_menu_id;

  delete from public.ir_ui_menus
  where module_id = accountant_module_id
    and code = 'accountant_app.root'
    and id <> root_menu_id;
end
$$;

do $$
declare
  accountant_module_id uuid;
begin
  select id into strict accountant_module_id
  from public.ir_modules
  where technical_name = 'accountant_app';

  if (select count(*) from public.ir_modules where technical_name = 'accountant_app') <> 1 then
    raise exception 'Accountant registration assertion failed: module identity';
  end if;

  if not exists (
    select 1 from public.ir_modules
    where id = accountant_module_id
      and name = 'المحاسب'
      and route_path = '/apps/accountant'
      and application and not technical and installable and active
  ) then
    raise exception 'Accountant registration assertion failed: module metadata';
  end if;

  if (select count(*) from public.ir_ui_menus where module_id = accountant_module_id and code = 'accountant_app.root') <> 1
     or (select count(*) from public.ir_ui_menus where module_id = accountant_module_id and code = 'accountant_app.payments') <> 1 then
    raise exception 'Accountant registration assertion failed: menu identities';
  end if;

  if not exists (
    select 1
    from public.ir_ui_menus child
    join public.ir_ui_menus root on root.id = child.parent_id
    where root.module_id = accountant_module_id
      and root.code = 'accountant_app.root'
      and root.route_path = '/apps/accountant'
      and child.module_id = accountant_module_id
      and child.code = 'accountant_app.payments'
      and child.route_path = '/apps/accountant/payments'
      and root.active and child.active
  ) then
    raise exception 'Accountant registration assertion failed: menu relationship';
  end if;

  if (select count(*) from public.auth_permissions where code = 'accountant_app.access') <> 1 then
    raise exception 'Accountant registration assertion failed: access permission';
  end if;

  if exists (
    select 1
    from public.tenants tenant
    where tenant.id = '4ee5f357-8cf5-4770-8772-64de99532dac'::uuid
      and tenant.name = 'معرض الوكيل حلوان'
  ) and not exists (
    select 1
    from public.tenant_modules tenant_module
    where tenant_module.tenant_id = '4ee5f357-8cf5-4770-8772-64de99532dac'::uuid
      and tenant_module.module_id = accountant_module_id
      and tenant_module.state = 'installed'
  ) then
    raise exception 'Accountant registration assertion failed: known local tenant installation';
  end if;
end
$$;

commit;
