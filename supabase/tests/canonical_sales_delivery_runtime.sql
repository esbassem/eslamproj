-- Canonical Sales Delivery integration. All fixtures and side effects roll back.
begin;

create temporary table sales_delivery_context as
select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth,
  unassigned.id operator_auth, foreign_member.auth_user_id foreign_auth
from public.tenant_users owner
join lateral (
  select auth_user.id from auth.users auth_user
  where not exists (
    select 1 from public.tenant_users member where member.auth_user_id = auth_user.id
  )
  order by auth_user.created_at, auth_user.id limit 1
) unassigned on true
join lateral (
  select member.auth_user_id from public.tenant_users member
  where member.tenant_id <> owner.tenant_id and member.is_active
    and member.auth_user_id is not null
    and not exists (
      select 1 from public.tenant_users target
      where target.tenant_id = owner.tenant_id
        and target.auth_user_id = member.auth_user_id and target.is_active
    )
  order by member.tenant_id, member.id limit 1
) foreign_member on true
where owner.role = 'owner' and owner.is_active and owner.auth_user_id is not null
  and exists (
    select 1 from public.account_functional_accounts configuration
    where configuration.tenant_id = owner.tenant_id
      and configuration.functional_role = 'customer_receivable'
      and configuration.is_active
  )
  and exists (
    select 1 from public.account_functional_accounts configuration
    where configuration.tenant_id = owner.tenant_id
      and configuration.functional_role = 'sales_revenue'
      and configuration.is_active
  )
order by owner.tenant_id limit 1;

do $$ begin
  if not exists (select 1 from sales_delivery_context) then
    raise exception 'SALES_DELIVERY_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end $$;

create temporary table sales_delivery_resources (
  branch_id uuid, wrong_branch_id uuid,
  location_id uuid, denied_location_id uuid, wrong_branch_location_id uuid,
  customer_id uuid, operator_id uuid, permission_group_id uuid,
  serial_template_id uuid, serial_product_id uuid, serial_unit_id uuid,
  quantity_template_id uuid, quantity_product_id uuid,
  serial_sale_id uuid, serial_line_id uuid,
  quantity_sale_id uuid, quantity_line_id uuid,
  draft_sale_id uuid, invalid_sale_id uuid,
  wrong_branch_sale_id uuid, wrong_location_sale_id uuid,
  inventory_failure_sale_id uuid, link_failure_sale_id uuid,
  event_failure_sale_id uuid
);
grant select on sales_delivery_context to authenticated;
grant select, update on sales_delivery_resources to authenticated;

do $$
declare
  context sales_delivery_context%rowtype;
  resources sales_delivery_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  receivable_account_id uuid;
  revenue_account_id uuid;
