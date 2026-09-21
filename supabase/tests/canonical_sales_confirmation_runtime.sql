-- Canonical Sales Confirmation scenarios 1-25. Every fixture and posting rolls back.
begin;

create temporary table sales_confirmation_before as
select
  (select count(*) from public.inventory_reservations) reservations,
  (select count(*) from public.inventory_deliveries) deliveries,
  (select count(*) from public.inventory_returns) returns,
  (select count(*) from public.financial_sale_postings) postings,
  (select count(*) from public.financial_payments) payments,
  (select count(*) from public.financial_payment_allocations) allocations,
  (select count(*) from public.account_partial_reconcile) reconciliations;
grant select on sales_confirmation_before to authenticated;

create temporary table sales_confirmation_context as
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
  if not exists (select 1 from sales_confirmation_context) then
    raise exception 'SALES_CONFIRMATION_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end $$;

create temporary table sales_confirmation_resources (
  branch_id uuid, wrong_branch_id uuid,
  location_id uuid, denied_location_id uuid, wrong_branch_location_id uuid,
  customer_id uuid, operator_id uuid,
  serial_template_id uuid, serial_product_id uuid,
  quantity_template_id uuid, quantity_product_id uuid,
  failure_template_id uuid, failure_product_id uuid,
  service_template_id uuid, service_product_id uuid,
  serial_unit_1_id uuid, serial_unit_2_id uuid, incomplete_unit_id uuid,
  serial_sale_id uuid, quantity_sale_id uuid, multi_sale_id uuid,
  permission_sale_id uuid, wrong_branch_sale_id uuid, wrong_location_sale_id uuid,
  stale_sale_id uuid, unavailable_sale_id uuid, insufficient_sale_id uuid,
  financial_failure_sale_id uuid, final_state_failure_sale_id uuid
);
grant select on sales_confirmation_context to authenticated;
grant select, update on sales_confirmation_resources to authenticated;

do $$
declare
  context sales_confirmation_context%rowtype;
  resources sales_confirmation_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  receivable_account_id uuid;
  revenue_account_id uuid;
