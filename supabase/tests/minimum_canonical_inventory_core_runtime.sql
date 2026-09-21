-- Minimum Canonical Inventory Core A-R runtime proof. Every fixture rolls back.
begin;

create temporary table inventory_core_before as
select
  (select count(*) from public.inventory_reservations) reservations,
  (select count(*) from public.inventory_reservation_lines) reservation_lines,
  (select count(*) from public.inventory_deliveries) deliveries,
  (select count(*) from public.inventory_delivery_lines) delivery_lines,
  (select count(*) from public.inventory_returns) returns,
  (select count(*) from public.inventory_return_lines) return_lines,
  (select count(*) from public.inventory_events) events,
  (select count(*) from public.inventory_command_requests) commands,
  (select count(*) from public.stock_moves) stock_moves;

create temporary table inventory_core_context as
select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth,
  unassigned.id operator_auth, foreign_member.auth_user_id foreign_auth
from public.tenant_users owner
join lateral (
  select auth_user.id
  from auth.users auth_user
  where not exists (
    select 1 from public.tenant_users member
    where member.auth_user_id = auth_user.id
  )
  order by auth_user.created_at, auth_user.id
  limit 1
) unassigned on true
join lateral (
  select member.auth_user_id
  from public.tenant_users member
  where member.tenant_id <> owner.tenant_id
    and member.is_active and member.auth_user_id is not null
    and not exists (
      select 1 from public.tenant_users target_member
      where target_member.tenant_id = owner.tenant_id
        and target_member.auth_user_id = member.auth_user_id
        and target_member.is_active
    )
  order by member.tenant_id, member.id
  limit 1
) foreign_member on true
where owner.role = 'owner' and owner.is_active and owner.auth_user_id is not null
order by owner.tenant_id
limit 1;

do $$
begin
  if not exists (select 1 from inventory_core_context) then
    raise exception 'INVENTORY_CORE_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end
$$;

create temporary table inventory_core_resources (
  branch_id uuid, wrong_branch_id uuid,
  location_id uuid, denied_location_id uuid, wrong_branch_location_id uuid,
  operator_id uuid,
  serial_template_id uuid, serial_product_id uuid,
  quantity_template_id uuid, quantity_product_id uuid,
  quantity_template_2_id uuid, quantity_product_2_id uuid,
  quantity_template_3_id uuid, quantity_product_3_id uuid,
  nonsell_template_id uuid, nonsell_product_id uuid,
  serial_unit_id uuid, incomplete_unit_id uuid, nonsell_unit_id uuid,
  main_reservation_id uuid, main_serial_line_id uuid, main_quantity_line_id uuid,
  main_delivery_id uuid, main_serial_delivery_line_id uuid,
  main_quantity_delivery_line_id uuid,
  release_reservation_id uuid, failure_reservation_id uuid
);
grant select on inventory_core_context to authenticated;
grant select, update on inventory_core_resources to authenticated;

do $$
declare
  context inventory_core_context%rowtype;
  resources inventory_core_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
