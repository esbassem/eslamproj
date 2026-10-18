begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.list_inventory_stock_movements(
  p_search text default null,
  p_branch_id uuid default null,
  p_location_id uuid default null,
  p_movement_type text default null,
  p_date_from date default null,
  p_date_to date default null,
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
  v_tenant_user_id uuid := public.current_tenant_user_id();
  v_is_owner boolean := false;
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_search text := lower(nullif(btrim(p_search), ''));
  v_result jsonb;
begin
  if v_tenant_id is null or v_tenant_user_id is null or not (
    public.has_permission('inventory.read', v_tenant_id)
    or public.has_permission('inventory.availability', v_tenant_id)
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_STOCK_MOVEMENTS_DENIED';
  end if;

  select tenant_user.role = 'owner' into v_is_owner
  from public.tenant_users tenant_user
  where tenant_user.id = v_tenant_user_id
    and tenant_user.tenant_id = v_tenant_id
    and tenant_user.is_active;

  if p_date_from is not null and p_date_to is not null and p_date_from > p_date_to then
    raise exception using errcode = '22023', message = 'INVENTORY_MOVEMENT_DATE_RANGE_INVALID';
  end if;
  if p_movement_type is not null and p_movement_type not in (
    'receiving', 'transfer', 'reservation', 'delivery', 'return', 'adjustment', 'opening'
  ) then
    raise exception using errcode = '22023', message = 'INVENTORY_MOVEMENT_TYPE_INVALID';
  end if;
  if p_branch_id is not null and not public.has_branch_access(p_branch_id) then
    raise exception using errcode = '42501', message = 'INVENTORY_BRANCH_ACCESS_DENIED';
  end if;
  if p_location_id is not null and not exists (
    select 1 from public.stock_locations location
    where location.id = p_location_id and location.tenant_id = v_tenant_id
      and public.has_branch_access(location.branch_id)
      and public.has_stock_location_access(location.id)
      and (p_branch_id is null or location.branch_id = p_branch_id)
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_LOCATION_ACCESS_DENIED';
  end if;

  with authorized_locations as materialized (
    select location.id, location.branch_id, location.name,
      branch.name as branch_name
    from public.stock_locations location
    join public.branches branch
      on branch.id = location.branch_id and branch.tenant_id = location.tenant_id
    where location.tenant_id = v_tenant_id
      and public.has_branch_access(location.branch_id)
      and public.has_stock_location_access(location.id)
  ), event_rows as (
    select
      event.id,
      'inventory_event'::text as record_source,
      event.occurred_at,
      event.event_type as source_event_type,
      case
        when event.event_type = 'received' then 'receiving'
        when event.event_type = 'transferred' then 'transfer'
        when event.event_type in ('reserved', 'reservation_released') then 'reservation'
        when event.event_type in ('delivered', 'delivery_corrected') then 'delivery'
        when event.event_type in ('returned', 'return_review_released', 'return_review_release_corrected', 'return_corrected') then 'return'
        when event.event_type in ('adjustment_posted', 'adjustment_reversed', 'receipt_corrected') then 'adjustment'
        when event.event_type = 'opening_adopted' then 'opening'
        else 'adjustment'
      end as movement_type,
      event.product_id,
      event.tracking_unit_id,
      event.quantity,
      event.from_location_id,
      event.to_location_id,
      source_location.name as source_location_name,
      source_location.branch_name as source_branch_name,
      destination_location.name as destination_location_name,
      destination_location.branch_name as destination_branch_name,
      coalesce(source_location.branch_id, destination_location.branch_id, opening_location.branch_id) as scope_branch_id,
      event.source_type,
      event.source_id,
      coalesce(
        reservation.state,
        delivery.state,
        inventory_return.state,
        receipt.state,
        transfer.state,
        adjustment.state
      ) as operation_state,
      case
        when public.has_permission('sales.access', v_tenant_id)
          and reservation.source_type = 'sale'
          and reservation.source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then '/app/sales/' || reservation.source_id
        else null
      end as route_path,
      null::text as notes,
      event.details
    from public.inventory_events event
    left join authorized_locations source_location on source_location.id = event.from_location_id
    left join authorized_locations destination_location on destination_location.id = event.to_location_id
    left join public.inventory_opening_adoptions opening
      on opening.tenant_id = event.tenant_id
      and opening.id = case
        when event.details->>'opening_adoption_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (event.details->>'opening_adoption_id')::uuid
        else null
      end
    left join authorized_locations opening_location on opening_location.id = opening.location_id
    left join public.inventory_deliveries delivery
      on delivery.tenant_id = event.tenant_id and delivery.id = event.delivery_id
    left join public.inventory_returns inventory_return
      on inventory_return.tenant_id = event.tenant_id and inventory_return.id = event.return_id
    left join public.inventory_deliveries return_delivery
      on return_delivery.tenant_id = inventory_return.tenant_id
      and return_delivery.id = inventory_return.delivery_id
    left join public.inventory_reservations reservation
      on reservation.tenant_id = event.tenant_id
      and reservation.id = coalesce(event.reservation_id, delivery.reservation_id, return_delivery.reservation_id)
    left join public.inventory_receipts receipt
      on receipt.tenant_id = event.tenant_id
      and receipt.id = case
        when event.source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then event.source_id::uuid
        else null
      end
    left join public.inventory_transfers transfer
      on transfer.tenant_id = event.tenant_id
      and transfer.id = case
        when event.source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then event.source_id::uuid
        else null
      end
    left join public.inventory_adjustments adjustment
      on adjustment.tenant_id = event.tenant_id
      and adjustment.id = case
        when event.details->>'adjustment_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then (event.details->>'adjustment_id')::uuid
        else null
      end
    where event.tenant_id = v_tenant_id
      and (
        source_location.id is not null
        or destination_location.id is not null
        or opening_location.id is not null
        or (v_is_owner and event.from_location_id is null and event.to_location_id is null)
      )
      and (p_location_id is null or source_location.id = p_location_id
        or destination_location.id = p_location_id or opening_location.id = p_location_id)
      and (p_branch_id is null or source_location.branch_id = p_branch_id
        or destination_location.branch_id = p_branch_id or opening_location.branch_id = p_branch_id)
  ), legacy_move_rows as (
    select
      move.id,
      'stock_move'::text as record_source,
      move.created_at as occurred_at,
      move.move_type as source_event_type,
      case
        when move.move_type in ('receive', 'in') then 'receiving'
        when move.move_type = 'transfer' then 'transfer'
        when move.move_type in ('reserve', 'release') then 'reservation'
        when move.move_type = 'out' then 'delivery'
        when move.move_type = 'return' then 'return'
        else 'adjustment'
      end as movement_type,
      move.product_product_id as product_id,
      move.tracking_unit_id,
      move.quantity,
      move.source_location_id as from_location_id,
      move.destination_location_id as to_location_id,
      source_location.name as source_location_name,
      source_location.branch_name as source_branch_name,
      destination_location.name as destination_location_name,
      destination_location.branch_name as destination_branch_name,
      coalesce(source_location.branch_id, destination_location.branch_id, sale.branch_id) as scope_branch_id,
      coalesce(move.reference_type, 'legacy_stock_move') as source_type,
      move.reference_id::text as source_id,
      sale.status as operation_state,
      case when sale.id is not null and public.has_permission('sales.access', v_tenant_id)
        then '/app/sales/' || sale.id::text else null end as route_path,
      move.notes,
      '{}'::jsonb as details
    from public.stock_moves move
    left join authorized_locations source_location on source_location.id = move.source_location_id
    left join authorized_locations destination_location on destination_location.id = move.destination_location_id
    left join public.inventory_deliveries delivery
      on move.reference_type = 'canonical_inventory_delivery'
      and delivery.tenant_id = move.tenant_id and delivery.id = move.reference_id
    left join public.inventory_reservations delivery_reservation
      on delivery_reservation.tenant_id = delivery.tenant_id
      and delivery_reservation.id = delivery.reservation_id
    left join public.sales sale
      on sale.tenant_id = move.tenant_id
      and sale.id = case
        when move.reference_type = 'showroom_sale' then move.reference_id
        when delivery_reservation.source_type = 'sale'
          and delivery_reservation.source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          then delivery_reservation.source_id::uuid
        else null
      end
    where move.tenant_id = v_tenant_id
      and (
        source_location.id is not null
        or destination_location.id is not null
        or (sale.id is not null and public.has_branch_access(sale.branch_id) and exists (
          select 1 from authorized_locations scoped_location
          where scoped_location.branch_id = sale.branch_id
        ))
        or (v_is_owner and move.source_location_id is null and move.destination_location_id is null)
      )
      and (p_location_id is null or source_location.id = p_location_id or destination_location.id = p_location_id)
      and (p_branch_id is null or source_location.branch_id = p_branch_id
        or destination_location.branch_id = p_branch_id or sale.branch_id = p_branch_id)
      -- Match legacy rows to canonical events one-for-one. Counting both sides
      -- preserves a second independent move even when all of its values happen
      -- to equal the first; time proximity is deliberately not a dedup key.
      and (
        select count(*)
        from public.inventory_events event
        where event.tenant_id = move.tenant_id
          and event.source_id = move.reference_id::text
          and event.product_id = move.product_product_id
          and event.tracking_unit_id is not distinct from move.tracking_unit_id
          and event.quantity = move.quantity
          and event.from_location_id is not distinct from move.source_location_id
          and event.to_location_id is not distinct from move.destination_location_id
      ) < (
        select count(*)
        from public.stock_moves ordinal_move
        where ordinal_move.tenant_id = move.tenant_id
          and ordinal_move.reference_id is not distinct from move.reference_id
          and ordinal_move.product_product_id = move.product_product_id
          and ordinal_move.tracking_unit_id is not distinct from move.tracking_unit_id
          and ordinal_move.quantity = move.quantity
          and ordinal_move.source_location_id is not distinct from move.source_location_id
          and ordinal_move.destination_location_id is not distinct from move.destination_location_id
          and (ordinal_move.created_at, ordinal_move.id) <= (move.created_at, move.id)
      )
      and not exists (
        select 1
        from public.inventory_receipt_lines line
        join public.inventory_events event
          on event.tenant_id = line.tenant_id
          and event.event_type in ('received', 'receipt_corrected')
          and event.product_id = line.product_id
          and event.tracking_unit_id is not distinct from line.tracking_unit_id
          and event.quantity = line.quantity
        where line.tenant_id = move.tenant_id and line.stock_move_id = move.id
      )
      and not exists (
        select 1
        from public.inventory_delivery_lines line
        join public.inventory_events event
          on event.tenant_id = line.tenant_id and event.delivery_id = line.delivery_id
        where line.tenant_id = move.tenant_id and line.stock_move_id = move.id
      )
      and not exists (
        select 1
        from public.inventory_return_lines line
        join public.inventory_events event
          on event.tenant_id = line.tenant_id and event.return_id = line.return_id
        where line.tenant_id = move.tenant_id and line.stock_move_id = move.id
      )
  ), movement_rows as (
    select * from event_rows
    union all
    select * from legacy_move_rows
  ), enriched_rows as (
    select movement.*,
      coalesce(variant.display_name, template.name, 'منتج غير معروف') as product_name,
      coalesce(variant.sku, template.internal_reference) as product_code,
      coalesce(variant.barcode, template.barcode) as product_barcode,
      coalesce(unit.tracking_number, identifier_values.values_text) as tracking_identity,
      coalesce(template.tracking, variant.tracking, 'none') as tracking_mode
    from movement_rows movement
    left join public.product_products variant
      on variant.tenant_id = v_tenant_id and variant.id = movement.product_id
    left join public.product_templates template
      on template.tenant_id = variant.tenant_id and template.id = variant.product_template_id
    left join public.stock_tracking_units unit
      on unit.tenant_id = v_tenant_id and unit.id = movement.tracking_unit_id
    left join lateral (
      select string_agg(identifier.value, ' ' order by identifier.identifier_type_id) values_text
      from public.stock_tracking_unit_identifiers identifier
      where identifier.tenant_id = v_tenant_id
        and identifier.tracking_unit_id = movement.tracking_unit_id
        and not identifier.is_not_available
    ) identifier_values on true
  ), filtered_rows as materialized (
    select * from enriched_rows movement
    where (p_movement_type is null or movement.movement_type = p_movement_type)
      and (p_date_from is null or movement.occurred_at >= p_date_from::timestamptz)
      and (p_date_to is null or movement.occurred_at < (p_date_to + 1)::timestamptz)
      and (v_search is null or position(v_search in lower(concat_ws(' ',
        movement.product_name, movement.product_code, movement.product_barcode,
        movement.tracking_identity, movement.source_type, movement.source_id
      ))) > 0)
  ), paged_rows as (
    select * from filtered_rows
    order by occurred_at desc, record_source, id desc
    offset (v_page - 1) * v_page_size limit v_page_size
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', row.id,
      'recordSource', row.record_source,
      'occurredAt', row.occurred_at,
      'movementType', row.movement_type,
      'sourceEventType', row.source_event_type,
      'productId', row.product_id,
      'productName', row.product_name,
      'productCode', row.product_code,
      'productBarcode', row.product_barcode,
      'trackingMode', row.tracking_mode,
      'trackingUnitId', row.tracking_unit_id,
      'trackingIdentity', row.tracking_identity,
      'quantity', row.quantity,
      'sourceLocationId', row.from_location_id,
      'sourceLocationName', row.source_location_name,
      'sourceBranchName', row.source_branch_name,
      'destinationLocationId', row.to_location_id,
      'destinationLocationName', row.destination_location_name,
      'destinationBranchName', row.destination_branch_name,
      'referenceType', row.source_type,
      'referenceId', row.source_id,
      'operationState', row.operation_state,
      'routePath', row.route_path,
      'notes', row.notes
    ) order by row.occurred_at desc, row.record_source, row.id desc) from paged_rows row), '[]'::jsonb),
    'total', (select count(*) from filtered_rows),
    'page', v_page,
    'pageSize', v_page_size,
    'locations', coalesce((select jsonb_agg(jsonb_build_object(
      'id', location.id, 'name', location.name,
      'branchId', location.branch_id, 'branchName', location.branch_name
    ) order by location.branch_name, location.name) from authorized_locations location), '[]'::jsonb)
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.list_inventory_stock_movements(
  text, uuid, uuid, text, date, date, integer, integer
) from public, anon;
grant execute on function public.list_inventory_stock_movements(
  text, uuid, uuid, text, date, date, integer, integer
) to authenticated;

commit;
