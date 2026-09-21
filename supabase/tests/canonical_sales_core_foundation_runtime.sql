-- Canonical Sales Core Foundation A-S runtime proof. All fixtures roll back.
begin;

create temporary table sales_core_before as
select
  (select count(*) from public.sales) sales,
  (select count(*) from public.sale_lines) sale_lines,
  (select count(*) from public.sale_events) sale_events,
  (select count(*) from public.sales_command_requests) commands,
  (select count(*) from public.sale_number_sequences) number_sequences,
  (select count(*) from public.inventory_reservations) inventory_reservations,
  (select count(*) from public.stock_moves) stock_moves,
  (select count(*) from public.financial_sale_postings) financial_postings,
  (select count(*) from public.account_moves) account_moves;

create temporary table sales_core_context as
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
order by owner.tenant_id limit 1;

do $$
begin
  if not exists (select 1 from sales_core_context) then
    raise exception 'SALES_CORE_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end
$$;

create temporary table sales_core_resources (
  branch_id uuid, wrong_branch_id uuid, operator_id uuid,
  customer_id uuid, inactive_customer_id uuid,
  goods_template_id uuid, goods_product_id uuid,
  service_template_id uuid, service_product_id uuid,
  main_sale_id uuid, empty_sale_id uuid, confirmed_sale_id uuid,
  foreign_branch_sale_id uuid
);
grant select on sales_core_context to authenticated;
grant select, update on sales_core_resources to authenticated;

do $$
declare
  context sales_core_context%rowtype;
  resources sales_core_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
begin
  select * into context from sales_core_context;
  resources.branch_id := gen_random_uuid();
  resources.wrong_branch_id := gen_random_uuid();
  resources.operator_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid();
  resources.inactive_customer_id := gen_random_uuid();
  resources.goods_template_id := gen_random_uuid();
  resources.goods_product_id := gen_random_uuid();
  resources.service_template_id := gen_random_uuid();
  resources.service_product_id := gen_random_uuid();

  insert into public.branches (id, tenant_id, name, code, is_active) values
    (resources.branch_id, context.tenant_id, 'Sales Core Branch', 'SC' || left(suffix, 5), true),
    (resources.wrong_branch_id, context.tenant_id, 'Sales Core Denied Branch', 'SD' || left(suffix, 5), true);
  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values
    (resources.customer_id, context.tenant_id, resources.branch_id,
      'Sales Core Customer', 'person', false, true, 1, 0, 0, true),
    (resources.inactive_customer_id, context.tenant_id, resources.branch_id,
      'Sales Core Inactive Customer', 'person', false, true, 1, 0, 0, false);
  insert into public.product_templates (
    id, tenant_id, name, internal_reference, product_type, tracking,
    can_be_sold, is_active, sale_price
  ) values
    (resources.goods_template_id, context.tenant_id, 'Sales Core Goods',
      'SCG-' || suffix, 'goods', 'none', true, true, 100),
    (resources.service_template_id, context.tenant_id, 'Sales Core Service',
      'SCS-' || suffix, 'service', 'none', true, true, 50);
  insert into public.product_products (
    id, tenant_id, product_template_id, display_name, sku, tracking,
    is_active, sale_price
  ) values
    (resources.goods_product_id, context.tenant_id, resources.goods_template_id,
      'Sales Core Goods', 'SCG-' || suffix, 'none', true, 100),
    (resources.service_product_id, context.tenant_id, resources.service_template_id,
      'Sales Core Service', 'SCS-' || suffix, 'none', true, 50);
  update public.product_templates template set default_product_product_id = product.id
  from public.product_products product
  where template.id in (resources.goods_template_id, resources.service_template_id)
    and product.product_template_id = template.id;

  insert into public.tenant_users (
    id, tenant_id, auth_user_id, full_name, role, is_active
  ) values (
    resources.operator_id, context.tenant_id, context.operator_auth,
    'Sales Core Operator', 'staff', true
  );
  insert into public.res_groups (tenant_id, name, code, category, is_system, active)
  values (context.tenant_id, 'Sales Core Runtime', 'sales_core_runtime_' || suffix, 'sales', false, true);
  insert into public.auth_group_permissions (group_id, permission_id)
  select permission_group.id, permission.id
  from public.res_groups permission_group
  cross join public.auth_permissions permission
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code = 'sales_core_runtime_' || suffix
    and permission.code in ('sales.access', 'sales.view', 'sales.update_draft');
  insert into public.res_users_groups (tenant_id, user_id, group_id)
  select context.tenant_id, resources.operator_id, permission_group.id
  from public.res_groups permission_group
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code = 'sales_core_runtime_' || suffix;
  insert into public.user_branch_access (tenant_id, user_id, branch_id)
  values (context.tenant_id, resources.operator_id, resources.branch_id);
  insert into sales_core_resources values (resources.*);