begin
  select * into context from sales_delivery_context;
  resources.branch_id := gen_random_uuid();
  resources.wrong_branch_id := gen_random_uuid();
  resources.location_id := gen_random_uuid();
  resources.denied_location_id := gen_random_uuid();
  resources.wrong_branch_location_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid();
  resources.operator_id := gen_random_uuid();
  resources.permission_group_id := gen_random_uuid();
  resources.serial_template_id := gen_random_uuid();
  resources.serial_product_id := gen_random_uuid();
  resources.serial_unit_id := gen_random_uuid();
  resources.quantity_template_id := gen_random_uuid();
  resources.quantity_product_id := gen_random_uuid();

  receivable_account_id := public.resolve_functional_account(
    context.tenant_id, 'customer_receivable', null
  );
  revenue_account_id := public.resolve_functional_account(
    context.tenant_id, 'sales_revenue', null
  );
  insert into public.branches (id, tenant_id, name, code, is_active) values
    (resources.branch_id, context.tenant_id, 'Sales Delivery Branch', 'SDB' || left(suffix, 4), true),
    (resources.wrong_branch_id, context.tenant_id, 'Sales Delivery Denied Branch', 'SDW' || left(suffix, 4), true);
  insert into public.stock_locations (
    id, tenant_id, branch_id, code, name, location_type, is_active
  ) values
    (resources.location_id, context.tenant_id, resources.branch_id,
      'SDL' || left(suffix, 5), 'Sales Delivery Location', 'internal', true),
    (resources.denied_location_id, context.tenant_id, resources.branch_id,
      'SDD' || left(suffix, 5), 'Sales Delivery Denied Location', 'internal', true),
    (resources.wrong_branch_location_id, context.tenant_id, resources.wrong_branch_id,
      'SDW' || left(suffix, 5), 'Sales Delivery Wrong Branch Location', 'internal', true);
  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values (
    resources.customer_id, context.tenant_id, resources.branch_id,
    'Sales Delivery Customer', 'person', false, true, 1, 0, 0, true
  );

  perform public.resolve_financial_journal(context.tenant_id, 'sale', resources.branch_id, null);
  perform public.resolve_financial_journal(context.tenant_id, 'sale', resources.wrong_branch_id, null);
  insert into public.account_functional_accounts (
    tenant_id, branch_id, functional_role, account_id
  ) values
    (context.tenant_id, resources.branch_id, 'customer_receivable', receivable_account_id),
    (context.tenant_id, resources.branch_id, 'sales_revenue', revenue_account_id),
    (context.tenant_id, resources.wrong_branch_id, 'customer_receivable', receivable_account_id),
    (context.tenant_id, resources.wrong_branch_id, 'sales_revenue', revenue_account_id);

  insert into public.product_templates (
    id, tenant_id, name, internal_reference, product_type, tracking,
    can_be_sold, is_active, sale_price
  ) values
    (resources.serial_template_id, context.tenant_id, 'Sales Delivery Serial',
      'SDS-' || suffix, 'goods', 'serial', true, true, 1000),
    (resources.quantity_template_id, context.tenant_id, 'Sales Delivery Quantity',
      'SDQ-' || suffix, 'goods', 'none', true, true, 100);
  insert into public.product_products (
    id, tenant_id, product_template_id, display_name, sku, tracking,
    is_active, sale_price
  ) values
    (resources.serial_product_id, context.tenant_id, resources.serial_template_id,
      'Sales Delivery Serial', 'SDS-' || suffix, 'serial', true, 1000),
    (resources.quantity_product_id, context.tenant_id, resources.quantity_template_id,
      'Sales Delivery Quantity', 'SDQ-' || suffix, 'none', true, 100);
  update public.product_templates template set default_product_product_id = product.id
  from public.product_products product
  where template.id in (resources.serial_template_id, resources.quantity_template_id)
    and product.product_template_id = template.id;
  insert into public.stock_tracking_units (
    id, tenant_id, product_product_id, product_template_id,
    tracking_type, tracking_number, status, data_status,
    incomplete_reason, current_location_id
  ) values (
    resources.serial_unit_id, context.tenant_id, resources.serial_product_id,
    resources.serial_template_id, 'serial', 'SDSU-' || suffix,
    'in_stock', 'complete', null, resources.location_id
  );
  insert into public.stock_quants (
    tenant_id, product_product_id, product_template_id, location_id,
    quantity_on_hand, reserved_quantity
  ) values
    (context.tenant_id, resources.quantity_product_id, resources.quantity_template_id,
      resources.location_id, 100, 0),
    (context.tenant_id, resources.quantity_product_id, resources.quantity_template_id,
      resources.denied_location_id, 100, 0),
    (context.tenant_id, resources.quantity_product_id, resources.quantity_template_id,
      resources.wrong_branch_location_id, 100, 0);

  insert into public.tenant_users (id, tenant_id, auth_user_id, full_name, role, is_active)
  values (resources.operator_id, context.tenant_id, context.operator_auth,
    'Sales Delivery Operator', 'staff', true);
  insert into public.res_groups (id, tenant_id, name, code, category, is_system, active)
  values (resources.permission_group_id, context.tenant_id, 'Sales Delivery Runtime',
    'sales_delivery_runtime_' || suffix, 'sales', false, true);
  insert into public.auth_group_permissions (group_id, permission_id)
  select resources.permission_group_id, permission.id
  from public.auth_permissions permission
  where permission.code in (
    'sales.access', 'sales.create', 'sales.update_draft',
    'sales.view', 'sales.confirm', 'sales.deliver'
  );
  insert into public.res_users_groups (tenant_id, user_id, group_id)
  values (context.tenant_id, resources.operator_id, resources.permission_group_id);
  insert into public.user_branch_access (tenant_id, user_id, branch_id)
  values (context.tenant_id, resources.operator_id, resources.branch_id);
  insert into public.user_stock_location_access (
    tenant_id, user_id, stock_location_id, branch_id
  ) values (context.tenant_id, resources.operator_id,
    resources.location_id, resources.branch_id);

  insert into sales_delivery_resources values (resources.*);
end
$$;