begin
  select * into context from inventory_core_context;
  resources.branch_id := gen_random_uuid();
  resources.wrong_branch_id := gen_random_uuid();
  resources.location_id := gen_random_uuid();
  resources.denied_location_id := gen_random_uuid();
  resources.wrong_branch_location_id := gen_random_uuid();
  resources.operator_id := gen_random_uuid();
  resources.serial_template_id := gen_random_uuid();
  resources.serial_product_id := gen_random_uuid();
  resources.quantity_template_id := gen_random_uuid();
  resources.quantity_product_id := gen_random_uuid();
  resources.quantity_template_2_id := gen_random_uuid();
  resources.quantity_product_2_id := gen_random_uuid();
  resources.quantity_template_3_id := gen_random_uuid();
  resources.quantity_product_3_id := gen_random_uuid();
  resources.nonsell_template_id := gen_random_uuid();
  resources.nonsell_product_id := gen_random_uuid();
  resources.serial_unit_id := gen_random_uuid();
  resources.incomplete_unit_id := gen_random_uuid();
  resources.nonsell_unit_id := gen_random_uuid();

  insert into public.branches (id, tenant_id, name, code, is_active) values
    (resources.branch_id, context.tenant_id, 'Inventory Core Branch', 'IC' || left(suffix, 5), true),
    (resources.wrong_branch_id, context.tenant_id, 'Inventory Core Denied Branch', 'ID' || left(suffix, 5), true);
  insert into public.stock_locations (id, tenant_id, branch_id, code, name, location_type, is_active) values
    (resources.location_id, context.tenant_id, resources.branch_id, 'ICL' || left(suffix, 5), 'Inventory Core Location', 'internal', true),
    (resources.denied_location_id, context.tenant_id, resources.branch_id, 'ICD' || left(suffix, 5), 'Inventory Core Denied Location', 'internal', true),
    (resources.wrong_branch_location_id, context.tenant_id, resources.wrong_branch_id, 'ICW' || left(suffix, 5), 'Inventory Core Wrong Branch Location', 'internal', true);

  insert into public.tenant_users (id, tenant_id, auth_user_id, full_name, role, is_active)
  values (resources.operator_id, context.tenant_id, context.operator_auth, 'Inventory Core Operator', 'staff', true);
  insert into public.res_groups (tenant_id, name, code, category, is_system, active)
  values (context.tenant_id, 'Inventory Core Runtime', 'inventory_core_runtime_' || suffix, 'inventory', false, true);
  insert into public.auth_group_permissions (group_id, permission_id)
  select permission_group.id, permission.id
  from public.res_groups permission_group
  cross join public.auth_permissions permission
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code = 'inventory_core_runtime_' || suffix
    and permission.code in (
      'inventory.availability', 'inventory.reserve', 'inventory.release',
      'inventory.deliver', 'inventory.return'
    );
  insert into public.res_users_groups (tenant_id, user_id, group_id)
  select context.tenant_id, resources.operator_id, permission_group.id
  from public.res_groups permission_group
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code = 'inventory_core_runtime_' || suffix;
  insert into public.user_branch_access (tenant_id, user_id, branch_id)
  values (context.tenant_id, resources.operator_id, resources.branch_id);
  insert into public.user_stock_location_access (tenant_id, user_id, stock_location_id, branch_id)
  values (context.tenant_id, resources.operator_id, resources.location_id, resources.branch_id);

  insert into public.product_templates (
    id, tenant_id, name, internal_reference, product_type, tracking,
    can_be_sold, is_active, sale_price
  ) values
    (resources.serial_template_id, context.tenant_id, 'Inventory Serial', 'ICS-' || suffix, 'goods', 'serial', true, true, 100),
    (resources.quantity_template_id, context.tenant_id, 'Inventory Quantity', 'ICQ-' || suffix, 'goods', 'none', true, true, 10),
    (resources.quantity_template_2_id, context.tenant_id, 'Inventory Quantity 2', 'IC2-' || suffix, 'goods', 'none', true, true, 10),
    (resources.quantity_template_3_id, context.tenant_id, 'Inventory Quantity 3', 'IC3-' || suffix, 'goods', 'none', true, true, 10),
    (resources.nonsell_template_id, context.tenant_id, 'Inventory Non Sellable', 'ICN-' || suffix, 'goods', 'serial', false, true, 100);
  insert into public.product_products (
    id, tenant_id, product_template_id, display_name, sku, tracking,
    is_active, sale_price
  ) values
    (resources.serial_product_id, context.tenant_id, resources.serial_template_id, 'Inventory Serial', 'ICS-' || suffix, 'serial', true, 100),
    (resources.quantity_product_id, context.tenant_id, resources.quantity_template_id, 'Inventory Quantity', 'ICQ-' || suffix, 'none', true, 10),
    (resources.quantity_product_2_id, context.tenant_id, resources.quantity_template_2_id, 'Inventory Quantity 2', 'IC2-' || suffix, 'none', true, 10),
    (resources.quantity_product_3_id, context.tenant_id, resources.quantity_template_3_id, 'Inventory Quantity 3', 'IC3-' || suffix, 'none', true, 10),
    (resources.nonsell_product_id, context.tenant_id, resources.nonsell_template_id, 'Inventory Non Sellable', 'ICN-' || suffix, 'serial', true, 100);
  update public.product_templates template set default_product_product_id = product.id
  from public.product_products product
  where template.id in (
    resources.serial_template_id, resources.quantity_template_id,
    resources.quantity_template_2_id, resources.quantity_template_3_id,
    resources.nonsell_template_id
  ) and product.product_template_id = template.id;

  insert into public.stock_tracking_units (
    id, tenant_id, product_product_id, product_template_id,
    tracking_type, tracking_number, status, data_status,
    incomplete_reason, current_location_id
  ) values
    (resources.serial_unit_id, context.tenant_id, resources.serial_product_id,
      resources.serial_template_id, 'serial', 'ICSU-' || suffix, 'in_stock',
      'complete', null, resources.location_id),
    (resources.incomplete_unit_id, context.tenant_id, resources.serial_product_id,
      resources.serial_template_id, 'serial', 'ICIU-' || suffix, 'in_stock',
      'incomplete', 'missing_identifiers', resources.location_id),
    (resources.nonsell_unit_id, context.tenant_id, resources.nonsell_product_id,
      resources.nonsell_template_id, 'serial', 'ICNU-' || suffix, 'in_stock',
      'complete', null, resources.location_id);
  insert into public.stock_quants (
    tenant_id, product_product_id, product_template_id, location_id,
    quantity_on_hand, reserved_quantity
  ) values
    (context.tenant_id, resources.quantity_product_id, resources.quantity_template_id, resources.location_id, 5, 0),
    (context.tenant_id, resources.quantity_product_2_id, resources.quantity_template_2_id, resources.location_id, 1, 0),
    (context.tenant_id, resources.quantity_product_3_id, resources.quantity_template_3_id, resources.location_id, 1, 0);

  insert into inventory_core_resources values (resources.*);