begin
  select * into context from sales_confirmation_context;
  resources.branch_id := gen_random_uuid();
  resources.wrong_branch_id := gen_random_uuid();
  resources.location_id := gen_random_uuid();
  resources.denied_location_id := gen_random_uuid();
  resources.wrong_branch_location_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid();
  resources.operator_id := gen_random_uuid();
  resources.serial_template_id := gen_random_uuid();
  resources.serial_product_id := gen_random_uuid();
  resources.quantity_template_id := gen_random_uuid();
  resources.quantity_product_id := gen_random_uuid();
  resources.failure_template_id := gen_random_uuid();
  resources.failure_product_id := gen_random_uuid();
  resources.service_template_id := gen_random_uuid();
  resources.service_product_id := gen_random_uuid();
  resources.serial_unit_1_id := gen_random_uuid();
  resources.serial_unit_2_id := gen_random_uuid();
  resources.incomplete_unit_id := gen_random_uuid();

  receivable_account_id := public.resolve_functional_account(
    context.tenant_id, 'customer_receivable', null
  );
  revenue_account_id := public.resolve_functional_account(
    context.tenant_id, 'sales_revenue', null
  );
  insert into public.branches (id, tenant_id, name, code, is_active) values
    (resources.branch_id, context.tenant_id, 'Sales Confirmation Branch', 'SCF' || left(suffix, 4), true),
    (resources.wrong_branch_id, context.tenant_id, 'Sales Confirmation Denied Branch', 'SCW' || left(suffix, 4), true);
  insert into public.stock_locations (
    id, tenant_id, branch_id, code, name, location_type, is_active
  ) values
    (resources.location_id, context.tenant_id, resources.branch_id,
      'SCL' || left(suffix, 5), 'Sales Confirmation Location', 'internal', true),
    (resources.denied_location_id, context.tenant_id, resources.branch_id,
      'SCD' || left(suffix, 5), 'Sales Confirmation Denied Location', 'internal', true),
    (resources.wrong_branch_location_id, context.tenant_id, resources.wrong_branch_id,
      'SCW' || left(suffix, 5), 'Sales Confirmation Wrong Branch Location', 'internal', true);
  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values (
    resources.customer_id, context.tenant_id, resources.branch_id,
    'Sales Confirmation Customer', 'person', false, true, 1, 0, 0, true
  );

  perform public.resolve_financial_journal(context.tenant_id, 'sale', resources.branch_id, null);
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
    (resources.serial_template_id, context.tenant_id, 'Sales Confirm Serial', 'SCS-' || suffix, 'goods', 'serial', true, true, 1000),
    (resources.quantity_template_id, context.tenant_id, 'Sales Confirm Quantity', 'SCQ-' || suffix, 'goods', 'none', true, true, 100),
    (resources.failure_template_id, context.tenant_id, 'Sales Confirm Failure Quantity', 'SCF-' || suffix, 'goods', 'none', true, true, 50),
    (resources.service_template_id, context.tenant_id, 'Sales Confirm Service', 'SCV-' || suffix, 'service', 'none', true, true, 25);
  insert into public.product_products (
    id, tenant_id, product_template_id, display_name, sku, tracking,
    is_active, sale_price
  ) values
    (resources.serial_product_id, context.tenant_id, resources.serial_template_id, 'Sales Confirm Serial', 'SCS-' || suffix, 'serial', true, 1000),
    (resources.quantity_product_id, context.tenant_id, resources.quantity_template_id, 'Sales Confirm Quantity', 'SCQ-' || suffix, 'none', true, 100),
    (resources.failure_product_id, context.tenant_id, resources.failure_template_id, 'Sales Confirm Failure Quantity', 'SCF-' || suffix, 'none', true, 50),
    (resources.service_product_id, context.tenant_id, resources.service_template_id, 'Sales Confirm Service', 'SCV-' || suffix, 'none', true, 25);
  update public.product_templates template set default_product_product_id = product.id
  from public.product_products product
  where template.id in (
    resources.serial_template_id, resources.quantity_template_id,
    resources.failure_template_id, resources.service_template_id
  ) and product.product_template_id = template.id;

  insert into public.stock_tracking_units (
    id, tenant_id, product_product_id, product_template_id,
    tracking_type, tracking_number, status, data_status,
    incomplete_reason, current_location_id
  ) values
    (resources.serial_unit_1_id, context.tenant_id, resources.serial_product_id,
      resources.serial_template_id, 'serial', 'SCSU1-' || suffix, 'in_stock', 'complete', null, resources.location_id),
    (resources.serial_unit_2_id, context.tenant_id, resources.serial_product_id,
      resources.serial_template_id, 'serial', 'SCSU2-' || suffix, 'in_stock', 'complete', null, resources.location_id),
    (resources.incomplete_unit_id, context.tenant_id, resources.serial_product_id,
      resources.serial_template_id, 'serial', 'SCSI-' || suffix, 'in_stock', 'incomplete', 'missing_identifiers', resources.location_id);
  insert into public.stock_quants (
    tenant_id, product_product_id, product_template_id, location_id,
    quantity_on_hand, reserved_quantity
  ) values
    (context.tenant_id, resources.quantity_product_id, resources.quantity_template_id, resources.location_id, 20, 0),
    (context.tenant_id, resources.failure_product_id, resources.failure_template_id, resources.location_id, 5, 0),
    (context.tenant_id, resources.failure_product_id, resources.failure_template_id, resources.denied_location_id, 5, 0);

  insert into public.tenant_users (id, tenant_id, auth_user_id, full_name, role, is_active)
  values (resources.operator_id, context.tenant_id, context.operator_auth, 'Sales Confirmation Operator', 'staff', true);
  insert into public.res_groups (tenant_id, name, code, category, is_system, active)
  values (context.tenant_id, 'Sales Confirmation Runtime', 'sales_confirmation_runtime_' || suffix, 'sales', false, true);
  insert into public.auth_group_permissions (group_id, permission_id)
  select permission_group.id, permission.id
  from public.res_groups permission_group
  cross join public.auth_permissions permission
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code = 'sales_confirmation_runtime_' || suffix
    and permission.code in ('sales.access', 'sales.create', 'sales.update_draft', 'sales.view');
  insert into public.res_users_groups (tenant_id, user_id, group_id)
  select context.tenant_id, resources.operator_id, permission_group.id
  from public.res_groups permission_group
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code = 'sales_confirmation_runtime_' || suffix;
  insert into public.user_branch_access (tenant_id, user_id, branch_id)
  values (context.tenant_id, resources.operator_id, resources.branch_id);
  insert into public.user_stock_location_access (
    tenant_id, user_id, stock_location_id, branch_id
  ) values (context.tenant_id, resources.operator_id, resources.location_id, resources.branch_id);

  insert into sales_confirmation_resources values (resources.*);
end
$$;