end
$$;

-- A. Owner creates an empty draft. No number or integration side effect exists.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from sales_core_context;
set local role authenticated;
do $$
declare resources sales_core_resources%rowtype; result jsonb;
begin
  select * into resources from sales_core_resources;
  result := public.create_sale(
    resources.branch_id, resources.customer_id, current_date,
    'egp', 'Canonical draft', 'sales-runtime-main-create'
  );
  resources.main_sale_id := (result ->> 'sale_id')::uuid;
  update sales_core_resources set main_sale_id = resources.main_sale_id;
  if result ->> 'status' <> 'draft' or (result ->> 'version')::bigint <> 1
     or result -> 'sale_number' <> 'null'::jsonb
     or (select total_amount from public.sales where id = resources.main_sale_id) <> 0 then
    raise exception 'A_CREATE_DRAFT_FAILED: %', result;
  end if;
end
$$;

-- B/C/R. Create retry is stable; changed payload conflicts; event is unique.
do $$
declare resources sales_core_resources%rowtype; result jsonb; conflict_rejected boolean := false;
begin
  select * into resources from sales_core_resources;
  result := public.create_sale(
    resources.branch_id, resources.customer_id, current_date,
    'EGP', 'Canonical draft', 'sales-runtime-main-create'
  );
  if (result ->> 'sale_id')::uuid <> resources.main_sale_id
     or (select count(*) from public.sales where create_idempotency_key = 'sales-runtime-main-create') <> 1
     or (select count(*) from public.sale_events where sale_id = resources.main_sale_id and event_type = 'sale_created') <> 1 then
    raise exception 'B_CREATE_IDEMPOTENCY_FAILED';
  end if;
  begin
    perform public.create_sale(
      resources.branch_id, resources.customer_id, current_date,
      'EGP', 'Different payload', 'sales-runtime-main-create'
    );
  exception when check_violation then conflict_rejected := true; end;
  if not conflict_rejected then raise exception 'C_IDEMPOTENCY_CONFLICT_NOT_REJECTED'; end if;
end
$$;

-- G. Inactive customer is rejected by the command.
do $$
declare resources sales_core_resources%rowtype; rejected boolean := false;
begin
  select * into resources from sales_core_resources;
  begin
    perform public.create_sale(
      resources.branch_id, resources.inactive_customer_id, current_date,
      'EGP', null, 'sales-runtime-inactive-customer'
    );
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'G_INACTIVE_CUSTOMER_NOT_REJECTED'; end if;
end
$$;

-- M. Empty draft is not ready.
do $$
declare resources sales_core_resources%rowtype; readiness jsonb;
begin
  select * into resources from sales_core_resources;
  readiness := public.get_sale_readiness(resources.main_sale_id);
  if (readiness ->> 'ready')::boolean
     or not (readiness -> 'blocking_reasons' ? 'SALE_LINES_REQUIRED')
     or not (readiness -> 'blocking_reasons' ? 'SALE_TOTAL_MUST_BE_POSITIVE') then
    raise exception 'M_EMPTY_READINESS_FAILED: %', readiness;
  end if;
end
$$;

