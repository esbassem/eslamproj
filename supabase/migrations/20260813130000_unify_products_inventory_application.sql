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
        active = true, updated_at = now()
    where id = v_legacy_inventory_id;

    -- Every tenant that had the old inventory app gets the retained products module.
    update public.tenant_modules target
    set state = 'installed', uninstalled_at = null, updated_at = now()
    where target.module_id = v_products_id
      and exists (select 1 from public.tenant_modules legacy where legacy.tenant_id = target.tenant_id and legacy.module_id = v_legacy_inventory_id and legacy.state = 'installed');

    insert into public.tenant_modules (tenant_id, module_id, state, installed_at, created_at, updated_at)
    select legacy.tenant_id, v_products_id, 'installed', coalesce(legacy.installed_at, now()), now(), now()
    from public.tenant_modules legacy
    where legacy.module_id = v_legacy_inventory_id and legacy.state = 'installed'
      and not exists (select 1 from public.tenant_modules target where target.tenant_id = legacy.tenant_id and target.module_id = v_products_id);

    -- Preserve non-owner access: groups that granted the legacy app now grant the unified app.
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
end $$;