create function pg_temp.create_delivery_sale(
  p_key text,
  p_product_id uuid,
  p_quantity numeric,
  p_branch_id uuid,
  p_location_id uuid,
  p_tracking_unit_id uuid default null,
  p_confirm boolean default true
)
returns table(sale_id uuid, sale_line_id uuid)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare resources sales_delivery_resources%rowtype; result jsonb;
begin
  select * into resources from sales_delivery_resources;
  result := public.create_sale(
    p_branch_id, resources.customer_id, current_date, 'EGP', p_key, p_key || '-create'
  );
  sale_id := (result ->> 'sale_id')::uuid;
  perform public.update_sale_draft(
    sale_id, 1, p_branch_id, resources.customer_id, current_date, 'EGP', p_key,
    jsonb_build_array(jsonb_build_object(
      'product_id', p_product_id, 'quantity', p_quantity,
      'unit_price', case when p_tracking_unit_id is null then 100 else 1000 end
    )), p_key || '-update'
  );
  select line.id into sale_line_id from public.sale_lines line
  where line.sale_id = create_delivery_sale.sale_id;
  if p_confirm then
    perform public.confirm_sale(
      sale_id, 2,
      jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'sale_line_id', sale_line_id, 'location_id', p_location_id,
        'tracking_unit_id', p_tracking_unit_id, 'quantity', p_quantity
      ))), p_key || '-confirm'
    );
  end if;
  return next;
end
$$;

create function pg_temp.delivery_artifact_count(p_sale_id uuid, p_kind text)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_kind = 'sales_delivery' then
    return (select count(*) from public.sale_deliveries where sale_id = p_sale_id);
  elsif p_kind = 'inventory_delivery' then
    return (
      select count(*)
      from public.inventory_deliveries delivery
      join public.sale_confirmation_links confirmation
        on confirmation.inventory_reservation_id = delivery.reservation_id
       and confirmation.tenant_id = delivery.tenant_id
      where confirmation.sale_id = p_sale_id
    );
  elsif p_kind = 'delivered_event' then
    return (select count(*) from public.sale_events
      where sale_id = p_sale_id and event_type = 'sale_delivered');
  elsif p_kind = 'partial_event' then
    return (select count(*) from public.sale_events
      where sale_id = p_sale_id and event_type = 'sale_partially_delivered');
  end if;
  raise exception 'UNKNOWN_DELIVERY_ARTIFACT_KIND';
end
$$;

create function pg_temp.sale_reservation_state(p_sale_id uuid)
returns text
language sql
security definer
set search_path = pg_catalog, public
as $$
  select reservation.state
  from public.sale_confirmation_links confirmation
  join public.inventory_reservations reservation
    on reservation.id = confirmation.inventory_reservation_id
   and reservation.tenant_id = confirmation.tenant_id
  where confirmation.sale_id = p_sale_id
$$;

create function pg_temp.sales_delivery_command_exists(p_key text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.sales_command_requests command_request
    where command_request.command_type = 'deliver'
      and command_request.idempotency_key = p_key
  )
$$;

create function pg_temp.sales_delivery_command_id(p_key text)
returns uuid
language sql
security definer
set search_path = pg_catalog, public
as $$
  select command_request.id from public.sales_command_requests command_request
  where command_request.command_type = 'deliver'
    and command_request.idempotency_key = p_key
  order by command_request.created_at desc limit 1
$$;

create function pg_temp.sale_reservation_id(p_sale_id uuid)
returns uuid
language sql
security definer
set search_path = pg_catalog, public
as $$
  select confirmation.inventory_reservation_id
  from public.sale_confirmation_links confirmation
  where confirmation.sale_id = p_sale_id
$$;

create function pg_temp.tracking_delivery_state(p_tracking_unit_id uuid)
returns jsonb
language sql
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'canonical_state', canonical_state.state,
    'unit_status', unit.status
  )
  from public.stock_tracking_units unit
  join public.inventory_tracking_unit_states canonical_state
    on canonical_state.tracking_unit_id = unit.id
   and canonical_state.tenant_id = unit.tenant_id
  where unit.id = p_tracking_unit_id
$$;

create function pg_temp.quantity_on_hand(p_product_id uuid, p_location_id uuid)
returns numeric
language sql
security definer
set search_path = pg_catalog, public
as $$
  select quant.quantity_on_hand from public.stock_quants quant
  where quant.product_product_id = p_product_id
    and quant.location_id = p_location_id
$$;

select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_delivery_context;
set local role authenticated;

-- Create successful serialized, quantity, and draft fixtures as a Sales-only operator.
do $$
declare resources sales_delivery_resources%rowtype; created record;
begin
  select * into resources from sales_delivery_resources;
  select * into created from pg_temp.create_delivery_sale(
    'sales-delivery-serial', resources.serial_product_id, 1,
    resources.branch_id, resources.location_id, resources.serial_unit_id, true
  );
  update sales_delivery_resources set
    serial_sale_id = created.sale_id, serial_line_id = created.sale_line_id;
  select * into created from pg_temp.create_delivery_sale(
    'sales-delivery-quantity', resources.quantity_product_id, 5,
    resources.branch_id, resources.location_id, null, true
  );
  update sales_delivery_resources set
    quantity_sale_id = created.sale_id, quantity_line_id = created.sale_line_id;
  select * into created from pg_temp.create_delivery_sale(
    'sales-delivery-draft', resources.quantity_product_id, 1,
    resources.branch_id, resources.location_id, null, false
  );
  update sales_delivery_resources set draft_sale_id = created.sale_id;