-- H/I. Full draft update recomputes all totals and ignores client totals.
do $$
declare resources sales_core_resources%rowtype; result jsonb; dto jsonb;
begin
  select * into resources from sales_core_resources;
  result := public.update_sale_draft(
    resources.main_sale_id, 1, resources.branch_id, resources.customer_id,
    current_date, 'egp', 'Updated canonical draft',
    jsonb_build_array(
      jsonb_build_object(
        'product_id', resources.goods_product_id, 'quantity', 2,
        'unit_price', 100.126, 'line_total', 999999,
        'description', 'Server calculated goods'
      ),
      jsonb_build_object(
        'product_id', resources.service_product_id, 'quantity', 1,
        'unit_price', 50, 'line_total', 1
      )
    ), 'sales-runtime-main-update'
  );
  dto := public.get_sale(resources.main_sale_id);
  if (result ->> 'version')::bigint <> 2
     or (result ->> 'total_amount')::numeric <> 250.26
     or (dto ->> 'total_amount')::numeric <> 250.26
     or (dto -> 'lines' -> 0 ->> 'line_total')::numeric <> 200.26
     or (dto -> 'lines' -> 1 ->> 'line_total')::numeric <> 50 then
    raise exception 'H_I_SERVER_TOTAL_FAILED: result=%, dto=%', result, dto;
  end if;
  if dto ? 'account_id' or dto ? 'journal_id' or dto ? 'receivable_line_id'
     or dto ? 'payment_method' or dto ? 'money_destination' then
    raise exception 'GET_SALE_EXPOSED_INTERNAL_FINANCIAL_IDS';
  end if;
end
$$;

-- Update replay creates neither version nor event duplicates.
do $$
declare resources sales_core_resources%rowtype; result jsonb;
begin
  select * into resources from sales_core_resources;
  result := public.update_sale_draft(
    resources.main_sale_id, 1, resources.branch_id, resources.customer_id,
    current_date, 'EGP', 'Updated canonical draft',
    jsonb_build_array(
      jsonb_build_object('product_id', resources.goods_product_id, 'quantity', 2, 'unit_price', 100.126, 'line_total', 0, 'description', 'Server calculated goods'),
      jsonb_build_object('product_id', resources.service_product_id, 'quantity', 1, 'unit_price', 50, 'line_total', 0)
    ), 'sales-runtime-main-update'
  );
  if (result ->> 'version')::bigint <> 2
     or (select version from public.sales where id = resources.main_sale_id) <> 2
     or (select count(*) from public.sale_events where sale_id = resources.main_sale_id and event_type = 'sale_draft_updated') <> 1 then
    raise exception 'R_UPDATE_RETRY_DUPLICATED_STATE';
  end if;
end
$$;

-- A semantically equivalent request with a new key is a true no-op: only real
-- commercial changes may increment the version or append an event.
do $$
declare resources sales_core_resources%rowtype; result jsonb;
begin
  select * into resources from sales_core_resources;
  result := public.update_sale_draft(
    resources.main_sale_id, 2, resources.branch_id, resources.customer_id,
    current_date, 'EGP', 'Updated canonical draft',
    jsonb_build_array(
      jsonb_build_object('product_id', resources.goods_product_id, 'quantity', 2, 'unit_price', 100.13, 'description', 'Server calculated goods'),
      jsonb_build_object('product_id', resources.service_product_id, 'quantity', 1, 'unit_price', 50)
    ), 'sales-runtime-main-noop'
  );
  if (result ->> 'changed')::boolean
     or (result ->> 'version')::bigint <> 2
     or (select version from public.sales where id = resources.main_sale_id) <> 2
     or (select count(*) from public.sale_events where sale_id = resources.main_sale_id and event_type = 'sale_draft_updated') <> 1 then
    raise exception 'NOOP_UPDATE_CHANGED_STATE: %', result;
  end if;
end
$$;

-- K. A new request carrying stale expected_version fails closed.
do $$
declare resources sales_core_resources%rowtype; rejected boolean := false;
begin
  select * into resources from sales_core_resources;
  begin
    perform public.update_sale_draft(
      resources.main_sale_id, 1, resources.branch_id, resources.customer_id,
      current_date, 'EGP', 'Stale write',
      jsonb_build_array(jsonb_build_object('product_id', resources.service_product_id, 'quantity', 1, 'unit_price', 1)),
      'sales-runtime-stale-update'
    );
  exception when serialization_failure then rejected := true; end;
  if not rejected then raise exception 'K_STALE_VERSION_NOT_REJECTED'; end if;
end
$$;