end
$$;

-- A. Availability uses complete/sellable serial units and quantity on-hand.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from inventory_core_context;
set local role authenticated;
do $$
declare
  resources inventory_core_resources%rowtype;
  availability jsonb;
begin
  select * into resources from inventory_core_resources;
  availability := public.get_inventory_availability(
    resources.branch_id, resources.serial_product_id, 1,
    resources.location_id, resources.serial_unit_id
  );
  if not (availability ->> 'is_available')::boolean
     or (availability ->> 'available_quantity')::numeric <> 1 then
    raise exception 'A_SERIAL_AVAILABILITY_FAILED: %', availability;
  end if;
  availability := public.get_inventory_availability(
    resources.branch_id, resources.quantity_product_id, 5,
    resources.location_id, null
  );
  if not (availability ->> 'is_available')::boolean
     or (availability ->> 'available_quantity')::numeric <> 5 then
    raise exception 'A_QUANTITY_AVAILABILITY_FAILED: %', availability;
  end if;
end
$$;

-- B/D. Reserve one serial and two quantity units atomically.
do $$
declare
  resources inventory_core_resources%rowtype;
  result jsonb;
begin
  select * into resources from inventory_core_resources;
  result := public.reserve_inventory(
    resources.branch_id, resources.location_id, 'runtime_sale', 'main',
    jsonb_build_array(
      jsonb_build_object('product_id', resources.serial_product_id, 'quantity', 1, 'tracking_unit_id', resources.serial_unit_id),
      jsonb_build_object('product_id', resources.quantity_product_id, 'quantity', 2)
    ), 'inventory-runtime-main-reserve'
  );
  resources.main_reservation_id := (result ->> 'reservation_id')::uuid;
  select line.id into resources.main_serial_line_id
  from public.inventory_reservation_lines line
  where line.reservation_id = resources.main_reservation_id
    and line.tracking_unit_id = resources.serial_unit_id;
  select line.id into resources.main_quantity_line_id
  from public.inventory_reservation_lines line
  where line.reservation_id = resources.main_reservation_id
    and line.product_id = resources.quantity_product_id
    and line.tracking_unit_id is null;
  update inventory_core_resources set
    main_reservation_id = resources.main_reservation_id,
    main_serial_line_id = resources.main_serial_line_id,
    main_quantity_line_id = resources.main_quantity_line_id;