end
$$;
reset role;

-- Owner prepares scope/invalid/failure fixtures without broadening operator scope.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from sales_delivery_context;
set local role authenticated;
do $$
declare resources sales_delivery_resources%rowtype; created record;
begin
  select * into resources from sales_delivery_resources;
  select * into created from pg_temp.create_delivery_sale(
    'sales-delivery-invalid', resources.quantity_product_id, 1,
    resources.branch_id, resources.location_id, null, true
  );
  update sales_delivery_resources set invalid_sale_id = created.sale_id;
  select * into created from pg_temp.create_delivery_sale(
    'sales-delivery-wrong-branch', resources.quantity_product_id, 1,
    resources.wrong_branch_id, resources.wrong_branch_location_id, null, true
  );
  update sales_delivery_resources set wrong_branch_sale_id = created.sale_id;
  select * into created from pg_temp.create_delivery_sale(
    'sales-delivery-wrong-location', resources.quantity_product_id, 1,
    resources.branch_id, resources.denied_location_id, null, true
  );
  update sales_delivery_resources set wrong_location_sale_id = created.sale_id;
  select * into created from pg_temp.create_delivery_sale(
    'sales-delivery-inventory-failure', resources.quantity_product_id, 1,
    resources.branch_id, resources.location_id, null, true
  );
  update sales_delivery_resources set inventory_failure_sale_id = created.sale_id;
  select * into created from pg_temp.create_delivery_sale(
    'sales-delivery-link-failure', resources.quantity_product_id, 1,
    resources.branch_id, resources.location_id, null, true
  );
  update sales_delivery_resources set link_failure_sale_id = created.sale_id;
  select * into created from pg_temp.create_delivery_sale(
    'sales-delivery-event-failure', resources.quantity_product_id, 1,
    resources.branch_id, resources.location_id, null, true
  );
  update sales_delivery_resources set event_failure_sale_id = created.sale_id;
end
$$;
reset role;

create temporary table sales_delivery_financial_before as
select
  (select count(*) from public.financial_sale_postings) postings,
  (select count(*) from public.account_moves) moves,
  (select count(*) from public.account_move_lines) move_lines,
  (select count(*) from public.financial_payments) payments,
  (select count(*) from public.financial_payment_allocations) allocations,
  (select count(*) from public.account_partial_reconcile) reconciliations;
grant select on sales_delivery_financial_before to authenticated;

select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_delivery_context;
set local role authenticated;

-- Serialized full delivery, eligibility DTO, replay, duplicate protection and issued state.
do $$
declare
  resources sales_delivery_resources%rowtype;
  eligibility jsonb; result jsonb; replay jsonb;
  mismatch_rejected boolean := false; duplicate_rejected boolean := false;
begin
  select * into resources from sales_delivery_resources;
  eligibility := public.get_sale_delivery_eligibility(resources.serial_sale_id);
  if not (eligibility ->> 'eligible')::boolean
     or eligibility ->> 'fulfillment_status' <> 'reserved'
     or eligibility ? 'reservation_id'
     or eligibility::text ~ 'inventory_delivery_id|stock_move_id|financial_sale_posting_id' then
    raise exception 'SERIAL_DELIVERY_ELIGIBILITY_INVALID:%', eligibility;
  end if;
  result := public.deliver_sale(
    resources.serial_sale_id, 3,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', resources.serial_line_id,
      'tracking_unit_id', resources.serial_unit_id, 'quantity', 1
    )), 'sales-delivery-serial-command'
  );
  replay := public.deliver_sale(
    resources.serial_sale_id, 3,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', resources.serial_line_id,
      'tracking_unit_id', resources.serial_unit_id, 'quantity', 1
    )), 'sales-delivery-serial-command'
  );
  begin
    perform public.deliver_sale(
      resources.serial_sale_id, 3,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', resources.serial_line_id,
        'tracking_unit_id', resources.serial_unit_id, 'quantity', 0.5
      )), 'sales-delivery-serial-command'
    );
  exception when check_violation then mismatch_rejected := true; end;
  begin
    perform public.deliver_sale(
      resources.serial_sale_id, 4,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', resources.serial_line_id,
        'tracking_unit_id', resources.serial_unit_id, 'quantity', 1
      )), 'sales-delivery-serial-duplicate'
    );
  exception when check_violation then duplicate_rejected := true; end;
  if result ->> 'fulfillment_status' <> 'delivered'
     or result ->> 'commercial_status' <> 'confirmed'
     or not (replay ->> 'idempotent_replay')::boolean
     or result ->> 'sale_number' <> replay ->> 'sale_number'
     or not mismatch_rejected or not duplicate_rejected
     or pg_temp.tracking_delivery_state(resources.serial_unit_id) ->> 'canonical_state' <> 'issued'
     or pg_temp.tracking_delivery_state(resources.serial_unit_id) ->> 'unit_status' <> 'sold'
     or pg_temp.delivery_artifact_count(resources.serial_sale_id, 'sales_delivery') <> 1
     or pg_temp.delivery_artifact_count(resources.serial_sale_id, 'delivered_event') <> 1 then
    raise exception 'SERIAL_DELIVERY_OR_IDEMPOTENCY_FAILED';
  end if;