-- N/O. Valid commercial data is ready; stock availability remains an explicit
-- confirmation-time warning because a Sale owns no stock location in Phase 2.
do $$
declare resources sales_core_resources%rowtype; readiness jsonb;
begin
  select * into resources from sales_core_resources;
  readiness := public.get_sale_readiness(resources.main_sale_id);
  if not (readiness ->> 'ready')::boolean
     or jsonb_array_length(readiness -> 'blocking_reasons') <> 0
     or not (readiness -> 'warnings' ? 'INVENTORY_AVAILABILITY_CHECK_REQUIRED_AT_CONFIRMATION') then
    raise exception 'N_O_VALID_READINESS_FAILED: %', readiness;
  end if;
end
$$;

-- Owner creates a valid draft in a branch that the scoped operator cannot see.
do $$
declare resources sales_core_resources%rowtype; result jsonb;
begin
  select * into resources from sales_core_resources;
  result := public.create_sale(
    resources.wrong_branch_id, resources.customer_id, current_date,
    'EGP', 'Branch isolation fixture', 'sales-runtime-foreign-branch'
  );
  update sales_core_resources
  set foreign_branch_sale_id = (result ->> 'sale_id')::uuid;
end
$$;

-- Prepare a second draft then transition it through the protected future-only
-- boundary solely to prove J. No confirmation command is created here.
do $$
declare resources sales_core_resources%rowtype; result jsonb;
begin
  select * into resources from sales_core_resources;
  result := public.create_sale(
    resources.branch_id, resources.customer_id, current_date,
    'EGP', 'Non-draft guard fixture', 'sales-runtime-confirmed-fixture'
  );
  resources.confirmed_sale_id := (result ->> 'sale_id')::uuid;
  update sales_core_resources set confirmed_sale_id = resources.confirmed_sale_id;
end
$$;
reset role;
do $$
declare context sales_core_context%rowtype; resources sales_core_resources%rowtype; number text;
begin
  select * into context from sales_core_context;
  select * into resources from sales_core_resources;
  perform set_config('app.canonical_sales_numbering', context.tenant_id::text, true);
  number := public.next_canonical_sale_number(context.tenant_id, current_date);
  perform set_config('app.canonical_sales_transition', resources.confirmed_sale_id::text, true);
  update public.sales set status = 'confirmed', sale_number = number,
    confirmed_by = context.owner_id, confirmed_at = now(), version = 2, updated_at = now()
  where id = resources.confirmed_sale_id;
end
$$;
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from sales_core_context;
set local role authenticated;
do $$
declare resources sales_core_resources%rowtype; rejected boolean := false;
begin
  select * into resources from sales_core_resources;
  begin
    perform public.update_sale_draft(
      resources.confirmed_sale_id, 2, resources.branch_id, resources.customer_id,
      current_date, 'EGP', 'Must fail', '[]'::jsonb,
      'sales-runtime-nondraft-update'
    );
  exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'J_NON_DRAFT_UPDATE_NOT_REJECTED'; end if;
end
$$;
reset role;

-- F. Scoped operator initially has no sales.create permission.
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_core_context;
set local role authenticated;
do $$
declare resources sales_core_resources%rowtype; rejected boolean := false;
begin
  select * into resources from sales_core_resources;
  begin
    perform public.create_sale(
      resources.branch_id, resources.customer_id, current_date,
      'EGP', null, 'sales-runtime-missing-permission'
    );
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'F_MISSING_PERMISSION_NOT_REJECTED'; end if;
end
$$;
reset role;

-- Grant create only for the remaining branch/backdate scope tests.
do $$
declare context sales_core_context%rowtype;
begin
  select * into context from sales_core_context;
  insert into public.auth_group_permissions (group_id, permission_id)
  select permission_group.id, permission.id
  from public.res_groups permission_group
  join public.auth_permissions permission on permission.code = 'sales.create'
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code like 'sales_core_runtime_%'
    and exists (
      select 1
      from public.res_users_groups membership
      join sales_core_resources resources on resources.operator_id = membership.user_id
      where membership.group_id = permission_group.id
        and membership.tenant_id = context.tenant_id
    )
  on conflict (group_id, permission_id) do nothing;
end
$$;