create function pg_temp.create_ready_sale(
  p_key text, p_lines jsonb, p_branch_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare resources sales_confirmation_resources%rowtype; result jsonb; sale_id uuid;
begin
  select * into resources from sales_confirmation_resources;
  result := public.create_sale(
    coalesce(p_branch_id, resources.branch_id), resources.customer_id,
    current_date, 'EGP', p_key, p_key || '-create'
  );
  sale_id := (result ->> 'sale_id')::uuid;
  perform public.update_sale_draft(
    sale_id, 1, coalesce(p_branch_id, resources.branch_id), resources.customer_id,
    current_date, 'EGP', p_key, p_lines, p_key || '-update'
  );
  return sale_id;
end
$$;

create function pg_temp.sale_number_total()
returns bigint
language sql
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(sum(last_value), 0)::bigint from public.sale_number_sequences
$$;

create function pg_temp.sales_command_exists(p_idempotency_key text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.sales_command_requests command_request
    where command_request.idempotency_key = p_idempotency_key
  )
$$;

create function pg_temp.sales_command_id(p_idempotency_key text)
returns uuid
language sql
security definer
set search_path = pg_catalog, public
as $$
  select command_request.id
  from public.sales_command_requests command_request
  where command_request.idempotency_key = p_idempotency_key
  order by command_request.created_at desc limit 1
$$;

create function pg_temp.sales_financial_binding_exists(p_sale_id uuid)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.financial_engine_bindings binding
    where binding.source_app = 'sales_core'
      and binding.source_model = 'sale'
      and binding.source_id = p_sale_id::text
  )
$$;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from sales_confirmation_context;
set local role authenticated;
select public.set_financial_period_lock(
  tenant_id, current_date, false, 'Sales confirmation rollback runtime'
) from sales_confirmation_context;
select public.configure_financial_posting_policy(
  tenant_id, false, 'Sales confirmation rollback runtime'
) from sales_confirmation_context;

-- 1/4/5/6/7/8/9/10/11/22/24/25: serialized confirmation and replay.
do $$
declare
  resources sales_confirmation_resources%rowtype;
  sale_line_id uuid; result jsonb; replay jsonb; dto jsonb; details jsonb;
  reservation_id uuid; posting_id uuid; number_value text;
  before_deliveries bigint; before_payments bigint;
  before_allocations bigint; before_reconciliations bigint;
  mismatch_rejected boolean := false; immutable_rejected boolean := false;
begin
  select * into resources from sales_confirmation_resources;
  select count(*) into before_deliveries from public.inventory_deliveries;
  select count(*) into before_payments from public.financial_payments;
  select count(*) into before_allocations from public.financial_payment_allocations;
  select count(*) into before_reconciliations from public.account_partial_reconcile;
  resources.serial_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-serial',
    jsonb_build_array(jsonb_build_object(
      'product_id', resources.serial_product_id, 'quantity', 1, 'unit_price', 1000
    ))
  );
  update sales_confirmation_resources set serial_sale_id = resources.serial_sale_id;
  select id into sale_line_id from public.sale_lines where sale_id = resources.serial_sale_id;
  result := public.confirm_sale(
    resources.serial_sale_id, 2,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', sale_line_id, 'location_id', resources.location_id,
      'tracking_unit_id', resources.serial_unit_1_id, 'quantity', 1
    )), 'sales-confirm-serial-command'
  );
  number_value := result ->> 'sale_number';
  select inventory_reservation_id, financial_sale_posting_id
  into reservation_id, posting_id
  from public.sale_confirmation_links where sale_id = resources.serial_sale_id;
  dto := public.get_sale(resources.serial_sale_id);
  details := public.get_sale_details(resources.serial_sale_id);
  if result ->> 'status' <> 'confirmed' or (result ->> 'version')::bigint <> 3
     or number_value !~ '^SAL-[0-9]{4}-[0-9]{6,9}$'
     or (select status from public.sales where id = resources.serial_sale_id) <> 'confirmed'
     or (select status from public.stock_tracking_units where id = resources.serial_unit_1_id) <> 'reserved'
     or (select state from public.inventory_tracking_unit_states where tracking_unit_id = resources.serial_unit_1_id) <> 'reserved'
     or (select state from public.inventory_reservations where id = reservation_id) <> 'active'
     or (select state from public.financial_sale_postings where id = posting_id) <> 'posted'
     or (select amount_residual from public.account_move_lines line
         join public.financial_sale_postings posting on posting.receivable_line_id = line.id
         where posting.id = posting_id) <> 1000
     or dto -> 'inventory' ->> 'state' <> 'active'
     or dto -> 'financial' ->> 'state' <> 'posted'
     or details ->> 'commercial_status' <> 'confirmed'
     or details -> 'payment' ->> 'status' <> 'unpaid'
     or (details -> 'payment' ->> 'outstanding_amount')::numeric <> 1000
     or details -> 'fulfillment' ->> 'status' <> 'reserved'
     or details -> 'lines' -> 0 -> 'inventory' ->> 'status' <> 'reserved'
     or jsonb_array_length(details -> 'lines' -> 0 -> 'inventory' -> 'tracking_units') <> 1
     or not (details -> 'events' @> jsonb_build_array(jsonb_build_object('type', 'sale_confirmed')))
     or details ? 'financial' or details ? 'inventory'
     or dto ? 'account_id' or dto ? 'journal_id' or dto ? 'receivable_line_id' then
    raise exception 'SERIAL_CONFIRMATION_INVALID result=% dto=%', result, dto;
  end if;
  replay := public.confirm_sale(
    resources.serial_sale_id, 2,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', sale_line_id, 'location_id', resources.location_id,
      'tracking_unit_id', resources.serial_unit_1_id, 'quantity', 1
    )), 'sales-confirm-serial-command'
  );
  if not (replay ->> 'idempotent_replay')::boolean
     or replay ->> 'sale_number' <> number_value
     or (select count(*) from public.inventory_reservations where source_type = 'sale' and source_id = resources.serial_sale_id::text) <> 1
     or (select count(*) from public.financial_sale_postings where source_app = 'sales_core' and source_id = resources.serial_sale_id::text) <> 1
     or (select count(*) from public.sale_events where sale_id = resources.serial_sale_id and event_type = 'sale_confirmed') <> 1
     or (select count(*) from public.sale_confirmation_links where sale_id = resources.serial_sale_id) <> 1 then
    raise exception 'CONFIRMATION_REPLAY_DUPLICATED_STATE: %', replay;
  end if;
  begin
    perform public.confirm_sale(
      resources.serial_sale_id, 2,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', sale_line_id, 'location_id', resources.location_id,
        'tracking_unit_id', resources.serial_unit_2_id, 'quantity', 1
      )), 'sales-confirm-serial-command'
    );
  exception when check_violation then mismatch_rejected := sqlerrm = 'SALES_IDEMPOTENCY_CONFLICT'; end;
  if not mismatch_rejected then raise exception 'CONFIRMATION_IDEMPOTENCY_MISMATCH_ACCEPTED'; end if;
  begin
    perform public.update_sale_draft(
      resources.serial_sale_id, 3, resources.branch_id, resources.customer_id,
      current_date, 'EGP', 'forbidden', '[]'::jsonb, 'confirmed-update-forbidden'
    );
  exception when check_violation then immutable_rejected := true; end;
  if not immutable_rejected then raise exception 'CONFIRMED_SALE_MUTABLE'; end if;
  if (select count(*) from public.inventory_deliveries) <> before_deliveries
     or (select count(*) from public.financial_payments) <> before_payments
     or (select count(*) from public.financial_payment_allocations) <> before_allocations
     or (select count(*) from public.account_partial_reconcile) <> before_reconciliations then
    raise exception 'CONFIRMATION_CREATED_DELIVERY_OR_PAYMENT';
  end if;