end
$$;

-- Quantity partial then full delivery; status is derived while commercial state remains confirmed.
do $$
declare resources sales_delivery_resources%rowtype; first jsonb; second jsonb; dto jsonb; details jsonb;
begin
  select * into resources from sales_delivery_resources;
  first := public.deliver_sale(
    resources.quantity_sale_id, 3,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', resources.quantity_line_id, 'quantity', 2
    )), 'sales-delivery-quantity-partial'
  );
  dto := public.get_sale_delivery_eligibility(resources.quantity_sale_id);
  details := public.get_sale_details(resources.quantity_sale_id);
  if first ->> 'fulfillment_status' <> 'partially_delivered'
     or dto ->> 'fulfillment_status' <> 'partially_delivered'
     or (dto ->> 'delivered_quantity')::numeric <> 2
     or (dto ->> 'remaining_quantity')::numeric <> 3
     or details ->> 'commercial_status' <> 'confirmed'
     or details -> 'fulfillment' ->> 'status' <> 'partially_delivered'
     or (details -> 'fulfillment' ->> 'delivered_quantity')::numeric <> 2
     or details -> 'lines' -> 0 -> 'inventory' ->> 'status' <> 'partially_delivered'
     or not (dto ->> 'eligible')::boolean then
    raise exception 'PARTIAL_DELIVERY_STATE_INVALID:%', dto;
  end if;
  second := public.deliver_sale(
    resources.quantity_sale_id, 4,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', resources.quantity_line_id, 'quantity', 3
    )), 'sales-delivery-quantity-final'
  );
  dto := public.get_sale_delivery_eligibility(resources.quantity_sale_id);
  details := public.get_sale_details(resources.quantity_sale_id);
  if second ->> 'fulfillment_status' <> 'delivered'
     or dto ->> 'fulfillment_status' <> 'delivered'
     or (dto ->> 'eligible')::boolean
     or not ((dto -> 'blocking_reasons') ? 'SALE_ALREADY_DELIVERED')
     or details -> 'fulfillment' ->> 'status' <> 'delivered'
     or (details -> 'fulfillment' ->> 'remaining_quantity')::numeric <> 0
     or details -> 'lines' -> 0 -> 'inventory' ->> 'status' <> 'delivered'
     or not (details -> 'events' @> jsonb_build_array(jsonb_build_object('type', 'sale_delivered')))
     or (select status from public.sales where id = resources.quantity_sale_id) <> 'confirmed'
     or (select version from public.sales where id = resources.quantity_sale_id) <> 5
     or pg_temp.sale_reservation_state(resources.quantity_sale_id) <> 'delivered'
     or pg_temp.delivery_artifact_count(resources.quantity_sale_id, 'partial_event') <> 1
     or pg_temp.delivery_artifact_count(resources.quantity_sale_id, 'delivered_event') <> 1 then
    raise exception 'FULL_QUANTITY_DELIVERY_STATE_INVALID:%', dto;
  end if;
end
$$;

-- Draft and malformed/missing reservation rejection.
do $$
declare resources sales_delivery_resources%rowtype; draft_rejected boolean := false;
begin
  select * into resources from sales_delivery_resources;
  begin
    perform public.deliver_sale(
      resources.draft_sale_id, 2,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', resources.quantity_line_id, 'quantity', 1
      )), 'sales-delivery-draft-reject'
    );
  exception when check_violation then draft_rejected := true; end;
  if not draft_rejected then raise exception 'DRAFT_DELIVERY_NOT_REJECTED'; end if;
end
$$;
reset role;
update public.inventory_reservations set state = 'released', released_at = now(),
  completed_at = now(), updated_at = now()
