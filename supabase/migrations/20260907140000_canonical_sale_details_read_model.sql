begin;

-- A single business-safe read model for the Canonical Sales details screen.
-- It deliberately exposes no accounting posting identity or Inventory command identity.
create or replace function public.get_sale_details(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_base jsonb;
  v_status text;
  v_total numeric(18,2);
  v_payment jsonb;
  v_fulfillment_snapshot jsonb;
  v_fulfillment jsonb;
  v_lines jsonb;
  v_events jsonb;
  v_location jsonb;
  v_required numeric(18,4) := 0;
  v_selected numeric(18,4) := 0;
  v_delivered numeric(18,4) := 0;
begin
  -- Reuse the authoritative tenant, permission and branch-scoped sale reader.
  v_base := public.get_sale(p_sale_id);
  v_status := v_base ->> 'status';
  v_total := coalesce((v_base ->> 'total_amount')::numeric, 0);

  if v_status = 'draft' then
    v_payment := jsonb_build_object(
      'status', 'not_confirmed',
      'total_amount', v_total,
      'settled_amount', 0,
      'outstanding_amount', v_total,
      'currency_code', v_base ->> 'currency_code'
    );
  else
    select jsonb_build_object(
      'status', case
        when greatest(least(posting.amount, receivable.amount_residual), 0) <= 0 then 'paid'
        when greatest(least(posting.amount, receivable.amount_residual), 0) < posting.amount then 'partially_paid'
        else 'unpaid'
      end,
      'total_amount', posting.amount,
      'settled_amount', greatest(posting.amount - greatest(least(posting.amount, receivable.amount_residual), 0), 0),
      'outstanding_amount', greatest(least(posting.amount, receivable.amount_residual), 0),
      'currency_code', posting.currency_code
    ) into v_payment
    from public.sale_confirmation_links confirmation
    join public.financial_sale_postings posting
      on posting.id = confirmation.financial_sale_posting_id
     and posting.tenant_id = confirmation.tenant_id
     and posting.source_app = 'sales_core'
     and posting.source_model = 'sale'
     and posting.source_id = p_sale_id::text
     and posting.state = 'posted'
    join public.account_move_lines receivable
      on receivable.id = posting.receivable_line_id
     and receivable.tenant_id = posting.tenant_id
     and receivable.parent_state = 'posted'
     and receivable.line_type = 'open_item'
    where confirmation.sale_id = p_sale_id
      and confirmation.tenant_id = v_tenant_id;

    if v_payment is null then
      v_payment := jsonb_build_object(
        'status', 'unpaid',
        'total_amount', v_total,
        'settled_amount', 0,
        'outstanding_amount', v_total,
        'currency_code', v_base ->> 'currency_code'
      );
    end if;
  end if;

  select coalesce(sum(line.quantity), 0) into v_required
  from public.sale_lines line
  join public.product_products product
    on product.id = line.product_id and product.tenant_id = line.tenant_id
  join public.product_templates template
    on template.id = product.product_template_id and template.tenant_id = product.tenant_id
  where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
    and template.product_type in ('goods', 'consumable');

  if v_status = 'draft' then
    select coalesce(sum(intent.quantity), 0) into v_selected
    from public.sale_draft_inventory_intents intent
    where intent.sale_id = p_sale_id and intent.tenant_id = v_tenant_id;

    if (v_base ->> 'draft_inventory_location_id') is not null then
      select jsonb_build_object('id', location.id, 'name', location.name)
      into v_location
      from public.stock_locations location
      where location.id = (v_base ->> 'draft_inventory_location_id')::uuid
        and location.tenant_id = v_tenant_id;
    end if;

    v_fulfillment := jsonb_build_object(
      'status', case when v_required = 0 then 'not_required' else 'unreserved' end,
      'required_quantity', v_required,
      'selected_quantity', v_selected,
      'reserved_quantity', 0,
      'delivered_quantity', 0,
      'remaining_quantity', v_required,
      'location', v_location
    );
  else
    v_fulfillment_snapshot := public.sale_delivery_snapshot(v_tenant_id, p_sale_id);
    v_delivered := coalesce((v_fulfillment_snapshot ->> 'delivered_quantity')::numeric, 0);
    select coalesce(sum(selection.quantity), 0) into v_selected
    from public.sale_inventory_selections selection
    where selection.sale_id = p_sale_id and selection.tenant_id = v_tenant_id;

    v_fulfillment := jsonb_build_object(
      'status', case
        when v_fulfillment_snapshot ->> 'fulfillment_status' in (
          'unreserved', 'reserved', 'partially_delivered', 'delivered', 'not_required'
        ) then v_fulfillment_snapshot ->> 'fulfillment_status'
        when v_required = 0 then 'not_required'
        else 'unreserved'
      end,
      'required_quantity', coalesce((v_fulfillment_snapshot ->> 'required_quantity')::numeric, v_required),
      'selected_quantity', v_selected,
      'reserved_quantity', greatest(v_selected - v_delivered, 0),
      'delivered_quantity', v_delivered,
      'remaining_quantity', greatest(v_required - v_delivered, 0),
      'location', v_fulfillment_snapshot -> 'location'
    );
  end if;

  with line_rows as (
    select
      line.id,
      line.line_position,
      line.product_id,
      line.description,
      line.quantity,
      line.unit_price,
      line.line_total,
      line.tracking_requirement,
      product.display_name,
      product.sku,
      product.barcode,
      product.tracking,
      product.sale_price,
      template.product_type,
      coalesce((
        select sum(intent.quantity)
        from public.sale_draft_inventory_intents intent
        where v_status = 'draft'
          and intent.sale_line_id = line.id
          and intent.tenant_id = line.tenant_id
      ), (
        select sum(selection.quantity)
        from public.sale_inventory_selections selection
        where v_status <> 'draft'
          and selection.sale_line_id = line.id
          and selection.tenant_id = line.tenant_id
      ), 0) selected_quantity,
      coalesce((
        select sum(delivery_line.quantity)
        from public.sale_delivery_lines delivery_line
        where delivery_line.sale_line_id = line.id
          and delivery_line.tenant_id = line.tenant_id
      ), 0) delivered_quantity
    from public.sale_lines line
    join public.product_products product
      on product.id = line.product_id and product.tenant_id = line.tenant_id
    join public.product_templates template
      on template.id = product.product_template_id and template.tenant_id = product.tenant_id
    where line.sale_id = p_sale_id and line.tenant_id = v_tenant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row_data.id,
    'position', row_data.line_position,
    'product', jsonb_build_object(
      'id', row_data.product_id,
      'name', row_data.display_name,
      'sku', row_data.sku,
      'barcode', row_data.barcode,
      'tracking', row_data.tracking,
      'product_type', row_data.product_type,
      'sale_price', row_data.sale_price
    ),
    'description', row_data.description,
    'quantity', row_data.quantity,
    'unit_price', row_data.unit_price,
    'line_total', row_data.line_total,
    'tracking_requirement', row_data.tracking_requirement,
    'inventory', jsonb_build_object(
      'kind', case
        when row_data.product_type = 'service' then 'service'
        when row_data.tracking_requirement = 'serial' then 'serial'
        else 'quantity'
      end,
      'status', case
        when row_data.product_type = 'service' then 'not_required'
        when v_status = 'draft' and row_data.selected_quantity > 0 then 'selected'
        when v_status = 'draft' then 'unselected'
        when row_data.delivered_quantity >= row_data.quantity then 'delivered'
        when row_data.delivered_quantity > 0 then 'partially_delivered'
        when row_data.selected_quantity > 0 then 'reserved'
        else 'unreserved'
      end,
      'selected_quantity', row_data.selected_quantity,
      'reserved_quantity', case when v_status = 'draft' then 0
        else greatest(row_data.selected_quantity - row_data.delivered_quantity, 0) end,
      'delivered_quantity', row_data.delivered_quantity,
      'remaining_quantity', case when row_data.product_type = 'service' then 0
        else greatest(row_data.quantity - row_data.delivered_quantity, 0) end,
      'tracking_units', case when row_data.tracking_requirement = 'serial' then coalesce((
        with selected_units as (
          select intent.tracking_unit_id, intent.quantity, 'selected'::text state
          from public.sale_draft_inventory_intents intent
          where v_status = 'draft'
            and intent.sale_line_id = row_data.id
            and intent.tenant_id = v_tenant_id
            and intent.tracking_unit_id is not null
          union all
          select selection.tracking_unit_id, selection.quantity,
            case when exists (
              select 1 from public.sale_delivery_lines delivered
              where delivered.sale_line_id = row_data.id
                and delivered.tracking_unit_id = selection.tracking_unit_id
                and delivered.tenant_id = v_tenant_id
            ) then 'delivered' else 'reserved' end
          from public.sale_inventory_selections selection
          where v_status <> 'draft'
            and selection.sale_line_id = row_data.id
            and selection.tenant_id = v_tenant_id
            and selection.tracking_unit_id is not null
        )
        select jsonb_agg(jsonb_build_object(
          'id', unit.id,
          'tracking_number', unit.tracking_number,
          'chassis_number', coalesce(chassis.value, unit.tracking_number),
          'engine_number', engine.value,
          'attributes', coalesce(attributes.items, '[]'::jsonb),
          'state', selected_unit.state
        ) order by coalesce(chassis.value, unit.tracking_number), unit.id)
        from selected_units selected_unit
        join public.stock_tracking_units unit
          on unit.id = selected_unit.tracking_unit_id and unit.tenant_id = v_tenant_id
        left join lateral (
          select identifier.value
          from public.stock_tracking_unit_identifiers identifier
          join public.product_tracking_identifier_types identifier_type
            on identifier_type.id = identifier.identifier_type_id
           and identifier_type.tenant_id = identifier.tenant_id
          where identifier.tracking_unit_id = unit.id
            and identifier.tenant_id = unit.tenant_id
            and not identifier.is_not_available
            and (identifier_type.code || ' ' || identifier_type.name) ~* '(chassis|شاسيه)'
          order by identifier.created_at, identifier.id limit 1
        ) chassis on true
        left join lateral (
          select identifier.value
          from public.stock_tracking_unit_identifiers identifier
          join public.product_tracking_identifier_types identifier_type
            on identifier_type.id = identifier.identifier_type_id
           and identifier_type.tenant_id = identifier.tenant_id
          where identifier.tracking_unit_id = unit.id
            and identifier.tenant_id = unit.tenant_id
            and not identifier.is_not_available
            and (identifier_type.code || ' ' || identifier_type.name) ~* '(engine|motor|موتور|محرك)'
          order by identifier.created_at, identifier.id limit 1
        ) engine on true
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'name', attribute.name,
            'value', coalesce(attribute_value.name, unit_attribute.value_text)
          ) order by attribute.name, unit_attribute.id) items
          from public.stock_tracking_unit_attributes unit_attribute
          join public.product_attributes attribute
            on attribute.id = unit_attribute.attribute_id
           and attribute.tenant_id = unit_attribute.tenant_id
          left join public.product_attribute_values attribute_value
            on attribute_value.id = unit_attribute.attribute_value_id
           and attribute_value.tenant_id = unit_attribute.tenant_id
          where unit_attribute.tracking_unit_id = unit.id
            and unit_attribute.tenant_id = unit.tenant_id
        ) attributes on true
      ), '[]'::jsonb) else '[]'::jsonb end
    ),
    'draft_inventory_intents', case when v_status = 'draft' then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', intent.id,
        'location_id', intent.location_id,
        'tracking_unit_id', intent.tracking_unit_id,
        'quantity', intent.quantity,
        'tracking_number', tracking_unit.tracking_number
      ) order by intent.id)
      from public.sale_draft_inventory_intents intent
      left join public.stock_tracking_units tracking_unit
        on tracking_unit.id = intent.tracking_unit_id and tracking_unit.tenant_id = intent.tenant_id
      where intent.sale_line_id = row_data.id and intent.tenant_id = v_tenant_id
    ), '[]'::jsonb) else '[]'::jsonb end
  ) order by row_data.line_position), '[]'::jsonb)
  into v_lines
  from line_rows row_data;

  select coalesce(jsonb_agg(jsonb_build_object(
    'type', event.event_type,
    'version', event.sale_version,
    'occurred_at', event.occurred_at,
    'actor', jsonb_build_object('name', actor.full_name),
    'summary', case event.event_type
      when 'sale_draft_updated' then jsonb_build_object(
        'line_count', event.payload -> 'line_count',
        'total_amount', event.payload -> 'total_amount'
      )
      when 'sale_confirmed' then jsonb_build_object(
        'sale_number', event.payload -> 'sale_number',
        'total_amount', event.payload -> 'total_amount'
      )
      when 'sale_partially_delivered' then jsonb_build_object(
        'delivered_quantity', event.payload -> 'delivered_quantity'
      )
      when 'sale_delivered' then jsonb_build_object(
        'delivered_quantity', event.payload -> 'delivered_quantity'
      )
      else '{}'::jsonb
    end
  ) order by event.occurred_at, event.sale_version), '[]'::jsonb)
  into v_events
  from public.sale_events event
  join public.tenant_users actor
    on actor.id = event.actor_id and actor.tenant_id = event.tenant_id
  where event.sale_id = p_sale_id and event.tenant_id = v_tenant_id;

  return (v_base - 'financial' - 'inventory' - 'lines') || jsonb_build_object(
    'commercial_status', v_status,
    'payment', v_payment,
    'fulfillment', v_fulfillment,
    'lines', v_lines,
    'events', v_events
  );
end
$$;

revoke all on function public.get_sale_details(uuid) from public, anon, service_role;
grant execute on function public.get_sale_details(uuid) to authenticated;

comment on function public.get_sale_details(uuid) is
  'One-sale business read model with commercial, settlement, fulfillment, line execution and event summaries; no accounting or command identifiers.';

notify pgrst, 'reload schema';

commit;