end
$$;

-- 12: stale expected_version fails without side effects.
do $$
declare resources sales_confirmation_resources%rowtype; rejected boolean := false;
begin
  select * into resources from sales_confirmation_resources;
  resources.stale_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-stale', jsonb_build_array(jsonb_build_object(
      'product_id', resources.service_product_id, 'quantity', 1, 'unit_price', 25
    ))
  );
  update sales_confirmation_resources set stale_sale_id = resources.stale_sale_id;
  begin
    perform public.confirm_sale(resources.stale_sale_id, 1, '[]'::jsonb, 'sales-confirm-stale-command');
  exception when serialization_failure then rejected := true; end;
  if not rejected or (select status from public.sales where id = resources.stale_sale_id) <> 'draft' then
    raise exception 'STALE_CONFIRMATION_NOT_REJECTED';
  end if;
end
$$;

-- 16: operator without sales.confirm is rejected.
do $$
declare resources sales_confirmation_resources%rowtype;
begin
  select * into resources from sales_confirmation_resources;
  resources.permission_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-permission', jsonb_build_array(jsonb_build_object(
      'product_id', resources.quantity_product_id, 'quantity', 1, 'unit_price', 100
    ))
  );
  update sales_confirmation_resources set permission_sale_id = resources.permission_sale_id;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_confirmation_context;
set local role authenticated;
do $$
declare resources sales_confirmation_resources%rowtype; line_id uuid; rejected boolean := false;
begin
  select * into resources from sales_confirmation_resources;
  select id into line_id from public.sale_lines where sale_id = resources.permission_sale_id;
  begin
    perform public.confirm_sale(
      resources.permission_sale_id, 2,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', line_id, 'location_id', resources.location_id, 'quantity', 1
      )), 'sales-confirm-permission-command'
    );
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'MISSING_SALES_CONFIRM_NOT_REJECTED'; end if;
end
$$;
reset role;

-- Grant only sales.confirm. The operator intentionally has neither Inventory
-- reserve nor Financial Sale Posting permission.
do $$
declare context sales_confirmation_context%rowtype; resources sales_confirmation_resources%rowtype;
begin
  select * into context from sales_confirmation_context;
  select * into resources from sales_confirmation_resources;
  insert into public.auth_group_permissions (group_id, permission_id)
  select permission_group.id, permission.id
  from public.res_groups permission_group
  join public.res_users_groups membership on membership.group_id = permission_group.id
  join public.auth_permissions permission on permission.code = 'sales.confirm'
  where membership.user_id = resources.operator_id
    and permission_group.tenant_id = context.tenant_id
  on conflict (group_id, permission_id) do nothing;