where id = (
  select confirmation.inventory_reservation_id
  from public.sale_confirmation_links confirmation
  where confirmation.sale_id = (select invalid_sale_id from sales_delivery_resources)
);
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_delivery_context;
set local role authenticated;
do $$
declare resources sales_delivery_resources%rowtype; rejected boolean := false; dto jsonb;
begin
  select * into resources from sales_delivery_resources;
  dto := public.get_sale_delivery_eligibility(resources.invalid_sale_id);
  begin
    perform public.deliver_sale(
      resources.invalid_sale_id, 3,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', (select id from public.sale_lines where sale_id = resources.invalid_sale_id),
        'quantity', 1
      )), 'sales-delivery-invalid-reservation'
    );
  exception when check_violation then rejected := true; end;
  if (dto ->> 'eligible')::boolean or not rejected
     or not ((dto -> 'blocking_reasons') ? 'SALE_INVENTORY_RESERVATION_INVALID') then
    raise exception 'INVALID_RESERVATION_NOT_REJECTED:%', dto;
  end if;
end
$$;

-- Branch and location scope denial.
do $$
declare resources sales_delivery_resources%rowtype;
  branch_rejected boolean := false; location_rejected boolean := false;
begin
  select * into resources from sales_delivery_resources;
  begin perform public.get_sale_delivery_eligibility(resources.wrong_branch_sale_id);
  exception when insufficient_privilege then branch_rejected := true; end;
  begin perform public.get_sale_delivery_eligibility(resources.wrong_location_sale_id);
  exception when insufficient_privilege then location_rejected := true; end;
  if not branch_rejected or not location_rejected then
    raise exception 'DELIVERY_SCOPE_NOT_REJECTED';
  end if;
end
$$;
reset role;

-- Missing sales.deliver permission denial, then restore it for failure tests.
delete from public.auth_group_permissions
where group_id = (select permission_group_id from sales_delivery_resources)
  and permission_id = (select id from public.auth_permissions where code = 'sales.deliver');
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_delivery_context;
set local role authenticated;
do $$
declare resources sales_delivery_resources%rowtype; rejected boolean := false;
begin
  select * into resources from sales_delivery_resources;
  begin perform public.get_sale_delivery_eligibility(resources.inventory_failure_sale_id);
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'MISSING_SALES_DELIVER_NOT_REJECTED'; end if;
end
$$;
reset role;
insert into public.auth_group_permissions (group_id, permission_id)
select (select permission_group_id from sales_delivery_resources), permission.id
from public.auth_permissions permission where permission.code = 'sales.deliver';

-- Wrong tenant is not allowed to discover or deliver the Sale.
select set_config('request.jwt.claim.sub', foreign_auth::text, true)
from sales_delivery_context;
set local role authenticated;
do $$
declare resources sales_delivery_resources%rowtype; rejected boolean := false;
begin
  select * into resources from sales_delivery_resources;
  begin perform public.get_sale_delivery_eligibility(resources.inventory_failure_sale_id);
  exception when insufficient_privilege or check_violation then rejected := true; end;
  if not rejected then raise exception 'WRONG_TENANT_DELIVERY_NOT_REJECTED'; end if;
end
$$;
reset role;

-- Failure A: after eligibility, Inventory Delivery insert fails; all command effects roll back.
create function pg_temp.fail_sales_delivery_inventory()
returns trigger language plpgsql as $$
begin
  if new.source_id = (select inventory_failure_sale_id::text from sales_delivery_resources) then
    raise exception using errcode = '23514', message = 'INJECTED_INVENTORY_DELIVERY_FAILURE';
  end if;
  return new;
end $$;
create trigger zz_sales_delivery_inventory_failure
before insert on public.inventory_deliveries
for each row execute function pg_temp.fail_sales_delivery_inventory();
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_delivery_context;
set local role authenticated;
do $$
declare resources sales_delivery_resources%rowtype; rejected boolean := false;
  line_id uuid; v_reservation_id uuid; before_on_hand numeric;
begin
  select * into resources from sales_delivery_resources;
  select id into line_id from public.sale_lines where sale_id = resources.inventory_failure_sale_id;
  v_reservation_id := pg_temp.sale_reservation_id(resources.inventory_failure_sale_id);
  before_on_hand := pg_temp.quantity_on_hand(
    resources.quantity_product_id, resources.location_id
  );
  begin
    perform public.deliver_sale(
      resources.inventory_failure_sale_id, 3,
      jsonb_build_array(jsonb_build_object('sale_line_id', line_id, 'quantity', 1)),
      'sales-delivery-inventory-failure-command'
    );
  exception when check_violation then rejected := true; end;
  if not rejected
     or (select version from public.sales where id = resources.inventory_failure_sale_id) <> 3
     or pg_temp.delivery_artifact_count(resources.inventory_failure_sale_id, 'inventory_delivery') <> 0
     or pg_temp.delivery_artifact_count(resources.inventory_failure_sale_id, 'sales_delivery') <> 0
     or pg_temp.sales_delivery_command_exists('sales-delivery-inventory-failure-command')
     or pg_temp.quantity_on_hand(
       resources.quantity_product_id, resources.location_id
     ) <> before_on_hand then
    raise exception 'INVENTORY_FAILURE_ROLLBACK_FAILED';
  end if;
