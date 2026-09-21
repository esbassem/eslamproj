-- Canonical Sale Draft Workspace runtime proof. All fixtures roll back.
begin;

create temporary table sale_draft_context as
select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth
from public.tenant_users owner
where owner.role = 'owner' and owner.is_active and owner.auth_user_id is not null
order by owner.tenant_id limit 1;

do $$ begin
  if not exists (select 1 from sale_draft_context) then
    raise exception 'SALE_DRAFT_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end $$;

create temporary table sale_draft_resources (
  branch_id uuid, location_id uuid, customer_id uuid,
  serial_template_id uuid, serial_product_id uuid, serial_unit_id uuid, unavailable_unit_id uuid,
  quantity_template_id uuid, quantity_product_id uuid,
  service_template_id uuid, service_product_id uuid,
  sale_id uuid
);
grant select, update on sale_draft_resources to authenticated;
grant select on sale_draft_context to authenticated;

do $$
declare
  context sale_draft_context%rowtype;
  resources sale_draft_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
begin
  select * into context from sale_draft_context;
  resources.branch_id := gen_random_uuid(); resources.location_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid(); resources.serial_template_id := gen_random_uuid();
  resources.serial_product_id := gen_random_uuid(); resources.serial_unit_id := gen_random_uuid();
  resources.unavailable_unit_id := gen_random_uuid(); resources.quantity_template_id := gen_random_uuid();
  resources.quantity_product_id := gen_random_uuid(); resources.service_template_id := gen_random_uuid();
  resources.service_product_id := gen_random_uuid();

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (resources.branch_id, context.tenant_id, 'Draft Runtime Branch', 'DR' || left(suffix, 5), true);
  insert into public.stock_locations (id, tenant_id, branch_id, code, name, location_type, is_active)
  values (resources.location_id, context.tenant_id, resources.branch_id, 'DL' || left(suffix, 5), 'Draft Runtime Stock', 'internal', true);
  insert into public.partners (
    id, tenant_id, branch_id, name, mobile, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values (
    resources.customer_id, context.tenant_id, resources.branch_id,
    'Draft Customer ' || suffix, '010' || suffix, 'person', false, true, 1, 0, 0, true
  );
  insert into public.product_templates (
    id, tenant_id, name, internal_reference, product_type, tracking,
    can_be_sold, is_active, sale_price
  ) values
    (resources.serial_template_id, context.tenant_id, 'Draft Moto ' || suffix, 'DSM-' || suffix, 'goods', 'serial', true, true, 50000),
    (resources.quantity_template_id, context.tenant_id, 'Draft Quantity ' || suffix, 'DSQ-' || suffix, 'goods', 'none', true, true, 100),
    (resources.service_template_id, context.tenant_id, 'Draft Service ' || suffix, 'DSS-' || suffix, 'service', 'none', true, true, 50);
  insert into public.product_products (
    id, tenant_id, product_template_id, display_name, sku, tracking, is_active, sale_price
  ) values
    (resources.serial_product_id, context.tenant_id, resources.serial_template_id, 'Draft Moto ' || suffix, 'DSM-' || suffix, 'serial', true, 50000),
    (resources.quantity_product_id, context.tenant_id, resources.quantity_template_id, 'Draft Quantity ' || suffix, 'DSQ-' || suffix, 'none', true, 100),
    (resources.service_product_id, context.tenant_id, resources.service_template_id, 'Draft Service ' || suffix, 'DSS-' || suffix, 'none', true, 50);
  update public.product_templates template set default_product_product_id = product.id
  from public.product_products product
  where template.id in (resources.serial_template_id, resources.quantity_template_id, resources.service_template_id)
    and product.product_template_id = template.id;
  insert into public.stock_tracking_units (
    id, tenant_id, product_product_id, product_template_id, tracking_type,
    tracking_number, status, data_status, current_location_id
  ) values
    (resources.serial_unit_id, context.tenant_id, resources.serial_product_id, resources.serial_template_id, 'serial', 'CH-' || suffix, 'in_stock', 'complete', resources.location_id),
    (resources.unavailable_unit_id, context.tenant_id, resources.serial_product_id, resources.serial_template_id, 'serial', 'SOLD-' || suffix, 'sold', 'complete', resources.location_id);
  insert into public.stock_quants (
    tenant_id, product_product_id, product_template_id, location_id,
    quantity_on_hand, reserved_quantity
  ) values (context.tenant_id, resources.quantity_product_id, resources.quantity_template_id, resources.location_id, 10, 0);
  insert into public.user_operational_defaults (tenant_id, user_id, default_branch_id, default_stock_location_id)
  values (context.tenant_id, context.owner_id, resources.branch_id, resources.location_id)
  on conflict (tenant_id, user_id) do update set
    default_branch_id = excluded.default_branch_id,
    default_pos_id = null,
    default_stock_location_id = excluded.default_stock_location_id,
    updated_at = now();
  insert into sale_draft_resources values (resources.*);
end $$;

select set_config('request.jwt.claim.sub', owner_auth::text, true) from sale_draft_context;
set local role authenticated;

-- Options and searches are scoped and paginated; unavailable serials are excluded.
do $$
declare resources sale_draft_resources%rowtype; options jsonb; customers jsonb; products jsonb; units jsonb; availability jsonb;
begin
  select * into resources from sale_draft_resources;
  options := public.get_sale_draft_options();
  customers := public.search_sale_customers('Draft Customer', 1, 10);
  products := public.search_sale_products('Draft', 1, 10);
  units := public.search_sale_tracking_units(resources.branch_id, resources.serial_product_id, resources.location_id, null, 1, 10);
  availability := public.get_sale_quantity_availability(resources.branch_id, resources.quantity_product_id, resources.location_id, 2);
  if options ->> 'default_branch_id' <> resources.branch_id::text
     or options ->> 'default_stock_location_id' <> resources.location_id::text
     or jsonb_array_length(customers -> 'items') <> 1
     or jsonb_array_length(products -> 'items') <> 3
     or jsonb_array_length(units -> 'items') <> 1
     or units -> 'items' -> 0 ->> 'id' <> resources.serial_unit_id::text
     or (availability ->> 'available_quantity')::numeric <> 10
     or not (availability ->> 'is_available')::boolean then
    raise exception 'DRAFT_READ_CONTRACT_FAILED: %, %, %, %, %', options, customers, products, units, availability;
  end if;
end $$;

-- Create then atomically save serialized, quantity and service lines.
do $$
declare resources sale_draft_resources%rowtype; created jsonb; updated jsonb; dto jsonb; details jsonb;
begin
  select * into resources from sale_draft_resources;
  created := public.create_sale(resources.branch_id, resources.customer_id, current_date, 'EGP', 'Draft runtime', 'draft-workspace-create');
  resources.sale_id := (created ->> 'sale_id')::uuid;
  update sale_draft_resources set sale_id = resources.sale_id;
  updated := public.update_sale_draft(
    resources.sale_id, 1, resources.branch_id, resources.customer_id, current_date,
    'EGP', 'Draft runtime', jsonb_build_array(
      jsonb_build_object('product_id', resources.serial_product_id, 'quantity', 1, 'unit_price', 50000),
      jsonb_build_object('product_id', resources.quantity_product_id, 'quantity', 2, 'unit_price', 100),
      jsonb_build_object('product_id', resources.service_product_id, 'quantity', 1, 'unit_price', 50)
    ), 'draft-workspace-update', jsonb_build_array(
      jsonb_build_object('line_position', 1, 'location_id', resources.location_id, 'tracking_unit_id', resources.serial_unit_id, 'quantity', 1),
      jsonb_build_object('line_position', 2, 'location_id', resources.location_id, 'tracking_unit_id', null, 'quantity', 2)
    )
  );
  dto := public.get_sale(resources.sale_id);
  details := public.get_sale_details(resources.sale_id);
  if (updated ->> 'version')::bigint <> 2
     or (updated ->> 'total_amount')::numeric <> 50250
     or (select count(*) from public.sale_lines where sale_id = resources.sale_id) <> 3
     or (select count(*) from public.sale_draft_inventory_intents where sale_id = resources.sale_id) <> 2
     or dto ->> 'draft_inventory_location_id' <> resources.location_id::text
     or jsonb_array_length(dto -> 'lines' -> 0 -> 'draft_inventory_intents') <> 1
     or details ->> 'commercial_status' <> 'draft'
     or details -> 'payment' ->> 'status' <> 'not_confirmed'
     or details -> 'fulfillment' ->> 'status' <> 'unreserved'
     or details ? 'financial' or details ? 'inventory'
     or jsonb_array_length(details -> 'events') <> 2
     or details -> 'lines' -> 0 -> 'inventory' ->> 'status' <> 'selected'
     or exists (select 1 from public.inventory_reservations where source_type = 'sale' and source_id = resources.sale_id::text)
     or exists (select 1 from public.financial_sale_postings where source_app = 'sales_core' and source_id = resources.sale_id::text) then
    raise exception 'DRAFT_SAVE_FAILED: %, %', updated, dto;
  end if;
end $$;

-- Retry is stable; no duplicate lines, intents, version, or event.
do $$
declare resources sale_draft_resources%rowtype; replay jsonb;
begin
  select * into resources from sale_draft_resources;
  replay := public.update_sale_draft(
    resources.sale_id, 1, resources.branch_id, resources.customer_id, current_date,
    'EGP', 'Draft runtime', jsonb_build_array(
      jsonb_build_object('product_id', resources.serial_product_id, 'quantity', 1, 'unit_price', 50000),
      jsonb_build_object('product_id', resources.quantity_product_id, 'quantity', 2, 'unit_price', 100),
      jsonb_build_object('product_id', resources.service_product_id, 'quantity', 1, 'unit_price', 50)
    ), 'draft-workspace-update', jsonb_build_array(
      jsonb_build_object('line_position', 1, 'location_id', resources.location_id, 'tracking_unit_id', resources.serial_unit_id, 'quantity', 1),
      jsonb_build_object('line_position', 2, 'location_id', resources.location_id, 'tracking_unit_id', null, 'quantity', 2)
    )
  );
  if not (replay ->> 'idempotent_replay')::boolean
     or (select version from public.sales where id = resources.sale_id) <> 2
     or (select count(*) from public.sale_lines where sale_id = resources.sale_id) <> 3
     or (select count(*) from public.sale_draft_inventory_intents where sale_id = resources.sale_id) <> 2
     or (select count(*) from public.sale_events where sale_id = resources.sale_id and event_type = 'sale_draft_updated') <> 1 then
    raise exception 'DRAFT_REPLAY_DUPLICATED_STATE: %', replay;
  end if;
end $$;

-- Existing draft can be edited with expected_version; stale writes fail closed.
do $$
declare resources sale_draft_resources%rowtype; updated jsonb; stale_rejected boolean := false;
begin
  select * into resources from sale_draft_resources;
  updated := public.update_sale_draft(
    resources.sale_id, 2, resources.branch_id, resources.customer_id, current_date,
    'EGP', 'Edited draft', jsonb_build_array(
      jsonb_build_object('product_id', resources.quantity_product_id, 'quantity', 3, 'unit_price', 100),
      jsonb_build_object('product_id', resources.service_product_id, 'quantity', 1, 'unit_price', 75)
    ), 'draft-workspace-edit', jsonb_build_array(
      jsonb_build_object('line_position', 1, 'location_id', resources.location_id, 'tracking_unit_id', null, 'quantity', 3)
    )
  );
  begin
    perform public.update_sale_draft(
      resources.sale_id, 2, resources.branch_id, resources.customer_id, current_date,
      'EGP', 'Stale draft', '[]'::jsonb, 'draft-workspace-stale', '[]'::jsonb
    );
  exception when serialization_failure then stale_rejected := true; end;
  if (updated ->> 'version')::bigint <> 3 or not stale_rejected
     or (select count(*) from public.sale_draft_inventory_intents where sale_id = resources.sale_id) <> 1
     or exists (select 1 from public.inventory_reservations where source_type = 'sale' and source_id = resources.sale_id::text)
     or exists (select 1 from public.account_moves where ref = 'sale:' || resources.sale_id::text) then
    raise exception 'DRAFT_EDIT_OR_VERSION_FAILED: %', updated;
  end if;
end $$;

reset role;
select jsonb_build_object(
  'read_contracts', 'passed',
  'create_and_multiline', 'passed',
  'serialized_intent', 'passed',
  'quantity_and_service', 'passed',
  'edit_and_version', 'passed',
  'idempotency', 'passed',
  'no_inventory_reservation', 'passed',
  'no_financial_posting', 'passed'
) canonical_sale_draft_workspace_runtime;

rollback;