end
$$;

-- 2/14: quantity confirmation succeeds for a scoped Sales confirmer without
-- direct Inventory/Financial permissions; wrong branch remains denied.
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_confirmation_context;
set local role authenticated;
do $$
declare resources sales_confirmation_resources%rowtype; line_id uuid; result jsonb;
  spoof_reserve_rejected boolean := false; spoof_financial_rejected boolean := false;
begin
  select * into resources from sales_confirmation_resources;
  if public.has_permission('inventory.reserve', (select tenant_id from sales_confirmation_context))
     or public.has_permission('financial.sale.post_operational', (select tenant_id from sales_confirmation_context)) then
    raise exception 'OPERATOR_UNEXPECTEDLY_HAS_CORE_INTERNAL_PERMISSIONS';
  end if;
  resources.quantity_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-quantity', jsonb_build_array(jsonb_build_object(
      'product_id', resources.quantity_product_id, 'quantity', 3, 'unit_price', 100
    ))
  );
  update sales_confirmation_resources set quantity_sale_id = resources.quantity_sale_id;
  select id into line_id from public.sale_lines where sale_id = resources.quantity_sale_id;
  result := public.confirm_sale(
    resources.quantity_sale_id, 2,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', line_id, 'location_id', resources.location_id, 'quantity', 3
    )), 'sales-confirm-quantity-command'
  );
  if result -> 'inventory' ->> 'state' <> 'reserved'
     or not exists (
       select 1 from public.sale_confirmation_links link
       where link.sale_id = resources.quantity_sale_id
         and link.inventory_reservation_id is not null
     ) then
    raise exception 'QUANTITY_CONFIRMATION_INVALID: %', result;
  end if;
  perform set_config(
    'app.canonical_sales_confirmation_command',
    pg_temp.sales_command_id('sales-confirm-quantity-command')::text, true
  );
  begin
    perform public.reserve_inventory(
      resources.branch_id, resources.location_id, 'sale', resources.quantity_sale_id::text,
      jsonb_build_array(jsonb_build_object(
        'product_id', resources.quantity_product_id, 'quantity', 1
      )), 'sales-confirm-spoof-reserve'
    );
  exception when insufficient_privilege then spoof_reserve_rejected := true; end;
  begin
    perform public.post_financial_sale(
      (select tenant_id from sales_confirmation_context), 'sales_core', 'sale',
      resources.quantity_sale_id::text, 3, 'sales-confirm-spoof-financial',
      repeat('a', 64), resources.customer_id, 300, 'EGP', current_date,
      resources.branch_id, result ->> 'sale_number'
    );
  exception when insufficient_privilege then spoof_financial_rejected := true; end;
  perform set_config('app.canonical_sales_confirmation_command', '', true);
  if not spoof_reserve_rejected or not spoof_financial_rejected then
    raise exception 'COMPLETED_CONFIRMATION_CAPABILITY_REUSABLE';
  end if;
end
$$;
reset role;

-- Owner prepares scope failures and a multi-line Sale.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from sales_confirmation_context;
set local role authenticated;
do $$
declare resources sales_confirmation_resources%rowtype;
begin
  select * into resources from sales_confirmation_resources;
  resources.wrong_branch_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-wrong-branch', jsonb_build_array(jsonb_build_object(
      'product_id', resources.service_product_id, 'quantity', 1, 'unit_price', 25
    )), resources.wrong_branch_id
  );
  resources.wrong_location_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-wrong-location', jsonb_build_array(jsonb_build_object(
      'product_id', resources.failure_product_id, 'quantity', 1, 'unit_price', 50
    ))
  );
  resources.multi_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-multi', jsonb_build_array(
      jsonb_build_object('product_id', resources.serial_product_id, 'quantity', 1, 'unit_price', 1000),
      jsonb_build_object('product_id', resources.quantity_product_id, 'quantity', 2, 'unit_price', 100),
      jsonb_build_object('product_id', resources.service_product_id, 'quantity', 1, 'unit_price', 25)
    )
  );
  update sales_confirmation_resources set
    wrong_branch_sale_id = resources.wrong_branch_sale_id,
    wrong_location_sale_id = resources.wrong_location_sale_id,
    multi_sale_id = resources.multi_sale_id;
end
$$;
reset role;

select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_confirmation_context;
set local role authenticated;
do $$
declare resources sales_confirmation_resources%rowtype; line_id uuid;
  branch_rejected boolean := false; location_rejected boolean := false;