end
$$;
reset role;
drop trigger zz_sales_delivery_inventory_failure on public.inventory_deliveries;

-- Failure B: Inventory succeeds internally, Sales link insert fails; Inventory state rolls back.
create function pg_temp.fail_sales_delivery_link()
returns trigger language plpgsql as $$
begin
  if new.sale_id = (select link_failure_sale_id from sales_delivery_resources) then
    raise exception using errcode = '23514', message = 'INJECTED_SALES_DELIVERY_LINK_FAILURE';
  end if;
  return new;
end $$;
create trigger zz_sales_delivery_link_failure
before insert on public.sale_deliveries
for each row execute function pg_temp.fail_sales_delivery_link();
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_delivery_context;
set local role authenticated;
do $$
declare resources sales_delivery_resources%rowtype; rejected boolean := false;
  line_id uuid; v_reservation_id uuid; before_on_hand numeric;
begin
  select * into resources from sales_delivery_resources;
  select id into line_id from public.sale_lines where sale_id = resources.link_failure_sale_id;
  v_reservation_id := pg_temp.sale_reservation_id(resources.link_failure_sale_id);
  before_on_hand := pg_temp.quantity_on_hand(
    resources.quantity_product_id, resources.location_id
  );
  begin
    perform public.deliver_sale(
      resources.link_failure_sale_id, 3,
      jsonb_build_array(jsonb_build_object('sale_line_id', line_id, 'quantity', 1)),
      'sales-delivery-link-failure-command'
    );
  exception when check_violation then rejected := true; end;
  if not rejected
     or pg_temp.sale_reservation_state(resources.link_failure_sale_id) <> 'active'
     or pg_temp.delivery_artifact_count(resources.link_failure_sale_id, 'inventory_delivery') <> 0
     or pg_temp.delivery_artifact_count(resources.link_failure_sale_id, 'sales_delivery') <> 0
     or pg_temp.quantity_on_hand(
       resources.quantity_product_id, resources.location_id
     ) <> before_on_hand then
    raise exception 'LINK_FAILURE_ROLLBACK_FAILED';
  end if;
end
$$;
reset role;
drop trigger zz_sales_delivery_link_failure on public.sale_deliveries;

-- Failure C: Inventory and link succeed internally, Sales event fails; everything rolls back.
create function pg_temp.fail_sales_delivery_event()
returns trigger language plpgsql as $$
begin
  if new.sale_id = (select event_failure_sale_id from sales_delivery_resources)
     and new.event_type in ('sale_delivered', 'sale_partially_delivered') then
    raise exception using errcode = '23514', message = 'INJECTED_SALES_DELIVERY_EVENT_FAILURE';
  end if;
  return new;
end $$;
create trigger zz_sales_delivery_event_failure
before insert on public.sale_events
for each row execute function pg_temp.fail_sales_delivery_event();
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_delivery_context;
set local role authenticated;
do $$
declare resources sales_delivery_resources%rowtype; rejected boolean := false;
  line_id uuid; v_reservation_id uuid; before_on_hand numeric;
begin
  select * into resources from sales_delivery_resources;
  select id into line_id from public.sale_lines where sale_id = resources.event_failure_sale_id;
  v_reservation_id := pg_temp.sale_reservation_id(resources.event_failure_sale_id);
  before_on_hand := pg_temp.quantity_on_hand(
    resources.quantity_product_id, resources.location_id
  );
  begin
    perform public.deliver_sale(
      resources.event_failure_sale_id, 3,
      jsonb_build_array(jsonb_build_object('sale_line_id', line_id, 'quantity', 1)),
      'sales-delivery-event-failure-command'
    );
  exception when check_violation then rejected := true; end;
  if not rejected
     or (select version from public.sales where id = resources.event_failure_sale_id) <> 3
     or pg_temp.sale_reservation_state(resources.event_failure_sale_id) <> 'active'
     or pg_temp.delivery_artifact_count(resources.event_failure_sale_id, 'inventory_delivery') <> 0
     or pg_temp.delivery_artifact_count(resources.event_failure_sale_id, 'sales_delivery') <> 0
     or pg_temp.delivery_artifact_count(resources.event_failure_sale_id, 'delivered_event') <> 0
     or pg_temp.delivery_artifact_count(resources.event_failure_sale_id, 'partial_event') <> 0
     or pg_temp.quantity_on_hand(
       resources.quantity_product_id, resources.location_id
     ) <> before_on_hand then
    raise exception 'EVENT_FAILURE_ROLLBACK_FAILED';
  end if;