end
$$;

-- P. Same reserve request is a replay, not another reservation/event.
do $$
declare
  resources inventory_core_resources%rowtype;
  result jsonb;
  before_events bigint;
begin
  select * into resources from inventory_core_resources;
  select count(*) into before_events from public.inventory_events
  where reservation_id = resources.main_reservation_id;
  result := public.reserve_inventory(
    resources.branch_id, resources.location_id, 'runtime_sale', 'main',
    jsonb_build_array(
      jsonb_build_object('product_id', resources.serial_product_id, 'quantity', 1, 'tracking_unit_id', resources.serial_unit_id),
      jsonb_build_object('product_id', resources.quantity_product_id, 'quantity', 2)
    ), 'inventory-runtime-main-reserve'
  );
  if (result ->> 'reservation_id')::uuid <> resources.main_reservation_id
     or (select count(*) from public.inventory_reservations where source_type = 'runtime_sale' and source_id = 'main') <> 1
     or (select count(*) from public.inventory_events where reservation_id = resources.main_reservation_id) <> before_events then
    raise exception 'P_RESERVATION_IDEMPOTENCY_FAILED';
  end if;
end
$$;

-- C. The same tracking unit cannot be reserved again.
do $$
declare resources inventory_core_resources%rowtype; rejected boolean := false;
begin
  select * into resources from inventory_core_resources;
  begin
    perform public.reserve_inventory(
      resources.branch_id, resources.location_id, 'runtime_sale', 'duplicate-serial',
      jsonb_build_array(jsonb_build_object('product_id', resources.serial_product_id, 'quantity', 1, 'tracking_unit_id', resources.serial_unit_id)),
      'inventory-runtime-duplicate-serial'
    );
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'C_DOUBLE_SERIAL_RESERVATION_NOT_REJECTED'; end if;
end
$$;

-- E/R. Active reserve is deducted; over-reserve fails and stock stays non-negative.
do $$
declare resources inventory_core_resources%rowtype; availability jsonb; rejected boolean := false;
begin
  select * into resources from inventory_core_resources;
  availability := public.get_inventory_availability(
    resources.branch_id, resources.quantity_product_id, 3,
    resources.location_id, null
  );
  if (availability ->> 'available_quantity')::numeric <> 3 then
    raise exception 'D_ACTIVE_RESERVATION_NOT_DEDUCTED: %', availability;
  end if;
  begin
    perform public.reserve_inventory(
      resources.branch_id, resources.location_id, 'runtime_sale', 'over-reserve',
      jsonb_build_array(jsonb_build_object('product_id', resources.quantity_product_id, 'quantity', 4)),
      'inventory-runtime-over-reserve'
    );
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'E_OVER_RESERVATION_NOT_REJECTED'; end if;
  if exists (
    select 1 from public.stock_quants quant
    where quant.product_product_id in (
      resources.quantity_product_id, resources.quantity_product_2_id,
      resources.quantity_product_3_id
    ) and quant.quantity_on_hand < 0
  ) then raise exception 'R_NEGATIVE_STOCK_CREATED'; end if;
end
$$;