begin
  select * into resources from sales_confirmation_resources;
  begin
    perform public.confirm_sale(resources.wrong_branch_sale_id, 2, '[]'::jsonb, 'sales-confirm-wrong-branch-command');
  exception when insufficient_privilege then branch_rejected := true; end;
  select id into line_id from public.sale_lines where sale_id = resources.wrong_location_sale_id;
  begin
    perform public.confirm_sale(
      resources.wrong_location_sale_id, 2,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', line_id, 'location_id', resources.denied_location_id, 'quantity', 1
      )), 'sales-confirm-wrong-location-command'
    );
  exception when insufficient_privilege then location_rejected := true; end;
  if not branch_rejected then raise exception 'WRONG_BRANCH_CONFIRMATION_NOT_REJECTED'; end if;
  if not location_rejected then raise exception 'WRONG_LOCATION_CONFIRMATION_NOT_REJECTED'; end if;
end
$$;
reset role;

-- 3: multi-line serial + quantity + service confirmation.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from sales_confirmation_context;
set local role authenticated;
do $$
declare resources sales_confirmation_resources%rowtype; serial_line uuid; quantity_line uuid; result jsonb;
begin
  select * into resources from sales_confirmation_resources;
  select line.id into serial_line from public.sale_lines line
  where line.sale_id = resources.multi_sale_id and line.product_id = resources.serial_product_id;
  select line.id into quantity_line from public.sale_lines line
  where line.sale_id = resources.multi_sale_id and line.product_id = resources.quantity_product_id;
  result := public.confirm_sale(
    resources.multi_sale_id, 2,
    jsonb_build_array(
      jsonb_build_object('sale_line_id', serial_line, 'location_id', resources.location_id, 'tracking_unit_id', resources.serial_unit_2_id, 'quantity', 1),
      jsonb_build_object('sale_line_id', quantity_line, 'location_id', resources.location_id, 'quantity', 2)
    ), 'sales-confirm-multi-command'
  );
  if (result ->> 'total_amount')::numeric <> 1225
     or (select count(*) from public.sale_inventory_selections where sale_id = resources.multi_sale_id) <> 2
     or (select count(*) from public.inventory_reservation_lines line
         join public.inventory_reservations reservation on reservation.id = line.reservation_id
         where reservation.source_id = resources.multi_sale_id::text) <> 2 then
    raise exception 'MULTI_LINE_CONFIRMATION_INVALID: %', result;
  end if;
end
$$;

-- 17/18/19/21: inventory readiness failures roll back the command completely.
do $$
declare resources sales_confirmation_resources%rowtype; line_id uuid;
  rejected boolean; before_reservations bigint; before_sequence bigint;
begin
  select * into resources from sales_confirmation_resources;
  resources.unavailable_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-unavailable', jsonb_build_array(jsonb_build_object(
      'product_id', resources.serial_product_id, 'quantity', 1, 'unit_price', 1000
    ))
  );
  update sales_confirmation_resources set unavailable_sale_id = resources.unavailable_sale_id;
  select id into line_id from public.sale_lines where sale_id = resources.unavailable_sale_id;
  select count(*) into before_reservations from public.inventory_reservations;
  before_sequence := pg_temp.sale_number_total();
  rejected := false;
  begin
    perform public.confirm_sale(
      resources.unavailable_sale_id, 2,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', line_id, 'location_id', resources.location_id,
        'tracking_unit_id', resources.incomplete_unit_id, 'quantity', 1
      )), 'sales-confirm-unavailable-command'
    );
  exception when check_violation then rejected := true; end;
  if not rejected
     or (select status from public.sales where id = resources.unavailable_sale_id) <> 'draft'
     or (select count(*) from public.inventory_reservations) <> before_reservations
     or pg_temp.sale_number_total() <> before_sequence
     or pg_temp.sales_command_exists('sales-confirm-unavailable-command') then
    raise exception 'INVENTORY_FAILURE_NOT_ATOMIC';
  end if;

  resources.insufficient_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-insufficient', jsonb_build_array(jsonb_build_object(
      'product_id', resources.quantity_product_id, 'quantity', 100, 'unit_price', 100
    ))
  );
  update sales_confirmation_resources set insufficient_sale_id = resources.insufficient_sale_id;
  select id into line_id from public.sale_lines where sale_id = resources.insufficient_sale_id;
  rejected := false;
  begin
    perform public.confirm_sale(
      resources.insufficient_sale_id, 2,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', line_id, 'location_id', resources.location_id, 'quantity', 100
      )), 'sales-confirm-insufficient-command'
    );
  exception when check_violation then rejected := true; end;
  if not rejected or (select status from public.sales where id = resources.insufficient_sale_id) <> 'draft' then
    raise exception 'INSUFFICIENT_QUANTITY_NOT_REJECTED';
  end if;
