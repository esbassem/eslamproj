begin;

create or replace function public.get_inventory_serial_unit_details(
  p_unit_id uuid,
  p_timeline_page integer default 1,
  p_timeline_page_size integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_page integer := greatest(coalesce(p_timeline_page, 1), 1);
  v_page_size integer := least(greatest(coalesce(p_timeline_page_size, 25), 1), 100);
  v_unit public.stock_tracking_units%rowtype;
  v_state public.inventory_tracking_unit_states%rowtype;
  v_result jsonb;
begin
  if v_tenant_id is null or not (
    public.has_permission('inventory.availability', v_tenant_id)
    or public.has_permission('inventory.read', v_tenant_id)
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_SERIAL_UNIT_DETAILS_DENIED';
  end if;

  select * into v_unit
  from public.stock_tracking_units unit
  where unit.id = p_unit_id and unit.tenant_id = v_tenant_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'INVENTORY_SERIAL_UNIT_NOT_FOUND';
  end if;

  select * into v_state
  from public.inventory_tracking_unit_states state
  where state.tenant_id = v_tenant_id and state.tracking_unit_id = p_unit_id;

  -- Available/reserved units are authorized by their canonical current location.
  -- Issued/legacy units without a current location are authorized only when their
  -- recorded history intersects a location visible to the caller.
  if not (
    (v_state.current_location_id is not null
      and public.has_stock_location_access(v_state.current_location_id)
      and exists (
        select 1 from public.stock_locations location
        where location.tenant_id = v_tenant_id
          and location.id = v_state.current_location_id
          and public.has_branch_access(location.branch_id)
      ))
    or (v_state.current_location_id is null and exists (
      select 1 from public.inventory_events event
      where event.tenant_id = v_tenant_id
        and event.tracking_unit_id = p_unit_id
        and (exists (
          select 1 from public.stock_locations location
          where location.tenant_id = v_tenant_id and location.id = event.from_location_id
            and public.has_branch_access(location.branch_id)
            and public.has_stock_location_access(location.id)
        ) or exists (
          select 1 from public.stock_locations location
          where location.tenant_id = v_tenant_id and location.id = event.to_location_id
            and public.has_branch_access(location.branch_id)
            and public.has_stock_location_access(location.id)
        ))
    ))
    or (v_state.tracking_unit_id is null and v_unit.current_location_id is not null
      and public.has_stock_location_access(v_unit.current_location_id)
      and exists (
        select 1 from public.stock_locations location
        where location.tenant_id = v_tenant_id
          and location.id = v_unit.current_location_id
          and public.has_branch_access(location.branch_id)
      ))
  ) then
    raise exception using errcode = '42501', message = 'INVENTORY_SERIAL_UNIT_DETAILS_DENIED';
  end if;

  with product_data as (
    select variant.id, variant.display_name, variant.sku, variant.barcode,
      template.id as template_id, template.name as template_name,
      category.id as category_id, category.name as category_name
    from public.product_products variant
    join public.product_templates template
      on template.id = variant.product_template_id and template.tenant_id = variant.tenant_id
    left join public.product_categories category
      on category.id = template.category_id and category.tenant_id = template.tenant_id
    where variant.id = v_unit.product_product_id and variant.tenant_id = v_tenant_id
  ), identifiers as (
    select identifier.identifier_type_id as id, type.name, type.code,
      case when identifier.is_not_available then null else identifier.value end as value,
      identifier.is_not_available,
      coalesce(link.sequence = (
        select min(primary_link.sequence)
        from public.product_category_tracking_identifiers primary_link
        where primary_link.tenant_id = identifier.tenant_id
          and primary_link.category_id = product.category_id
      ), false) as is_primary,
      link.sequence
    from public.stock_tracking_unit_identifiers identifier
    join public.product_tracking_identifier_types type
      on type.id = identifier.identifier_type_id and type.tenant_id = identifier.tenant_id
    left join product_data product on true
    left join public.product_category_tracking_identifiers link
      on link.tenant_id = identifier.tenant_id
      and link.category_id = product.category_id
      and link.identifier_type_id = identifier.identifier_type_id
    where identifier.tenant_id = v_tenant_id and identifier.tracking_unit_id = p_unit_id
  ), attributes as (
    select attribute.attribute_id as id, definition.name,
      coalesce(value.name, attribute.value_text) as value
    from public.stock_tracking_unit_attributes attribute
    join public.product_attributes definition
      on definition.id = attribute.attribute_id and definition.tenant_id = attribute.tenant_id
    left join public.product_attribute_values value
      on value.id = attribute.attribute_value_id and value.tenant_id = attribute.tenant_id
    where attribute.tenant_id = v_tenant_id and attribute.tracking_unit_id = p_unit_id
  ), attachments as (
    select attachment.id, attachment.bucket_name, attachment.file_path,
      attachment.document_type, attachment.original_file_name,
      attachment.mime_type, attachment.file_size, attachment.created_at
    from public.ir_attachments attachment
    where attachment.tenant_id = v_tenant_id
      and attachment.related_model = 'stock_tracking_units'
      and attachment.related_id = p_unit_id
      and attachment.is_active
      and left(attachment.file_path, length(v_tenant_id::text) + 1) = v_tenant_id::text || '/'
  ), event_timeline as (
    select event.id, event.occurred_at, event.event_type,
      event.source_type, event.source_id, event.quantity,
      event.from_location_id, event.to_location_id,
      case when event.from_location_id is not null
          and public.has_stock_location_access(event.from_location_id)
          and public.has_branch_access(source_location.branch_id)
        then source_location.name end as from_location_name,
      case when event.to_location_id is not null
          and public.has_stock_location_access(event.to_location_id)
          and public.has_branch_access(destination_location.branch_id)
        then destination_location.name end as to_location_name,
      case
        when reservation.source_type = 'sale' and reservation.source_id ~* '^[0-9a-f-]{36}$'
          then '/app/sales/' || reservation.source_id
        else null
      end as route_path,
      event.details, 'inventory_event'::text as record_source
    from public.inventory_events event
    left join public.stock_locations source_location
      on source_location.id = event.from_location_id and source_location.tenant_id = event.tenant_id
    left join public.stock_locations destination_location
      on destination_location.id = event.to_location_id and destination_location.tenant_id = event.tenant_id
    left join public.inventory_reservations reservation
      on reservation.id = event.reservation_id and reservation.tenant_id = event.tenant_id
    where event.tenant_id = v_tenant_id and event.tracking_unit_id = p_unit_id
      and ((event.from_location_id is not null and public.has_stock_location_access(event.from_location_id)
          and public.has_branch_access(source_location.branch_id))
        or (event.to_location_id is not null and public.has_stock_location_access(event.to_location_id)
          and public.has_branch_access(destination_location.branch_id)))
  ), legacy_moves as (
    select move.id, move.created_at as occurred_at, move.move_type as event_type,
      move.reference_type as source_type, move.reference_id::text as source_id, move.quantity,
      move.source_location_id as from_location_id, move.destination_location_id as to_location_id,
      case when move.source_location_id is not null
          and public.has_stock_location_access(move.source_location_id)
          and public.has_branch_access(source_location.branch_id)
        then source_location.name end as from_location_name,
      case when move.destination_location_id is not null
          and public.has_stock_location_access(move.destination_location_id)
          and public.has_branch_access(destination_location.branch_id)
        then destination_location.name end as to_location_name,
      null::text as route_path, jsonb_build_object('notes', move.notes) as details,
      'stock_move'::text as record_source
    from public.stock_moves move
    left join public.stock_locations source_location
      on source_location.id = move.source_location_id and source_location.tenant_id = move.tenant_id
    left join public.stock_locations destination_location
      on destination_location.id = move.destination_location_id and destination_location.tenant_id = move.tenant_id
    where move.tenant_id = v_tenant_id and move.tracking_unit_id = p_unit_id
      and ((move.source_location_id is not null and public.has_stock_location_access(move.source_location_id)
          and public.has_branch_access(source_location.branch_id))
        or (move.destination_location_id is not null and public.has_stock_location_access(move.destination_location_id)
          and public.has_branch_access(destination_location.branch_id)))
      and not exists (
        select 1 from public.inventory_events event
        where event.tenant_id = move.tenant_id and event.tracking_unit_id = move.tracking_unit_id
          and (event.source_id = move.reference_id::text
            or (abs(extract(epoch from (event.occurred_at - move.created_at))) < 2
              and event.product_id = move.product_product_id
              and event.quantity = move.quantity
              and event.from_location_id is not distinct from move.source_location_id
              and event.to_location_id is not distinct from move.destination_location_id))
      )
  ), timeline as (
    select * from event_timeline union all select * from legacy_moves
  ), paged_timeline as (
    select * from timeline order by occurred_at desc, id desc
    offset (v_page - 1) * v_page_size limit v_page_size
  )
  select jsonb_build_object(
    'unit', jsonb_build_object(
      'id', v_unit.id, 'trackingNumber', v_unit.tracking_number,
      'trackingType', v_unit.tracking_type, 'legacyStatus', v_unit.status,
      'dataStatus', v_unit.data_status, 'notes', v_unit.notes,
      'createdAt', v_unit.created_at, 'updatedAt', v_unit.updated_at,
      'canonicalState', v_state.state,
      'currentLocationId', coalesce(v_state.current_location_id, v_unit.current_location_id),
      'currentLocationName', (
        select location.name from public.stock_locations location
        where location.tenant_id = v_tenant_id
          and location.id = coalesce(v_state.current_location_id, v_unit.current_location_id)
      ),
      'currentBranchId', (
        select location.branch_id from public.stock_locations location
        where location.tenant_id = v_tenant_id
          and location.id = coalesce(v_state.current_location_id, v_unit.current_location_id)
      ),
      'currentBranchName', (
        select branch.name from public.stock_locations location
        join public.branches branch on branch.id = location.branch_id and branch.tenant_id = location.tenant_id
        where location.tenant_id = v_tenant_id
          and location.id = coalesce(v_state.current_location_id, v_unit.current_location_id)
      )
    ),
    'product', coalesce((select to_jsonb(product_data) from product_data), '{}'::jsonb),
    'identifiers', coalesce((select jsonb_agg((to_jsonb(identifiers) - 'sequence') order by is_primary desc, sequence, name) from identifiers), '[]'::jsonb),
    'attributes', coalesce((select jsonb_agg(to_jsonb(attributes) order by name) from attributes), '[]'::jsonb),
    'attachments', coalesce((select jsonb_agg(to_jsonb(attachments) order by created_at desc) from attachments), '[]'::jsonb),
    'timeline', coalesce((select jsonb_agg(to_jsonb(paged_timeline) order by occurred_at desc, id desc) from paged_timeline), '[]'::jsonb),
    'timelineTotal', (select count(*) from timeline),
    'timelinePage', v_page, 'timelinePageSize', v_page_size
  ) into v_result;

  return v_result;
end
$$;

revoke all on function public.get_inventory_serial_unit_details(uuid, integer, integer)
  from public, anon;
grant execute on function public.get_inventory_serial_unit_details(uuid, integer, integer)
  to authenticated;

commit;
