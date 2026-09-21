begin;

-- Read-only bug fix: service-only sales have no reservation/location, so the
-- record must still have a known tuple shape before the snapshot is returned.
create or replace function public.sale_delivery_snapshot(
  p_tenant_id uuid,
  p_sale_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sale public.sales%rowtype;
  v_confirmation public.sale_confirmation_links%rowtype;
  v_reservation public.inventory_reservations%rowtype;
  v_location record;
  v_required numeric := 0;
  v_delivered numeric := 0;
  v_reservation_delivered numeric := 0;
  v_blockers jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_status text := 'unreserved';
begin
  -- Give the generic record a known shape even when no stock location exists.
  select location.id, location.name into v_location
  from public.stock_locations location
  where false;

  select * into v_sale from public.sales sale
  where sale.id = p_sale_id and sale.tenant_id = p_tenant_id;
  if not found then
    return jsonb_build_object('found', false);
  end if;

  select * into v_confirmation from public.sale_confirmation_links confirmation
  where confirmation.sale_id = p_sale_id and confirmation.tenant_id = p_tenant_id;
  if found and v_confirmation.inventory_reservation_id is not null then
    select * into v_reservation from public.inventory_reservations reservation
    where reservation.id = v_confirmation.inventory_reservation_id
      and reservation.tenant_id = p_tenant_id;
    if found then
      select location.id, location.name into v_location
      from public.stock_locations location
      where location.id = v_reservation.location_id
        and location.tenant_id = p_tenant_id;
    end if;
  end if;

  select coalesce(sum(selection.quantity), 0) into v_required
  from public.sale_inventory_selections selection
  where selection.sale_id = p_sale_id and selection.tenant_id = p_tenant_id;
  select coalesce(sum(line.quantity), 0) into v_delivered
  from public.sale_delivery_lines line
  where line.sale_id = p_sale_id and line.tenant_id = p_tenant_id;
  if v_reservation.id is not null then
    select coalesce(sum(line.delivered_quantity), 0) into v_reservation_delivered
    from public.inventory_reservation_lines line
    where line.reservation_id = v_reservation.id and line.tenant_id = p_tenant_id;
  end if;

  if v_sale.status <> 'confirmed' then
    v_blockers := v_blockers || '"SALE_NOT_CONFIRMED"'::jsonb;
  end if;
  if v_confirmation.id is null or not exists (
    select 1
    from public.financial_sale_postings posting
    join public.financial_engine_bindings binding
      on binding.id = v_confirmation.financial_engine_binding_id
     and binding.tenant_id = posting.tenant_id
     and binding.canonical_sale_posting_id = posting.id
    where posting.id = v_confirmation.financial_sale_posting_id
      and posting.tenant_id = p_tenant_id
      and posting.source_app = 'sales_core'
      and posting.source_model = 'sale'
      and posting.source_id = p_sale_id::text
      and posting.state = 'posted'
      and binding.financial_engine = 'canonical'
      and binding.state = 'posted'
  ) then
    v_blockers := v_blockers || '"SALE_CONFIRMATION_LINK_INVALID"'::jsonb;
  end if;
  if v_required = 0 then
    v_status := 'not_required';
    v_blockers := v_blockers || '"SALE_DELIVERY_NOT_REQUIRED"'::jsonb;
  elsif v_reservation.id is null then
    v_blockers := v_blockers || '"SALE_INVENTORY_RESERVATION_MISSING"'::jsonb;
  else
    if v_reservation.source_type <> 'sale'
       or v_reservation.source_id <> p_sale_id::text
       or v_reservation.branch_id <> v_sale.branch_id
       or v_reservation.state not in ('active', 'partially_delivered', 'delivered')
       or v_location.id is null then
      v_blockers := v_blockers || '"SALE_INVENTORY_RESERVATION_INVALID"'::jsonb;
    end if;
    if exists (
      with selections as (
        select line.product_id, selection.tracking_unit_id,
          sum(selection.quantity) quantity
        from public.sale_inventory_selections selection
        join public.sale_lines line
          on line.id = selection.sale_line_id
         and line.sale_id = selection.sale_id
         and line.tenant_id = selection.tenant_id
        where selection.sale_id = p_sale_id and selection.tenant_id = p_tenant_id
        group by line.product_id, selection.tracking_unit_id
      ), reservations as (
        select line.product_id, line.tracking_unit_id,
          line.reserved_quantity, line.released_quantity, line.delivered_quantity
        from public.inventory_reservation_lines line
        where line.reservation_id = v_reservation.id and line.tenant_id = p_tenant_id
      )
      select 1 from selections selection
      full join reservations reservation
        on reservation.product_id = selection.product_id
       and reservation.tracking_unit_id is not distinct from selection.tracking_unit_id
      where selection.product_id is null or reservation.product_id is null
         or selection.quantity <> reservation.reserved_quantity
         or reservation.released_quantity <> 0
    ) or exists (
      select 1
      from public.inventory_delivery_lines inventory_line
      join public.inventory_deliveries inventory_delivery
        on inventory_delivery.id = inventory_line.delivery_id
       and inventory_delivery.tenant_id = inventory_line.tenant_id
      left join lateral (
        select coalesce(sum(sales_line.quantity), 0) quantity
        from public.sale_delivery_lines sales_line
        where sales_line.inventory_delivery_line_id = inventory_line.id
          and sales_line.tenant_id = inventory_line.tenant_id
      ) sales_allocation on true
      where inventory_delivery.reservation_id = v_reservation.id
        and inventory_delivery.tenant_id = p_tenant_id
        and sales_allocation.quantity <> inventory_line.quantity
    ) or v_delivered <> v_reservation_delivered or v_delivered > v_required then
      v_blockers := v_blockers || '"SALE_FULFILLMENT_STATE_INCONSISTENT"'::jsonb;
    end if;
    if v_delivered = 0 then v_status := 'reserved';
    elsif v_delivered < v_required then v_status := 'partially_delivered';
    elsif v_delivered = v_required then v_status := 'delivered';
    else v_status := 'inconsistent'; end if;
    if v_delivered = v_required and v_required > 0 then
      v_blockers := v_blockers || '"SALE_ALREADY_DELIVERED"'::jsonb;
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sale_line_id', line.id,
    'product_id', line.product_id,
    'product_name', product.display_name,
    'tracking_requirement', line.tracking_requirement,
    'ordered_quantity', line.quantity,
    'delivered_quantity', coalesce(delivered.quantity, 0),
    'remaining_quantity', line.quantity - coalesce(delivered.quantity, 0),
    'tracking_units', case when line.tracking_requirement = 'serial' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'tracking_unit_id', selection.tracking_unit_id,
        'tracking_number', unit.tracking_number,
        'state', canonical_state.state,
        'deliverable', coalesce(delivered_unit.quantity, 0) = 0
          and canonical_state.state = 'reserved'
      ) order by unit.tracking_number)
      from public.sale_inventory_selections selection
      join public.stock_tracking_units unit
        on unit.id = selection.tracking_unit_id and unit.tenant_id = selection.tenant_id
      join public.inventory_tracking_unit_states canonical_state
        on canonical_state.tracking_unit_id = selection.tracking_unit_id
       and canonical_state.tenant_id = selection.tenant_id
      left join lateral (
        select sum(delivery_line.quantity) quantity
        from public.sale_delivery_lines delivery_line
        where delivery_line.sale_id = p_sale_id
          and delivery_line.sale_line_id = line.id
          and delivery_line.tracking_unit_id = selection.tracking_unit_id
          and delivery_line.tenant_id = p_tenant_id
      ) delivered_unit on true
      where selection.sale_id = p_sale_id
        and selection.sale_line_id = line.id
        and selection.tenant_id = p_tenant_id
    ), '[]'::jsonb) else '[]'::jsonb end
  ) order by line.line_position), '[]'::jsonb) into v_lines
  from public.sale_lines line
  join public.product_products product
    on product.id = line.product_id and product.tenant_id = line.tenant_id
  join public.product_templates template
    on template.id = product.product_template_id and template.tenant_id = product.tenant_id
  left join lateral (
    select sum(delivery_line.quantity) quantity
    from public.sale_delivery_lines delivery_line
    where delivery_line.sale_id = p_sale_id
      and delivery_line.sale_line_id = line.id
      and delivery_line.tenant_id = p_tenant_id
  ) delivered on true
  where line.sale_id = p_sale_id and line.tenant_id = p_tenant_id
    and template.product_type = 'goods';

  return jsonb_build_object(
    'found', true,
    'sale_id', v_sale.id,
    'sale_number', v_sale.sale_number,
    'commercial_status', v_sale.status,
    'version', v_sale.version,
    'eligible', jsonb_array_length(v_blockers) = 0,
    'fulfillment_status', v_status,
    'required_quantity', v_required,
    'delivered_quantity', v_delivered,
    'remaining_quantity', greatest(v_required - v_delivered, 0),
    'location', case when v_location.id is null then null else
      jsonb_build_object('id', v_location.id, 'name', v_location.name) end,
    'deliverable_lines', v_lines,
    'blocking_reasons', v_blockers,
    'reservation_id', v_reservation.id,
    'confirmation_link_id', v_confirmation.id
  );
end
$$;

comment on function public.sale_delivery_snapshot(uuid, uuid) is
  'Internal authoritative fulfillment snapshot; safely supports sales with no Inventory requirement.';

commit;