-- G. Partial delivery is a distinct physical event and changes on-hand only then.
do $$
declare resources inventory_core_resources%rowtype; result jsonb;
begin
  select * into resources from inventory_core_resources;
  result := public.commit_inventory_delivery(
    resources.main_reservation_id,
    jsonb_build_array(
      jsonb_build_object('reservation_line_id', resources.main_serial_line_id, 'quantity', 1),
      jsonb_build_object('reservation_line_id', resources.main_quantity_line_id, 'quantity', 1)
    ), 'inventory-runtime-main-delivery'
  );
  resources.main_delivery_id := (result ->> 'delivery_id')::uuid;
  select line.id into resources.main_serial_delivery_line_id
  from public.inventory_delivery_lines line
  where line.delivery_id = resources.main_delivery_id
    and line.tracking_unit_id = resources.serial_unit_id;
  select line.id into resources.main_quantity_delivery_line_id
  from public.inventory_delivery_lines line
  where line.delivery_id = resources.main_delivery_id
    and line.product_id = resources.quantity_product_id
    and line.tracking_unit_id is null;
  update inventory_core_resources set
    main_delivery_id = resources.main_delivery_id,
    main_serial_delivery_line_id = resources.main_serial_delivery_line_id,
    main_quantity_delivery_line_id = resources.main_quantity_delivery_line_id;
  if (select quantity_on_hand from public.stock_quants
      where product_product_id = resources.quantity_product_id and location_id = resources.location_id) <> 4
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.serial_unit_id) <> 'issued'
     or (select state from public.inventory_reservations
         where id = resources.main_reservation_id) <> 'partially_delivered' then
    raise exception 'G_PARTIAL_DELIVERY_STATE_FAILED';
  end if;
end
$$;

-- P. Delivery replay creates no move, delivery line or event duplicate.
do $$
declare resources inventory_core_resources%rowtype; result jsonb; move_count bigint; event_count bigint;
begin
  select * into resources from inventory_core_resources;
  select count(*) into move_count from public.stock_moves
  where reference_type = 'canonical_inventory_delivery'
    and reference_id = resources.main_delivery_id;
  select count(*) into event_count from public.inventory_events
  where delivery_id = resources.main_delivery_id;
  result := public.commit_inventory_delivery(
    resources.main_reservation_id,
    jsonb_build_array(
      jsonb_build_object('reservation_line_id', resources.main_serial_line_id, 'quantity', 1),
      jsonb_build_object('reservation_line_id', resources.main_quantity_line_id, 'quantity', 1)
    ), 'inventory-runtime-main-delivery'
  );
  if (result ->> 'delivery_id')::uuid <> resources.main_delivery_id
     or (select count(*) from public.stock_moves where reference_type = 'canonical_inventory_delivery' and reference_id = resources.main_delivery_id) <> move_count
     or (select count(*) from public.inventory_events where delivery_id = resources.main_delivery_id) <> event_count then
    raise exception 'P_DELIVERY_IDEMPOTENCY_FAILED';
  end if;
end
$$;

-- H/I. Delivery requires a reservation and cannot exceed its remainder.
do $$
declare resources inventory_core_resources%rowtype; rejected_missing boolean := false; rejected_over boolean := false;
begin
  select * into resources from inventory_core_resources;
  begin
    perform public.commit_inventory_delivery(
      gen_random_uuid(), jsonb_build_array(jsonb_build_object('reservation_line_id', gen_random_uuid(), 'quantity', 1)),
      'inventory-runtime-missing-reservation'
    );
  exception when check_violation then rejected_missing := true; end;
  begin
    perform public.commit_inventory_delivery(
      resources.main_reservation_id,
      jsonb_build_array(jsonb_build_object('reservation_line_id', resources.main_quantity_line_id, 'quantity', 2)),
      'inventory-runtime-over-delivery'
    );
  exception when check_violation then rejected_over := true; end;
  if not rejected_missing then raise exception 'H_DELIVERY_WITHOUT_RESERVATION_NOT_REJECTED'; end if;
  if not rejected_over then raise exception 'I_OVER_DELIVERY_NOT_REJECTED'; end if;
end
$$;

