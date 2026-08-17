-- Keep the products module as the user-facing Inventory application.
-- The legacy inventory module remains installed as a hidden technical dependency because
-- showroom/accounting RPCs still use its installation state as an inventory feature flag.
do $$
declare
  v_products_id uuid;
  v_legacy_inventory_id uuid;
  v_root_id uuid;
  v_products_group_id uuid;
  v_operations_group_id uuid;
  v_menu_id uuid;
  v_active_menu_count integer;
begin
  select id into v_products_id from public.ir_modules where technical_name = 'products';
  select id into v_legacy_inventory_id from public.ir_modules where technical_name = 'inventory';

  if v_products_id is null then
    raise exception 'The products module is required before inventory unification.';
  end if;

  update public.ir_modules
  set name = 'المخزون', icon = 'Warehouse', route_path = '/apps/inventory',
      application = true, technical = false, active = true, updated_at = now()
  where id = v_products_id;

  if v_legacy_inventory_id is not null then
    update public.ir_modules
    set name = 'Inventory Runtime (Legacy)', application = false, technical = true,
        active = true, installable = false, is_removable = false, updated_at = now()
    where id = v_legacy_inventory_id;

    -- Keep the visible application and its hidden runtime installed together.
    -- First, every tenant that had the old inventory app gets the retained products module.
    update public.tenant_modules target
    set state = 'installed', installed_at = coalesce(target.installed_at, now()),
        uninstalled_at = null, updated_at = now()
    where target.module_id = v_products_id
      and exists (select 1 from public.tenant_modules legacy where legacy.tenant_id = target.tenant_id and legacy.module_id = v_legacy_inventory_id and legacy.state = 'installed');

    insert into public.tenant_modules (tenant_id, module_id, state, installed_at, created_at, updated_at)
    select legacy.tenant_id, v_products_id, 'installed', coalesce(legacy.installed_at, now()), now(), now()
    from public.tenant_modules legacy
    where legacy.module_id = v_legacy_inventory_id and legacy.state = 'installed'
      and not exists (select 1 from public.tenant_modules target where target.tenant_id = legacy.tenant_id and target.module_id = v_products_id);

    -- Then, every tenant with the unified products application gets the inventory runtime.
    -- This also repairs an explicitly uninstalled runtime row without deleting or replacing it.
    update public.tenant_modules target
    set state = 'installed', installed_at = coalesce(target.installed_at, now()),
        uninstalled_at = null, updated_at = now()
    where target.module_id = v_legacy_inventory_id
      and exists (select 1 from public.tenant_modules visible where visible.tenant_id = target.tenant_id and visible.module_id = v_products_id and visible.state = 'installed');

    insert into public.tenant_modules (tenant_id, module_id, state, installed_at, created_at, updated_at)
    select visible.tenant_id, v_legacy_inventory_id, 'installed', coalesce(visible.installed_at, now()), now(), now()
    from public.tenant_modules visible
    where visible.module_id = v_products_id and visible.state = 'installed'
      and not exists (select 1 from public.tenant_modules target where target.tenant_id = visible.tenant_id and target.module_id = v_legacy_inventory_id);

    -- Preserve non-owner access: groups that granted the legacy app now grant the unified app.
    -- With the current allowed-module calculation, moving a group (including a technical
    -- permission such as inventory_complete_tracking_unit) may also grant access to the
    -- unified products application. Permission semantics are intentionally not redesigned here.
    update public.res_groups set module_id = v_products_id
    where module_id = v_legacy_inventory_id;

    update public.ir_ui_menus set active = false, updated_at = now()
    where module_id = v_legacy_inventory_id;
  end if;

  update public.ir_ui_menus set active = false, updated_at = now()
  where module_id = v_products_id;

  select id into v_root_id from public.ir_ui_menus
  where module_id = v_products_id and code = 'products.root' order by created_at limit 1;
  if v_root_id is null then
    insert into public.ir_ui_menus (module_id, parent_id, name, code, route_path, icon, sequence, active)
    values (v_products_id, null, 'المخزون', 'products.root', '/apps/inventory', 'Warehouse', 10, true)
    returning id into v_root_id;
  else
    update public.ir_ui_menus set parent_id = null, name = 'المخزون', route_path = '/apps/inventory',
      icon = 'Warehouse', sequence = 10, active = true, updated_at = now() where id = v_root_id;
  end if;

  select id into v_menu_id from public.ir_ui_menus where module_id = v_products_id and code = 'inventory.overview' order by created_at limit 1;
  if v_menu_id is null then insert into public.ir_ui_menus (module_id,parent_id,name,code,route_path,icon,sequence,active) values (v_products_id,v_root_id,'نظرة عامة','inventory.overview','/apps/inventory','LayoutDashboard',10,true);
  else update public.ir_ui_menus set parent_id=v_root_id,name='نظرة عامة',route_path='/apps/inventory',icon='LayoutDashboard',sequence=10,active=true,updated_at=now() where id=v_menu_id; end if;

  select id into v_products_group_id from public.ir_ui_menus where module_id = v_products_id and code = 'inventory.products_group' order by created_at limit 1;
  if v_products_group_id is null then insert into public.ir_ui_menus (module_id,parent_id,name,code,route_path,icon,sequence,active) values (v_products_id,v_root_id,'المنتجات','inventory.products_group',null,'Package',20,true) returning id into v_products_group_id;
  else update public.ir_ui_menus set parent_id=v_root_id,name='المنتجات',route_path=null,icon='Package',sequence=20,active=true,updated_at=now() where id=v_products_group_id; end if;

  select id into v_menu_id from public.ir_ui_menus where module_id=v_products_id and code='inventory.products' order by created_at limit 1;
  if v_menu_id is null then insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active) values(v_products_id,v_products_group_id,'المنتجات','inventory.products','/apps/inventory/products','Package',10,true);
  else update public.ir_ui_menus set parent_id=v_products_group_id,name='المنتجات',route_path='/apps/inventory/products',icon='Package',sequence=10,active=true,updated_at=now() where id=v_menu_id; end if;

  select id into v_menu_id from public.ir_ui_menus where module_id=v_products_id and code='products.attributes' order by created_at limit 1;
  if v_menu_id is null then insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active) values(v_products_id,v_products_group_id,'الخصائص','products.attributes','/apps/inventory/products/attributes','ListFilter',20,true);
  else update public.ir_ui_menus set parent_id=v_products_group_id,name='الخصائص',route_path='/apps/inventory/products/attributes',icon='ListFilter',sequence=20,active=true,updated_at=now() where id=v_menu_id; end if;

  select id into v_menu_id from public.ir_ui_menus where module_id=v_products_id and code='products.tracking_identifiers' order by created_at limit 1;
  if v_menu_id is null then insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active) values(v_products_id,v_products_group_id,'تعريفات التتبع','products.tracking_identifiers','/apps/inventory/products/tracking-identifiers','ScanLine',30,true);
  else update public.ir_ui_menus set parent_id=v_products_group_id,name='تعريفات التتبع',route_path='/apps/inventory/products/tracking-identifiers',icon='ScanLine',sequence=30,active=true,updated_at=now() where id=v_menu_id; end if;

  select id into v_menu_id from public.ir_ui_menus where module_id=v_products_id and code='inventory.stock' order by created_at limit 1;
  if v_menu_id is null then insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active) values(v_products_id,v_products_group_id,'أرصدة المخزون','inventory.stock','/apps/inventory/stock','Boxes',40,true);
  else update public.ir_ui_menus set parent_id=v_products_group_id,name='أرصدة المخزون',route_path='/apps/inventory/stock',icon='Boxes',sequence=40,active=true,updated_at=now() where id=v_menu_id; end if;

  select id into v_menu_id from public.ir_ui_menus where module_id=v_products_id and code='inventory.unique_units' order by created_at limit 1;
  if v_menu_id is null then insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active) values(v_products_id,v_root_id,'القطع الفريدة','inventory.unique_units','/apps/inventory/unique-units','Hash',30,true);
  else update public.ir_ui_menus set parent_id=v_root_id,name='القطع الفريدة',route_path='/apps/inventory/unique-units',icon='Hash',sequence=30,active=true,updated_at=now() where id=v_menu_id; end if;

  select id into v_operations_group_id from public.ir_ui_menus where module_id=v_products_id and code='inventory.operations_group' order by created_at limit 1;
  if v_operations_group_id is null then insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active) values(v_products_id,v_root_id,'العمليات','inventory.operations_group',null,'Workflow',40,true) returning id into v_operations_group_id;
  else update public.ir_ui_menus set parent_id=v_root_id,name='العمليات',route_path=null,icon='Workflow',sequence=40,active=true,updated_at=now() where id=v_operations_group_id; end if;

  select id into v_menu_id from public.ir_ui_menus where module_id=v_products_id and code='inventory.moves' order by created_at limit 1;
  if v_menu_id is null then insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active) values(v_products_id,v_operations_group_id,'حركات المخزون','inventory.moves','/apps/inventory/operations/moves','ArrowDownToLine',10,true);
  else update public.ir_ui_menus set parent_id=v_operations_group_id,name='حركات المخزون',route_path='/apps/inventory/operations/moves',icon='ArrowDownToLine',sequence=10,active=true,updated_at=now() where id=v_menu_id; end if;

  select id into v_menu_id from public.ir_ui_menus where module_id=v_products_id and code='inventory.locations' order by created_at limit 1;
  if v_menu_id is null then insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active) values(v_products_id,v_operations_group_id,'المواقع','inventory.locations','/apps/inventory/operations/locations','MapPin',20,true);
  else update public.ir_ui_menus set parent_id=v_operations_group_id,name='المواقع',route_path='/apps/inventory/operations/locations',icon='MapPin',sequence=20,active=true,updated_at=now() where id=v_menu_id; end if;

  select id into v_menu_id from public.ir_ui_menus where module_id=v_products_id and code='inventory.counts' order by created_at limit 1;
  if v_menu_id is null then insert into public.ir_ui_menus(module_id,parent_id,name,code,route_path,icon,sequence,active) values(v_products_id,v_operations_group_id,'الجرد','inventory.counts','/apps/inventory/operations/counts','ClipboardCheck',30,true);
  else update public.ir_ui_menus set parent_id=v_operations_group_id,name='الجرد',route_path='/apps/inventory/operations/counts',icon='ClipboardCheck',sequence=30,active=true,updated_at=now() where id=v_menu_id; end if;

  -- Post-migration assertions: fail the statement atomically if the unified application,
  -- runtime pairing, permissions ownership, or active menu tree is inconsistent.
  if not exists (
    select 1 from public.ir_modules
    where id = v_products_id and technical_name = 'products' and active = true
      and application = true and technical = false and name = 'المخزون'
      and route_path = '/apps/inventory' and icon = 'Warehouse'
  ) then
    raise exception 'Inventory unification assertion failed: products is not the visible Inventory application.';
  end if;

  if v_legacy_inventory_id is null or not exists (
    select 1 from public.ir_modules
    where id = v_legacy_inventory_id and technical_name = 'inventory' and active = true
      and application = false and technical = true and installable = false and is_removable = false
  ) then
    raise exception 'Inventory unification assertion failed: inventory runtime is missing or not protected.';
  end if;

  if exists (
    select 1
    from public.tenant_modules visible
    where visible.module_id = v_products_id and visible.state = 'installed'
      and not exists (
        select 1 from public.tenant_modules runtime
        where runtime.tenant_id = visible.tenant_id
          and runtime.module_id = v_legacy_inventory_id and runtime.state = 'installed'
      )
  ) then
    raise exception 'Inventory unification assertion failed: a products tenant is missing the inventory runtime.';
  end if;

  if exists (
    select 1
    from public.tenant_modules runtime
    where runtime.module_id = v_legacy_inventory_id and runtime.state = 'installed'
      and not exists (
        select 1 from public.tenant_modules visible
        where visible.tenant_id = runtime.tenant_id
          and visible.module_id = v_products_id and visible.state = 'installed'
      )
  ) then
    raise exception 'Inventory unification assertion failed: an inventory runtime tenant is missing products.';
  end if;

  if exists (select 1 from public.res_groups where module_id = v_legacy_inventory_id) then
    raise exception 'Inventory unification assertion failed: permission groups remain assigned to inventory runtime.';
  end if;

  if exists (select 1 from public.ir_ui_menus where module_id = v_legacy_inventory_id and active = true) then
    raise exception 'Inventory unification assertion failed: a legacy inventory menu remains active.';
  end if;

  if exists (
    select 1 from public.ir_ui_menus
    where module_id = v_products_id and active = true
      and (
        code is null or code not in (
          'products.root', 'inventory.overview', 'inventory.products_group', 'inventory.products',
          'products.attributes', 'products.tracking_identifiers', 'inventory.stock',
          'inventory.unique_units', 'inventory.operations_group', 'inventory.moves',
          'inventory.locations', 'inventory.counts'
        )
      )
  ) then
    raise exception 'Inventory unification assertion failed: a legacy products or attribute-values menu remains active.';
  end if;

  select count(*) into v_active_menu_count
  from public.ir_ui_menus
  where module_id = v_products_id and active = true
    and code in (
      'products.root', 'inventory.overview', 'inventory.products_group', 'inventory.products',
      'products.attributes', 'products.tracking_identifiers', 'inventory.stock',
      'inventory.unique_units', 'inventory.operations_group', 'inventory.moves',
      'inventory.locations', 'inventory.counts'
    );

  if v_active_menu_count <> 12 then
    raise exception 'Inventory unification assertion failed: the unified active menu tree is incomplete or duplicated.';
  end if;

  if exists (
    select 1 from public.ir_ui_menus
    where module_id = v_products_id and active = true and (
      (code = 'products.root' and (parent_id is not null or name <> 'المخزون' or route_path is distinct from '/apps/inventory'))
      or (code = 'inventory.overview' and (parent_id is distinct from v_root_id or route_path is distinct from '/apps/inventory'))
      or (code = 'inventory.products_group' and (parent_id is distinct from v_root_id or route_path is not null))
      or (code = 'inventory.products' and (parent_id is distinct from v_products_group_id or route_path is distinct from '/apps/inventory/products'))
      or (code = 'products.attributes' and (parent_id is distinct from v_products_group_id or route_path is distinct from '/apps/inventory/products/attributes'))
      or (code = 'products.tracking_identifiers' and (parent_id is distinct from v_products_group_id or route_path is distinct from '/apps/inventory/products/tracking-identifiers'))
      or (code = 'inventory.stock' and (parent_id is distinct from v_products_group_id or route_path is distinct from '/apps/inventory/stock'))
      or (code = 'inventory.unique_units' and (parent_id is distinct from v_root_id or route_path is distinct from '/apps/inventory/unique-units'))
      or (code = 'inventory.operations_group' and (parent_id is distinct from v_root_id or route_path is not null))
      or (code = 'inventory.moves' and (parent_id is distinct from v_operations_group_id or route_path is distinct from '/apps/inventory/operations/moves'))
      or (code = 'inventory.locations' and (parent_id is distinct from v_operations_group_id or route_path is distinct from '/apps/inventory/operations/locations'))
      or (code = 'inventory.counts' and (parent_id is distinct from v_operations_group_id or route_path is distinct from '/apps/inventory/operations/counts'))
    )
  ) then
    raise exception 'Inventory unification assertion failed: the unified menu hierarchy or routes are invalid.';
  end if;
end $$;