-- E/P. Branch scope and backdate are independently enforced.
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from sales_core_context;
set local role authenticated;
do $$
declare resources sales_core_resources%rowtype; branch_rejected boolean := false; backdate_rejected boolean := false;
begin
  select * into resources from sales_core_resources;
  begin
    perform public.create_sale(
      resources.wrong_branch_id, resources.customer_id, current_date,
      'EGP', null, 'sales-runtime-wrong-branch'
    );
  exception when insufficient_privilege then branch_rejected := true; end;
  begin
    perform public.create_sale(
      resources.branch_id, resources.customer_id, current_date - 1,
      'EGP', null, 'sales-runtime-backdate-denied'
    );
  exception when insufficient_privilege then backdate_rejected := true; end;
  if not branch_rejected then raise exception 'E_WRONG_BRANCH_NOT_REJECTED'; end if;
  if not backdate_rejected then raise exception 'P_BACKDATE_NOT_REJECTED'; end if;
end
$$;

-- S. Allowed branch is readable; another branch is hidden by the read contract.
do $$
declare resources sales_core_resources%rowtype; denied boolean := false; dto jsonb;
begin
  select * into resources from sales_core_resources;
  dto := public.get_sale(resources.main_sale_id);
  if (dto ->> 'id')::uuid <> resources.main_sale_id then
    raise exception 'S_ALLOWED_BRANCH_READ_FAILED';
  end if;
  if public.get_sale(resources.confirmed_sale_id) ->> 'status' <> 'confirmed' then
    raise exception 'S_CONFIRMED_BUSINESS_STATUS_READ_FAILED';
  end if;
  begin
    perform public.get_sale(resources.foreign_branch_sale_id);
  exception when check_violation or insufficient_privilege then denied := true; end;
  if not denied then
    raise exception 'S_WRONG_BRANCH_READ_NOT_REJECTED';
  end if;
end
$$;
reset role;

-- D/S tenant isolation: a foreign tenant member cannot address the UUID.
select set_config('request.jwt.claim.sub', foreign_auth::text, true)
from sales_core_context;
set local role authenticated;
do $$
declare resources sales_core_resources%rowtype; rejected boolean := false;
begin
  select * into resources from sales_core_resources;
  begin
    perform public.get_sale(resources.main_sale_id);
  exception when insufficient_privilege or check_violation then rejected := true; end;
  if not rejected then raise exception 'D_S_WRONG_TENANT_READ_NOT_REJECTED'; end if;
end
$$;
reset role;

-- Q. authenticated cannot bypass commands or mutate events.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from sales_core_context;
set local role authenticated;
do $$
declare resources sales_core_resources%rowtype; insert_rejected boolean := false; update_rejected boolean := false; event_rejected boolean := false;
begin
  select * into resources from sales_core_resources;
  begin
    execute 'insert into public.sales (tenant_id) values (gen_random_uuid())';
  exception when insufficient_privilege then insert_rejected := true; end;
  begin
    execute 'update public.sales set total_amount = 0 where id = $1' using resources.main_sale_id;
  exception when insufficient_privilege then update_rejected := true; end;
  begin
    execute 'update public.sale_events set payload = payload where sale_id = $1' using resources.main_sale_id;
  exception when insufficient_privilege then event_rejected := true; end;
  if not insert_rejected or not update_rejected or not event_rejected then
    raise exception 'Q_DIRECT_DML_BOUNDARY_FAILED';
  end if;
end
$$;
reset role;

-- Integration boundary: Phase 2 produced no inventory, stock or finance rows.
do $$
declare before_row sales_core_before%rowtype;
begin
  select * into before_row from sales_core_before;
  if (select count(*) from public.inventory_reservations) <> before_row.inventory_reservations
     or (select count(*) from public.stock_moves) <> before_row.stock_moves
     or (select count(*) from public.financial_sale_postings) <> before_row.financial_postings
     or (select count(*) from public.account_moves) <> before_row.account_moves then
    raise exception 'SALES_FOUNDATION_CREATED_FORBIDDEN_SIDE_EFFECT';
  end if;
end
$$;

select jsonb_build_object(
  'create_draft', 'passed',
  'create_idempotency_and_conflict', 'passed',
  'tenant_branch_permission_scope', 'passed',
  'customer_validation', 'passed',
  'draft_update_and_server_totals', 'passed',
  'non_draft_and_stale_version', 'passed',
  'readiness_empty_and_valid', 'passed',
  'backdate_permission', 'passed',
  'direct_write_boundary', 'passed',
  'events_once', 'passed',
  'integration_side_effects', 0
) as canonical_sales_core_foundation_runtime;

rollback;