-- J. Return both issued serial and quantity to a valid destination.
do $$
declare resources inventory_core_resources%rowtype; result jsonb; v_return_id uuid;
begin
  select * into resources from inventory_core_resources;
  result := public.receive_inventory_return(
    resources.main_delivery_id, resources.location_id,
    'runtime_return', 'main-return',
    jsonb_build_array(
      jsonb_build_object('delivery_line_id', resources.main_serial_delivery_line_id, 'quantity', 1),
      jsonb_build_object('delivery_line_id', resources.main_quantity_delivery_line_id, 'quantity', 1)
    ), 'inventory-runtime-main-return'
  );
  v_return_id := (result ->> 'return_id')::uuid;
  if (select quantity_on_hand from public.stock_quants
      where product_product_id = resources.quantity_product_id and location_id = resources.location_id) <> 5
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.serial_unit_id) <> 'available'
     or (select count(*) from public.inventory_return_lines return_line where return_line.return_id = v_return_id) <> 2 then
    raise exception 'J_RETURN_FAILED';
  end if;
  -- Retry is the same return and produces no extra movement.
  if (public.receive_inventory_return(
    resources.main_delivery_id, resources.location_id,
    'runtime_return', 'main-return',
    jsonb_build_array(
      jsonb_build_object('delivery_line_id', resources.main_serial_delivery_line_id, 'quantity', 1),
      jsonb_build_object('delivery_line_id', resources.main_quantity_delivery_line_id, 'quantity', 1)
    ), 'inventory-runtime-main-return'
  ) ->> 'return_id')::uuid <> v_return_id then
    raise exception 'P_RETURN_IDEMPOTENCY_FAILED';
  end if;
end
$$;

-- K. Nothing from that delivery may be returned twice.
do $$
declare resources inventory_core_resources%rowtype; rejected boolean := false;
begin
  select * into resources from inventory_core_resources;
  begin
    perform public.receive_inventory_return(
      resources.main_delivery_id, resources.location_id,
      'runtime_return', 'over-return',
      jsonb_build_array(jsonb_build_object('delivery_line_id', resources.main_quantity_delivery_line_id, 'quantity', 1)),
      'inventory-runtime-over-return'
    );
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'K_OVER_RETURN_NOT_REJECTED'; end if;
end
$$;

-- F. Releasing only the undelivered remainder restores availability.
do $$
declare resources inventory_core_resources%rowtype; result jsonb; availability jsonb;
begin
  select * into resources from inventory_core_resources;
  result := public.release_inventory_reservation(
    resources.main_reservation_id, 'inventory-runtime-main-release'
  );
  if result ->> 'state' <> 'closed' then raise exception 'F_RELEASE_STATE_FAILED: %', result; end if;
  availability := public.get_inventory_availability(
    resources.branch_id, resources.quantity_product_id, 5,
    resources.location_id, null
  );
  if (availability ->> 'available_quantity')::numeric <> 5 then
    raise exception 'F_RELEASE_AVAILABILITY_FAILED: %', availability;
  end if;
  if public.release_inventory_reservation(
    resources.main_reservation_id, 'inventory-runtime-main-release'
  ) ->> 'state' <> 'closed' then raise exception 'P_RELEASE_IDEMPOTENCY_FAILED'; end if;
end
$$;

-- O. Incomplete and non-sellable tracking units fail server-side.
do $$
declare resources inventory_core_resources%rowtype; incomplete_rejected boolean := false; nonsell_rejected boolean := false;
begin
  select * into resources from inventory_core_resources;
  begin
    perform public.reserve_inventory(
      resources.branch_id, resources.location_id, 'runtime_sale', 'incomplete',
      jsonb_build_array(jsonb_build_object('product_id', resources.serial_product_id, 'quantity', 1, 'tracking_unit_id', resources.incomplete_unit_id)),
      'inventory-runtime-incomplete'
    );
  exception when check_violation then incomplete_rejected := true; end;
  begin
    perform public.reserve_inventory(
      resources.branch_id, resources.location_id, 'runtime_sale', 'nonsell',
      jsonb_build_array(jsonb_build_object('product_id', resources.nonsell_product_id, 'quantity', 1, 'tracking_unit_id', resources.nonsell_unit_id)),
      'inventory-runtime-nonsell'
    );
  exception when check_violation then nonsell_rejected := true; end;
  if not incomplete_rejected then raise exception 'O_INCOMPLETE_UNIT_NOT_REJECTED'; end if;
  if not nonsell_rejected then raise exception 'O_NONSELLABLE_UNIT_NOT_REJECTED'; end if;
