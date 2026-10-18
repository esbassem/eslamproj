begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.get_inventory_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_tenant_user_id uuid := public.current_tenant_user_id();
begin
  if v_tenant_id is null
     or v_tenant_user_id is null
     or not (
       public.has_permission('inventory.availability', v_tenant_id)
       or public.has_permission('inventory.read', v_tenant_id)
       or public.has_permission('inventory.receive', v_tenant_id)
       or public.has_permission('inventory.transfer', v_tenant_id)
     ) then
    raise exception using errcode = '42501', message = 'INVENTORY_DASHBOARD_DENIED';
  end if;

  return (
    with authorized_locations as materialized (
      select location.id, location.branch_id, location.name,
        branch.name as branch_name
      from public.stock_locations location
      join public.branches branch
        on branch.id = location.branch_id
       and branch.tenant_id = location.tenant_id
      where location.tenant_id = v_tenant_id
        and location.is_active
        and location.location_type in ('internal', 'showroom')
        and public.has_branch_access(location.branch_id)
        and public.has_stock_location_access(location.id)
    ), active_quantity_reservations as (
      select reservation.location_id, line.product_id,
        sum(line.reserved_quantity - line.released_quantity - line.delivered_quantity) as reserved
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
    ), quantity_balances as (
      select quant.product_product_id as product_id,
        sum(quant.quantity_on_hand) as total_quantity,
        sum(least(quant.quantity_on_hand,
          coalesce(quant.reserved_quantity, 0) + coalesce(reservation.reserved, 0))) as reserved_quantity
      from public.stock_quants quant
      join authorized_locations location on location.id = quant.location_id
      left join active_quantity_reservations reservation
        on reservation.location_id = quant.location_id
       and reservation.product_id = quant.product_product_id
      where quant.tenant_id = v_tenant_id
      group by quant.product_product_id
      having sum(quant.quantity_on_hand) > 0
    ), scoped_serial_units as materialized (
      select unit.id, unit.product_product_id as product_id, unit.tracking_number,
        unit.data_status, unit.incomplete_reason, unit.created_at,
        location.id as location_id, location.name as location_name,
        location.branch_id, location.branch_name,
        coalesce(state.state, 'available') as canonical_state,
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
        ) as active_reservation,
        exists (
          select 1
          from public.ir_attachments attachment
          where attachment.tenant_id = unit.tenant_id
            and attachment.related_model = 'stock_tracking_units'
            and attachment.related_id = unit.id
            and attachment.is_active
            and attachment.mime_type like 'image/%'
            and left(attachment.file_path, length(v_tenant_id::text) + 1) = v_tenant_id::text || '/'
        ) as has_image
      from public.stock_tracking_units unit
      join authorized_locations location on location.id = unit.current_location_id
      left join public.inventory_tracking_unit_states state
        on state.tenant_id = unit.tenant_id
       and state.tracking_unit_id = unit.id
      where unit.tenant_id = v_tenant_id
        and unit.tracking_type = 'serial'
        and unit.status in ('in_stock', 'returned', 'reserved')
        and coalesce(state.state, 'available') in ('available', 'reserved')
    ), canonical_serial_balances as (
      select unit.product_id,
        count(*)::numeric as total_quantity,
        count(*) filter (
          where unit.canonical_state = 'reserved' or unit.active_reservation
        )::numeric as reserved_quantity
      from scoped_serial_units unit
      where unit.product_id is not null
        and unit.data_status = 'complete'
      group by unit.product_id
    ), combined_balances as (
      select quantity.product_id, quantity.total_quantity, quantity.reserved_quantity
      from quantity_balances quantity
      union all
      select serial.product_id, serial.total_quantity, serial.reserved_quantity
      from canonical_serial_balances serial
    ), attention_units as (
      select unit.*, product.display_name as product_name,
        (unit.data_status in ('incomplete', 'needs_review')) as needs_data,
        not unit.has_image as needs_image
      from scoped_serial_units unit
      left join public.product_products product
        on product.id = unit.product_id
       and product.tenant_id = v_tenant_id
      where unit.data_status in ('incomplete', 'needs_review')
         or not unit.has_image
    )
    select jsonb_build_object(
      'metrics', jsonb_build_object(
        'stocked_product_count', (select count(distinct balance.product_id) from combined_balances balance),
        'serial_unit_count', (select count(*) from scoped_serial_units),
        'available_quantity', coalesce((select sum(greatest(balance.total_quantity - balance.reserved_quantity, 0)) from combined_balances balance), 0),
        'reserved_quantity', coalesce((select sum(balance.reserved_quantity) from combined_balances balance), 0),
        'total_quantity', coalesce((select sum(balance.total_quantity) from combined_balances balance), 0),
        'incomplete_unit_count', (select count(*) from scoped_serial_units unit where unit.data_status in ('incomplete', 'needs_review')),
        'missing_image_unit_count', (select count(*) from scoped_serial_units unit where not unit.has_image),
        'location_count', (select count(*) from authorized_locations)
      ),
      'attention_units', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', unit.id,
          'product_id', unit.product_id,
          'product_name', unit.product_name,
          'tracking_number', unit.tracking_number,
          'data_status', unit.data_status,
          'incomplete_reason', unit.incomplete_reason,
          'needs_data', unit.needs_data,
          'needs_image', unit.needs_image,
          'branch_id', unit.branch_id,
          'branch_name', unit.branch_name,
          'location_id', unit.location_id,
          'location_name', unit.location_name
        ) order by unit.needs_data desc, unit.created_at desc, unit.id desc)
        from (
          select * from attention_units
          order by needs_data desc, created_at desc, id desc
          limit 6
        ) unit
      ), '[]'::jsonb)
    )
  );
end
$function$;

revoke all on function public.get_inventory_dashboard_summary() from public, anon;
grant execute on function public.get_inventory_dashboard_summary() to authenticated;

comment on function public.get_inventory_dashboard_summary() is
  'Read-only Inventory dashboard summary using canonical balances and authorized branch/location scope.';

notify pgrst, 'reload schema';

commit;
