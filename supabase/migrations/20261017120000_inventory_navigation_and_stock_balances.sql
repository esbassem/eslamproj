begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Inventory uses the global module/menu catalog. Tenant installation remains in
-- tenant_modules; this migration only aligns the shared Inventory tree.
do $$
declare
  v_module_id uuid;
  v_root_id uuid;
  v_stock_group_id uuid;
  v_operations_group_id uuid;
  v_configuration_group_id uuid;
  v_menu_id uuid;
begin
  select id into v_module_id
  from public.ir_modules
  where technical_name = 'products';

  if v_module_id is null then
    raise exception 'Visible Inventory application module (products) was not found';
  end if;

  select id into v_root_id
  from public.ir_ui_menus
  where module_id = v_module_id and code = 'products.root'
  order by created_at
  limit 1;

  if v_root_id is null then
    insert into public.ir_ui_menus (
      module_id, parent_id, name, code, route_path, icon, sequence, active
    ) values (
      v_module_id, null, 'المخزون', 'products.root', '/apps/inventory', 'Warehouse', 10, true
    ) returning id into v_root_id;
  else
    update public.ir_ui_menus
    set parent_id = null, name = 'المخزون', route_path = '/apps/inventory',
        icon = 'Warehouse', sequence = 10, active = true, updated_at = now()
    where id = v_root_id;
  end if;

  select id into v_stock_group_id
  from public.ir_ui_menus
  where module_id = v_module_id and code = 'inventory.stock_group'
  order by created_at
  limit 1;
  if v_stock_group_id is null then
    insert into public.ir_ui_menus (
      module_id, parent_id, name, code, route_path, icon, sequence, active
    ) values (
      v_module_id, v_root_id, 'المخزون', 'inventory.stock_group', null, 'Boxes', 20, true
    ) returning id into v_stock_group_id;
  else
    update public.ir_ui_menus
    set parent_id = v_root_id, name = 'المخزون', route_path = null,
        icon = 'Boxes', sequence = 20, active = true, updated_at = now()
    where id = v_stock_group_id;
  end if;

  select id into v_operations_group_id
  from public.ir_ui_menus
  where module_id = v_module_id and code = 'inventory.operations_group'
  order by created_at
  limit 1;
  if v_operations_group_id is null then
    insert into public.ir_ui_menus (
      module_id, parent_id, name, code, route_path, icon, sequence, active
    ) values (
      v_module_id, v_root_id, 'العمليات', 'inventory.operations_group', null, 'Workflow', 30, true
    ) returning id into v_operations_group_id;
  else
    update public.ir_ui_menus
    set parent_id = v_root_id, name = 'العمليات', route_path = null,
        icon = 'Workflow', sequence = 30, active = true, updated_at = now()
    where id = v_operations_group_id;
  end if;

  select id into v_configuration_group_id
  from public.ir_ui_menus
  where module_id = v_module_id and code = 'inventory.configuration_group'
  order by created_at
  limit 1;
  if v_configuration_group_id is null then
    insert into public.ir_ui_menus (
      module_id, parent_id, name, code, route_path, icon, sequence, active
    ) values (
      v_module_id, v_root_id, 'التهيئة', 'inventory.configuration_group', null, 'Settings2', 40, true
    ) returning id into v_configuration_group_id;
  else
    update public.ir_ui_menus
    set parent_id = v_root_id, name = 'التهيئة', route_path = null,
        icon = 'Settings2', sequence = 40, active = true, updated_at = now()
    where id = v_configuration_group_id;
  end if;

  -- Overview.
  update public.ir_ui_menus
  set parent_id = v_root_id, name = 'نظرة عامة', route_path = '/apps/inventory',
      icon = 'LayoutDashboard', sequence = 10, active = true, updated_at = now()
  where module_id = v_module_id and code = 'inventory.overview';

  -- Stock workspace.
  update public.ir_ui_menus
  set parent_id = v_stock_group_id, name = 'أرصدة المخزون',
      route_path = '/apps/inventory/stock', icon = 'Boxes', sequence = 10,
      active = true, updated_at = now()
  where module_id = v_module_id and code = 'inventory.stock';

  update public.ir_ui_menus
  set parent_id = v_stock_group_id, name = 'الوحدات المتسلسلة',
      route_path = '/apps/inventory/unique-units', icon = 'Hash', sequence = 20,
      active = true, updated_at = now()
  where module_id = v_module_id and code = 'inventory.unique_units';

  update public.ir_ui_menus
  set parent_id = v_stock_group_id, name = 'حركات المخزون',
      route_path = '/apps/inventory/operations/moves', icon = 'ArrowDownToLine', sequence = 30,
      active = true, updated_at = now()
  where module_id = v_module_id and code = 'inventory.moves';

  -- Operations.
  update public.ir_ui_menus
  set parent_id = v_operations_group_id, name = 'الجرد',
      route_path = '/apps/inventory/operations/counts', icon = 'ClipboardCheck', sequence = 10,
      active = true, updated_at = now()
  where module_id = v_module_id and code = 'inventory.counts';

  select id into v_menu_id
  from public.ir_ui_menus
  where module_id = v_module_id and code = 'inventory.return_reviews'
  order by created_at
  limit 1;
  if v_menu_id is null then
    insert into public.ir_ui_menus (
      module_id, parent_id, name, code, route_path, icon, sequence, active
    ) values (
      v_module_id, v_operations_group_id, 'مراجعة المرتجعات',
      'inventory.return_reviews', '/apps/inventory/operations/returns', 'RotateCcw', 20, true
    );
  else
    update public.ir_ui_menus
    set parent_id = v_operations_group_id, name = 'مراجعة المرتجعات',
        route_path = '/apps/inventory/operations/returns', icon = 'RotateCcw',
        sequence = 20, active = true, updated_at = now()
    where id = v_menu_id;
  end if;

  -- Configuration. Category management remains inside the Products page.
  update public.ir_ui_menus
  set parent_id = v_configuration_group_id, name = 'المنتجات والتصنيفات',
      route_path = '/apps/inventory/products', icon = 'Package', sequence = 10,
      active = true, updated_at = now()
  where module_id = v_module_id and code = 'inventory.products';

  update public.ir_ui_menus
  set parent_id = v_configuration_group_id, name = 'الخصائص',
      route_path = '/apps/inventory/products/attributes', icon = 'ListFilter', sequence = 20,
      active = true, updated_at = now()
  where module_id = v_module_id and code = 'products.attributes';

  update public.ir_ui_menus
  set parent_id = v_configuration_group_id, name = 'تعريفات التتبع',
      route_path = '/apps/inventory/products/tracking-identifiers', icon = 'ScanLine', sequence = 30,
      active = true, updated_at = now()
  where module_id = v_module_id and code = 'products.tracking_identifiers';

  update public.ir_ui_menus
  set parent_id = v_configuration_group_id, name = 'مواقع المخزون',
      route_path = '/apps/inventory/operations/locations', icon = 'MapPin', sequence = 40,
      active = true, updated_at = now()
  where module_id = v_module_id and code = 'inventory.locations';

  update public.ir_ui_menus
  set active = false, updated_at = now()
  where module_id = v_module_id and code = 'inventory.products_group';

  -- Deactivate only the known standalone category menu. No tenant installation
  -- or custom rows are deleted.
  update public.ir_ui_menus
  set active = false, updated_at = now()
  where module_id = v_module_id
    and (code = 'inventory.categories'
      or route_path = '/apps/inventory/products/categories');