end
$$;
reset role;

-- L. A member of another tenant cannot address the reservation by UUID.
select set_config('request.jwt.claim.sub', foreign_auth::text, true)
from inventory_core_context;
set local role authenticated;
do $$
declare resources inventory_core_resources%rowtype; rejected boolean := false;
begin
  select * into resources from inventory_core_resources;
  begin
    perform public.release_inventory_reservation(
      resources.main_reservation_id, 'inventory-runtime-wrong-tenant'
    );
  exception when insufficient_privilege or check_violation then rejected := true; end;
  if not rejected then raise exception 'L_WRONG_TENANT_NOT_REJECTED'; end if;
end
$$;
reset role;

-- M/N. A scoped operator has the allowed branch/location only.
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from inventory_core_context;
set local role authenticated;
do $$
declare resources inventory_core_resources%rowtype; branch_rejected boolean := false; location_rejected boolean := false; availability jsonb;
begin
  select * into resources from inventory_core_resources;
  availability := public.get_inventory_availability(
    resources.branch_id, resources.quantity_product_id, 1,
    resources.location_id, null
  );
  if not (availability ->> 'is_available')::boolean then
    raise exception 'SCOPED_OPERATOR_ALLOWED_LOCATION_FAILED';
  end if;
  begin
    perform public.get_inventory_availability(
      resources.wrong_branch_id, resources.quantity_product_id, 1,
      resources.wrong_branch_location_id, null
    );
  exception when insufficient_privilege then branch_rejected := true; end;
  begin
    perform public.get_inventory_availability(
      resources.branch_id, resources.quantity_product_id, 1,
      resources.denied_location_id, null
    );
  exception when insufficient_privilege then location_rejected := true; end;
  if not branch_rejected then raise exception 'M_WRONG_BRANCH_NOT_REJECTED'; end if;
  if not location_rejected then raise exception 'N_WRONG_LOCATION_NOT_REJECTED'; end if;
end
$$;
reset role;

-- Q. A failure on line two rolls back line-one quant/move/delivery changes.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from inventory_core_context;
set local role authenticated;
do $$
declare
  resources inventory_core_resources%rowtype;
  result jsonb;
  first_line uuid;
  second_line uuid;
  rejected boolean := false;
  before_first numeric;
  before_second numeric;
begin
  select * into resources from inventory_core_resources;
  result := public.reserve_inventory(
    resources.branch_id, resources.location_id, 'runtime_sale', 'atomic-failure',
    jsonb_build_array(
      jsonb_build_object('product_id', resources.quantity_product_2_id, 'quantity', 1),
      jsonb_build_object('product_id', resources.quantity_product_3_id, 'quantity', 1)
    ), 'inventory-runtime-atomic-reserve'
  );
  resources.failure_reservation_id := (result ->> 'reservation_id')::uuid;
  select line.id into first_line
  from public.inventory_reservation_lines line
  where line.reservation_id = resources.failure_reservation_id
  order by line.id limit 1;
  select line.id into second_line
  from public.inventory_reservation_lines line
  where line.reservation_id = resources.failure_reservation_id
  order by line.id desc limit 1;
  update inventory_core_resources set failure_reservation_id = resources.failure_reservation_id;
  select quantity_on_hand into before_first
  from public.stock_quants quant
  join public.inventory_reservation_lines line on line.product_id = quant.product_product_id
  where line.id = first_line and quant.location_id = resources.location_id;
  select quantity_on_hand into before_second
  from public.stock_quants quant
  join public.inventory_reservation_lines line on line.product_id = quant.product_product_id
  where line.id = second_line and quant.location_id = resources.location_id;
  begin
    perform public.commit_inventory_delivery(
      resources.failure_reservation_id,
      jsonb_build_array(
        jsonb_build_object('reservation_line_id', first_line, 'quantity', 1),
        jsonb_build_object('reservation_line_id', second_line, 'quantity', 2)
      ), 'inventory-runtime-atomic-delivery-failure'
    );
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'Q_FAULT_INJECTION_NOT_REJECTED'; end if;
  if (select delivered_quantity from public.inventory_reservation_lines where id = first_line) <> 0
     or (select quantity_on_hand from public.stock_quants quant join public.inventory_reservation_lines line on line.product_id = quant.product_product_id where line.id = first_line and quant.location_id = resources.location_id) <> before_first
     or (select quantity_on_hand from public.stock_quants quant join public.inventory_reservation_lines line on line.product_id = quant.product_product_id where line.id = second_line and quant.location_id = resources.location_id) <> before_second
     or exists (select 1 from public.inventory_deliveries where idempotency_key = 'inventory-runtime-atomic-delivery-failure')
     or exists (select 1 from public.stock_moves where reference_type = 'canonical_inventory_delivery' and notes = 'Canonical physical delivery' and created_at >= current_timestamp - interval '1 minute' and product_product_id in (resources.quantity_product_2_id, resources.quantity_product_3_id)) then
    raise exception 'Q_ATOMIC_ROLLBACK_FAILED';
  end if;