end
$$;

-- 20: force Financial posting failure after the reservation step.
reset role;
create function pg_temp.reject_sales_confirmation_financial_posting()
returns trigger language plpgsql as $$ begin
  if new.source_app = 'sales_core' then
    raise exception using errcode = '23514', message = 'INTENTIONAL_CONFIRMATION_FINANCIAL_FAILURE';
  end if;
  return new;
end $$;
create trigger zz_sales_confirmation_financial_failure
before insert on public.financial_sale_postings
for each row execute function pg_temp.reject_sales_confirmation_financial_posting();
set local role authenticated;
do $$
declare resources sales_confirmation_resources%rowtype; line_id uuid;
  rejected boolean := false; before_reservations bigint; before_postings bigint; before_sequence bigint;
begin
  select * into resources from sales_confirmation_resources;
  resources.financial_failure_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-financial-failure', jsonb_build_array(jsonb_build_object(
      'product_id', resources.failure_product_id, 'quantity', 1, 'unit_price', 50
    ))
  );
  update sales_confirmation_resources set financial_failure_sale_id = resources.financial_failure_sale_id;
  select id into line_id from public.sale_lines where sale_id = resources.financial_failure_sale_id;
  select count(*) into before_reservations from public.inventory_reservations;
  select count(*) into before_postings from public.financial_sale_postings;
  before_sequence := pg_temp.sale_number_total();
  begin
    perform public.confirm_sale(
      resources.financial_failure_sale_id, 2,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', line_id, 'location_id', resources.location_id, 'quantity', 1
      )), 'sales-confirm-financial-failure-command'
    );
  exception when check_violation then rejected := sqlerrm = 'INTENTIONAL_CONFIRMATION_FINANCIAL_FAILURE'; end;
  if not rejected
     or (select status from public.sales where id = resources.financial_failure_sale_id) <> 'draft'
     or (select sale_number from public.sales where id = resources.financial_failure_sale_id) is not null
     or (select count(*) from public.inventory_reservations) <> before_reservations
     or (select count(*) from public.financial_sale_postings) <> before_postings
     or pg_temp.sale_number_total() <> before_sequence
     or pg_temp.sales_financial_binding_exists(resources.financial_failure_sale_id)
     or exists (select 1 from public.sale_events where sale_id = resources.financial_failure_sale_id and event_type = 'sale_confirmed')
     or exists (select 1 from public.sale_confirmation_links where sale_id = resources.financial_failure_sale_id) then
    raise exception 'FINANCIAL_FAILURE_NOT_ATOMIC';
  end if;
end
$$;
reset role;
drop trigger zz_sales_confirmation_financial_failure on public.financial_sale_postings;

-- Failure after Inventory + Financial work but before final state/event.
create function pg_temp.reject_sales_confirmation_final_state()
returns trigger language plpgsql as $$
declare target uuid;
begin
  select final_state_failure_sale_id into target from sales_confirmation_resources;
  if new.id = target and new.status = 'confirmed' then
    raise exception using errcode = '23514', message = 'INTENTIONAL_CONFIRMATION_FINAL_STATE_FAILURE';
  end if;
  return new;
end $$;
create trigger zz_sales_confirmation_final_state_failure
before update on public.sales
for each row execute function pg_temp.reject_sales_confirmation_final_state();
set local role authenticated;
do $$
declare resources sales_confirmation_resources%rowtype; line_id uuid;
  rejected boolean := false; before_reservations bigint; before_postings bigint; before_sequence bigint;
begin
  select * into resources from sales_confirmation_resources;
  resources.final_state_failure_sale_id := pg_temp.create_ready_sale(
    'sales-confirm-final-state-failure', jsonb_build_array(jsonb_build_object(
      'product_id', resources.failure_product_id, 'quantity', 1, 'unit_price', 50
    ))
  );
  update sales_confirmation_resources set final_state_failure_sale_id = resources.final_state_failure_sale_id;
  select id into line_id from public.sale_lines where sale_id = resources.final_state_failure_sale_id;
  select count(*) into before_reservations from public.inventory_reservations;
  select count(*) into before_postings from public.financial_sale_postings;
  before_sequence := pg_temp.sale_number_total();
  begin
    perform public.confirm_sale(
      resources.final_state_failure_sale_id, 2,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', line_id, 'location_id', resources.location_id, 'quantity', 1
      )), 'sales-confirm-final-state-failure-command'
    );
  exception when check_violation then rejected := sqlerrm = 'INTENTIONAL_CONFIRMATION_FINAL_STATE_FAILURE'; end;
  if not rejected
     or (select status from public.sales where id = resources.final_state_failure_sale_id) <> 'draft'
     or (select sale_number from public.sales where id = resources.final_state_failure_sale_id) is not null
     or (select count(*) from public.inventory_reservations) <> before_reservations
     or (select count(*) from public.financial_sale_postings) <> before_postings
     or pg_temp.sale_number_total() <> before_sequence
     or pg_temp.sales_financial_binding_exists(resources.final_state_failure_sale_id)
     or exists (select 1 from public.sale_events where sale_id = resources.final_state_failure_sale_id and event_type = 'sale_confirmed')
     or exists (select 1 from public.sale_confirmation_links where sale_id = resources.final_state_failure_sale_id)
     or exists (select 1 from public.sale_inventory_selections where sale_id = resources.final_state_failure_sale_id) then
    raise exception 'FINAL_STATE_FAILURE_NOT_ATOMIC';
  end if;