end
$$;

create or replace function public.list_inventory_stock_balances(
  p_branch_id uuid default null,
  p_location_id uuid default null,
  p_search text default null,
  p_category_id uuid default null,
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_result jsonb;
begin
  if v_tenant_id is null
     or not (public.has_permission('inventory.availability', v_tenant_id)
       or public.has_permission('inventory.read', v_tenant_id)
       or public.has_permission('inventory.receive', v_tenant_id)
       or public.has_permission('inventory.transfer', v_tenant_id)) then
    raise exception using errcode = '42501', message = 'INVENTORY_STOCK_BALANCES_DENIED';
  end if;

  if p_branch_id is not null and not public.has_branch_access(p_branch_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_BRANCH_ACCESS_DENIED';
  end if;
  if p_location_id is not null and (
    not public.has_stock_location_access(p_location_id)
    or not exists (
      select 1 from public.stock_locations location
      where location.id = p_location_id
        and location.tenant_id = v_tenant_id
        and (p_branch_id is null or location.branch_id = p_branch_id)
    )
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_LOCATION_ACCESS_DENIED';
  end if;

  with authorized_locations as (
    select location.id, location.branch_id
    from public.stock_locations location
    where location.tenant_id = v_tenant_id
      and location.is_active
      and location.location_type in ('internal', 'showroom')
      and public.has_branch_access(location.branch_id)
      and public.has_stock_location_access(location.id)
      and (p_branch_id is null or location.branch_id = p_branch_id)
      and (p_location_id is null or location.id = p_location_id)
  ),
  active_quantity_reservations as (
    select reservation.location_id, line.product_id,
      sum(line.reserved_quantity - line.released_quantity - line.delivered_quantity) reserved
    from public.inventory_reservation_lines line
    join public.inventory_reservations reservation
      on reservation.id = line.reservation_id
     and reservation.tenant_id = line.tenant_id
    join authorized_locations location on location.id = reservation.location_id
    where line.tenant_id = v_tenant_id
      and line.tracking_unit_id is null
      and reservation.state in ('active', 'partially_delivered')
      and line.reserved_quantity > line.released_quantity + line.delivered_quantity
    group by reservation.location_id, line.product_id
  ),
  quantity_balances as (
    select quant.product_product_id product_id,
      sum(quant.quantity_on_hand) total_quantity,
      sum(least(quant.quantity_on_hand,
        coalesce(quant.reserved_quantity, 0) + coalesce(reservation.reserved, 0))) reserved_quantity
    from public.stock_quants quant
    join authorized_locations location on location.id = quant.location_id
    left join active_quantity_reservations reservation
      on reservation.location_id = quant.location_id
     and reservation.product_id = quant.product_product_id
    where quant.tenant_id = v_tenant_id
    group by quant.product_product_id
  ),
  serial_candidates as (
    select unit.id, unit.product_product_id product_id,
      coalesce(state.state, 'available') canonical_state,
      exists (
        select 1
        from public.inventory_reservation_lines line
        join public.inventory_reservations reservation
          on reservation.id = line.reservation_id
         and reservation.tenant_id = line.tenant_id
        where line.tenant_id = unit.tenant_id
          and line.tracking_unit_id = unit.id
          and reservation.state in ('active', 'partially_delivered')
          and line.reserved_quantity > line.released_quantity + line.delivered_quantity
      ) active_reservation
    from public.stock_tracking_units unit
    join authorized_locations location on location.id = unit.current_location_id
    left join public.inventory_tracking_unit_states state
      on state.tenant_id = unit.tenant_id and state.tracking_unit_id = unit.id
    where unit.tenant_id = v_tenant_id
      and unit.product_product_id is not null
      and unit.tracking_type = 'serial'
      and unit.data_status = 'complete'
      and unit.status in ('in_stock', 'returned', 'reserved')
      and coalesce(state.state, 'available') in ('available', 'reserved')
  ),
  serial_balances as (
    select product_id,
      count(*)::numeric total_quantity,
      count(*) filter (where canonical_state = 'reserved' or active_reservation)::numeric reserved_quantity
    from serial_candidates
    group by product_id
  ),
  balances as (
    select product.id product_id, product.product_template_id,
      product.display_name, product.sku, product.barcode,
      product.tracking, template.name template_name,
      template.internal_reference, template.barcode template_barcode,
      template.category_id,
      case when product.tracking = 'serial'
        then coalesce(serial.total_quantity, 0)
        else coalesce(quantity.total_quantity, 0)
      end total_quantity,
      case when product.tracking = 'serial'
        then coalesce(serial.reserved_quantity, 0)
        else coalesce(quantity.reserved_quantity, 0)
      end reserved_quantity
    from public.product_products product
    join public.product_templates template
      on template.id = product.product_template_id
     and template.tenant_id = product.tenant_id
    left join quantity_balances quantity on quantity.product_id = product.id
    left join serial_balances serial on serial.product_id = product.id
    where product.tenant_id = v_tenant_id
      and product.is_active and template.is_active
      and template.product_type = 'goods'
      and product.tracking in ('none', 'serial')
      and (p_category_id is null or template.category_id = p_category_id)
      and (
        nullif(btrim(coalesce(p_search, '')), '') is null
        or concat_ws(' ', product.display_name, product.sku, product.barcode,
          template.name, template.internal_reference, template.barcode)
          ilike '%' || btrim(p_search) || '%'
      )
  ),
  filtered as (
    select *, greatest(total_quantity - reserved_quantity, 0) available_quantity
    from balances
    where total_quantity > 0
  ),
  page_rows as (
    select * from filtered
    order by display_name, product_id
    limit v_page_size offset (v_page - 1) * v_page_size
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'product_id', row.product_id,
      'product_template_id', row.product_template_id,
      'display_name', row.display_name,
      'template_name', row.template_name,
      'code', coalesce(nullif(row.sku, ''), row.internal_reference, ''),
      'barcode', coalesce(nullif(row.barcode, ''), row.template_barcode, ''),
      'category_id', row.category_id,
      'tracking', row.tracking,
      'available_quantity', row.available_quantity,
      'reserved_quantity', row.reserved_quantity,
      'total_quantity', row.total_quantity
    ) order by row.display_name, row.product_id) from page_rows row), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', v_page,
    'page_size', v_page_size
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.list_inventory_stock_balances(uuid, uuid, text, uuid, integer, integer)
from public, anon;
grant execute on function public.list_inventory_stock_balances(uuid, uuid, text, uuid, integer, integer)
to authenticated;

comment on function public.list_inventory_stock_balances(uuid, uuid, text, uuid, integer, integer) is
  'Paginated canonical stock-balance read model. Scope is enforced by branch/location authorization functions.';

commit;