end
$$;
reset role;
drop trigger zz_sales_delivery_event_failure on public.sale_events;

-- Direct DML is unavailable and the private capability cannot be reused after completion.
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_delivery_context;
set local role authenticated;
do $$
declare resources sales_delivery_resources%rowtype;
  header_rejected boolean := false; line_rejected boolean := false; core_rejected boolean := false;
  reservation_id uuid; command_id uuid;
begin
  select * into resources from sales_delivery_resources;
  begin execute 'insert into public.sale_deliveries (tenant_id) values (gen_random_uuid())';
  exception when insufficient_privilege then header_rejected := true; end;
  begin execute 'insert into public.sale_delivery_lines (tenant_id) values (gen_random_uuid())';
  exception when insufficient_privilege then line_rejected := true; end;
  reservation_id := pg_temp.sale_reservation_id(resources.serial_sale_id);
  command_id := pg_temp.sales_delivery_command_id('sales-delivery-serial-command');
  perform set_config('app.canonical_sales_delivery_command', command_id::text, true);
  begin
    perform public.commit_inventory_delivery(
      reservation_id, jsonb_build_array(jsonb_build_object(
        'reservation_line_id', gen_random_uuid(), 'quantity', 1
      )), 'forged-sales-delivery-core-call'
    );
  exception when insufficient_privilege then core_rejected := true; end;
  perform set_config('app.canonical_sales_delivery_command', '', true);
  if not header_rejected or not line_rejected or not core_rejected then
    raise exception 'SALES_DELIVERY_DIRECT_BOUNDARY_FAILED';
  end if;
end
$$;
reset role;

-- Delivery never creates or mutates Financial effects and all typed links are consistent.
do $$
declare before_row sales_delivery_financial_before%rowtype;
begin
  select * into before_row from sales_delivery_financial_before;
  if (select count(*) from public.financial_sale_postings) <> before_row.postings
     or (select count(*) from public.account_moves) <> before_row.moves
     or (select count(*) from public.account_move_lines) <> before_row.move_lines
     or (select count(*) from public.financial_payments) <> before_row.payments
     or (select count(*) from public.financial_payment_allocations) <> before_row.allocations
     or (select count(*) from public.account_partial_reconcile) <> before_row.reconciliations then
    raise exception 'SALES_DELIVERY_FINANCIAL_BOUNDARY_FAILED';
  end if;
  if exists (
    select 1
    from public.sale_delivery_lines sales_line
    join public.sale_deliveries sales_delivery
      on sales_delivery.id = sales_line.sale_delivery_id
     and sales_delivery.tenant_id = sales_line.tenant_id
     and sales_delivery.sale_id = sales_line.sale_id
    join public.inventory_delivery_lines inventory_line
      on inventory_line.id = sales_line.inventory_delivery_line_id
     and inventory_line.tenant_id = sales_line.tenant_id
    join public.inventory_deliveries inventory_delivery
      on inventory_delivery.id = sales_delivery.inventory_delivery_id
     and inventory_delivery.tenant_id = sales_delivery.tenant_id
    where inventory_line.delivery_id <> inventory_delivery.id
       or inventory_delivery.reservation_id <> sales_delivery.inventory_reservation_id
       or inventory_delivery.source_type <> 'sale'
       or inventory_delivery.source_id <> sales_delivery.sale_id::text
       or inventory_line.tracking_unit_id is distinct from sales_line.tracking_unit_id
  ) then
    raise exception 'SALES_DELIVERY_INTEGRATION_LINK_INCONSISTENT';
  end if;
end
$$;

select jsonb_build_object(
  'eligibility_and_safe_dto', 'passed',
  'serialized_full_delivery', 'passed',
  'quantity_partial_and_full_delivery', 'passed',
  'commercial_state_unchanged', 'passed',
  'idempotency_and_duplicate_rejection', 'passed',
  'tenant_branch_location_authorization', 'passed',
  'missing_permission_rejection', 'passed',
  'invalid_reservation_rejection', 'passed',
  'inventory_failure_rollback', 'passed',
  'link_failure_rollback', 'passed',
  'event_failure_rollback', 'passed',
  'direct_dml_and_capability_boundary', 'passed',
  'financial_boundary', 'passed',
  'integration_consistency', 'passed'
) canonical_sales_delivery_runtime;

rollback;