end
$$;
reset role;
drop trigger zz_sales_confirmation_final_state_failure on public.sales;

-- 13: foreign tenant cannot confirm a UUID in this tenant.
select set_config('request.jwt.claim.sub', foreign_auth::text, true)
from sales_confirmation_context;
set local role authenticated;
do $$
declare resources sales_confirmation_resources%rowtype; rejected boolean := false;
begin
  select * into resources from sales_confirmation_resources;
  begin
    perform public.confirm_sale(resources.stale_sale_id, 2, '[]'::jsonb, 'sales-confirm-foreign-command');
  exception when insufficient_privilege or check_violation then rejected := true; end;
  if not rejected then raise exception 'WRONG_TENANT_CONFIRMATION_NOT_REJECTED'; end if;
end
$$;

-- 23 plus artifact boundary: authenticated cannot manipulate state or links.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from sales_confirmation_context;
do $$
declare resources sales_confirmation_resources%rowtype;
  status_rejected boolean := false; selection_rejected boolean := false; link_rejected boolean := false;
begin
  select * into resources from sales_confirmation_resources;
  begin
    execute 'update public.sales set status = ''confirmed'' where id = $1' using resources.stale_sale_id;
  exception when insufficient_privilege then status_rejected := true; end;
  begin
    execute 'insert into public.sale_inventory_selections (tenant_id) values (gen_random_uuid())';
  exception when insufficient_privilege then selection_rejected := true; end;
  begin
    execute 'insert into public.sale_confirmation_links (tenant_id) values (gen_random_uuid())';
  exception when insufficient_privilege then link_rejected := true; end;
  if not status_rejected or not selection_rejected or not link_rejected then
    raise exception 'DIRECT_CONFIRMATION_DML_BOUNDARY_FAILED';
  end if;
end
$$;
reset role;

do $$
declare before_row sales_confirmation_before%rowtype;
begin
  select * into before_row from sales_confirmation_before;
  if (select count(*) from public.inventory_deliveries) <> before_row.deliveries
     or (select count(*) from public.inventory_returns) <> before_row.returns
     or (select count(*) from public.financial_payments) <> before_row.payments
     or (select count(*) from public.financial_payment_allocations) <> before_row.allocations
     or (select count(*) from public.account_partial_reconcile) <> before_row.reconciliations then
    raise exception 'CONFIRMATION_BOUNDARY_SIDE_EFFECT_REGRESSION';
  end if;
  if exists (
    select 1 from public.sale_confirmation_links link
    join public.sales sale on sale.id = link.sale_id and sale.tenant_id = link.tenant_id
    join public.financial_sale_postings posting
      on posting.id = link.financial_sale_posting_id and posting.tenant_id = link.tenant_id
    join public.financial_engine_bindings binding
      on binding.id = link.financial_engine_binding_id and binding.tenant_id = link.tenant_id
    left join public.inventory_reservations reservation
      on reservation.id = link.inventory_reservation_id and reservation.tenant_id = link.tenant_id
    where sale.status <> 'confirmed'
       or posting.source_id <> sale.id::text
       or posting.event_version <> sale.version
       or binding.canonical_sale_posting_id <> posting.id
       or (reservation.id is not null and (
         reservation.source_type <> 'sale' or reservation.source_id <> sale.id::text
       ))
  ) then
    raise exception 'CONFIRMATION_INTEGRATION_REFERENCE_INCONSISTENT';
  end if;
end
$$;

select jsonb_build_object(
  'serialized_confirmation', 'passed',
  'quantity_confirmation', 'passed',
  'multi_line_confirmation', 'passed',
  'numbering_and_idempotency', 'passed',
  'inventory_reserved_not_delivered', 'passed',
  'financial_ar_without_payment', 'passed',
  'authorization_and_scope', 'passed',
  'readiness_failures', 'passed',
  'financial_failure_rollback', 'passed',
  'final_state_failure_rollback', 'passed',
  'immutability_and_direct_dml', 'passed',
  'events_and_links', 'passed'
) canonical_sales_confirmation_runtime;

rollback;