end
$$;
reset role;

-- Canonical tables reject frontend-style direct writes; immutable events reject mutation.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from inventory_core_context;
set local role authenticated;
do $$
declare resources inventory_core_resources%rowtype; direct_rejected boolean := false; event_rejected boolean := false;
begin
  select * into resources from inventory_core_resources;
  begin
    execute 'update public.inventory_reservations set updated_at = now() where id = $1'
      using resources.main_reservation_id;
  exception when insufficient_privilege then direct_rejected := true; end;
  begin
    execute 'update public.inventory_events set details = details where reservation_id = $1'
      using resources.main_reservation_id;
  exception when insufficient_privilege then event_rejected := true; end;
  if not direct_rejected then raise exception 'CANONICAL_DIRECT_WRITE_NOT_BLOCKED'; end if;
  if not event_rejected then raise exception 'IMMUTABLE_EVENT_UPDATE_NOT_BLOCKED'; end if;
end
$$;
reset role;

-- Internal invariants after all accepted and rejected commands.
do $$
declare resources inventory_core_resources%rowtype;
begin
  select * into resources from inventory_core_resources;
  if exists (
    select 1 from public.inventory_reservation_lines line
    where line.tenant_id = (select tenant_id from inventory_core_context)
      and (line.released_quantity + line.delivered_quantity > line.reserved_quantity
        or line.reserved_quantity > line.quantity)
  ) then raise exception 'RESERVATION_QUANTITY_INVARIANT_BROKEN'; end if;
  if exists (
    select 1
    from public.inventory_delivery_lines delivery_line
    where delivery_line.tenant_id = (select tenant_id from inventory_core_context)
      and coalesce((select sum(return_line.quantity) from public.inventory_return_lines return_line where return_line.delivery_line_id = delivery_line.id), 0) > delivery_line.quantity
  ) then raise exception 'RETURN_QUANTITY_INVARIANT_BROKEN'; end if;
  if exists (
    select 1 from public.stock_quants quant
    where quant.product_product_id in (
      resources.quantity_product_id, resources.quantity_product_2_id,
      resources.quantity_product_3_id
    ) and quant.quantity_on_hand < 0
  ) then raise exception 'NEGATIVE_STOCK_INVARIANT_BROKEN'; end if;
end
$$;

select jsonb_build_object(
  'availability', 'passed',
  'serial_reserve_and_double_reserve', 'passed',
  'quantity_reserve_and_over_reserve', 'passed',
  'release', 'passed',
  'delivery_and_over_delivery', 'passed',
  'return_and_over_return', 'passed',
  'tenant_branch_location_scope', 'passed',
  'tracking_eligibility', 'passed',
  'idempotency', 'passed',
  'atomic_rollback', 'passed',
  'negative_stock', 'passed',
  'write_boundary', 'passed'
) as minimum_inventory_core_runtime;

rollback;
