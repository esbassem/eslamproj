-- Phase 5A canonical obligation settlement runtime matrix. All fixtures roll back.
begin;

create temporary table settlement_runtime_before as
select
  (select count(*) from public.obligation_settlement_commands) commands,
  (select count(*) from public.obligation_settlements) settlements,
  (select count(*) from public.obligation_settlement_components) components,
  (select count(*) from public.obligation_settlement_events) events,
  (select count(*) from public.financial_payments) payments,
  (select count(*) from public.financial_payment_allocations) allocations,
  (select count(*) from public.account_partial_reconcile) reconciliations;

create temporary table settlement_runtime_context as
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
    select 1 from public.account_functional_accounts item
    where item.tenant_id = owner.tenant_id
      and item.functional_role = 'customer_receivable' and item.is_active
  )
  and exists (
    select 1 from public.account_functional_accounts item
    where item.tenant_id = owner.tenant_id
      and item.functional_role = 'sales_revenue' and item.is_active
  )
order by owner.tenant_id limit 1;

do $$ begin
  if not exists (select 1 from settlement_runtime_context) then
    raise exception 'SETTLEMENT_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end $$;

create temporary table settlement_runtime_resources (
  branch_id uuid, denied_branch_id uuid, operator_id uuid,
  customer_id uuid, product_template_id uuid, product_id uuid,
  payment_method_id uuid, inactive_method_id uuid,
  destination_id uuid, denied_destination_id uuid, incompatible_destination_id uuid,
  partial_sale_id uuid, full_sale_id uuid, overpay_sale_id uuid,
  draft_sale_id uuid, noncanonical_sale_id uuid, denied_branch_sale_id uuid,
  failure_create_sale_id uuid, failure_post_sale_id uuid, failure_final_sale_id uuid
);
grant select on settlement_runtime_context to authenticated;
grant select, update on settlement_runtime_resources to authenticated;

do $$
declare
  context settlement_runtime_context%rowtype;
  resources settlement_runtime_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  receivable_account_id uuid;
  revenue_account_id uuid;
begin
  select * into context from settlement_runtime_context;
  resources.branch_id := gen_random_uuid();
  resources.denied_branch_id := gen_random_uuid();
  resources.operator_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid();
  resources.product_template_id := gen_random_uuid();
  resources.product_id := gen_random_uuid();
  resources.payment_method_id := gen_random_uuid();
  resources.inactive_method_id := gen_random_uuid();
  resources.noncanonical_sale_id := gen_random_uuid();

  receivable_account_id := public.resolve_functional_account(
    context.tenant_id, 'customer_receivable', null
  );
  revenue_account_id := public.resolve_functional_account(
    context.tenant_id, 'sales_revenue', null
  );
  insert into public.branches (id, tenant_id, name, code, is_active) values
    (resources.branch_id, context.tenant_id, 'Settlement Runtime Branch',
      'SRB' || left(suffix, 5), true),
    (resources.denied_branch_id, context.tenant_id, 'Settlement Denied Branch',
      'SRD' || left(suffix, 5), true);
  insert into public.account_functional_accounts (
    tenant_id, branch_id, functional_role, account_id
  ) values
    (context.tenant_id, resources.branch_id, 'customer_receivable', receivable_account_id),
    (context.tenant_id, resources.branch_id, 'sales_revenue', revenue_account_id),
    (context.tenant_id, resources.denied_branch_id, 'customer_receivable', receivable_account_id),
    (context.tenant_id, resources.denied_branch_id, 'sales_revenue', revenue_account_id);
  perform public.resolve_financial_journal(context.tenant_id, 'sale', resources.branch_id, null);
  perform public.resolve_financial_journal(context.tenant_id, 'sale', resources.denied_branch_id, null);

  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values (
    resources.customer_id, context.tenant_id, resources.branch_id,
    'Settlement Runtime Customer', 'person', false, true, 1, 0, 0, true
  );
  insert into public.product_templates (
    id, tenant_id, name, internal_reference, product_type, tracking,
    can_be_sold, is_active, sale_price
  ) values (
    resources.product_template_id, context.tenant_id,
    'Settlement Runtime Service', 'SRS-' || suffix,
    'service', 'none', true, true, 50000
  );
  insert into public.product_products (
    id, tenant_id, product_template_id, display_name, sku,
    tracking, is_active, sale_price
  ) values (
    resources.product_id, context.tenant_id, resources.product_template_id,
    'Settlement Runtime Service', 'SRS-' || suffix, 'none', true, 50000
  );
  update public.product_templates
  set default_product_product_id = resources.product_id
  where id = resources.product_template_id;

  insert into public.tenant_users (
    id, tenant_id, auth_user_id, full_name, role, is_active
  ) values (
    resources.operator_id, context.tenant_id, context.operator_auth,
    'Settlement Runtime Operator', 'staff', true
  );
  insert into public.res_groups (
    tenant_id, name, code, category, is_system, active
  ) values (
    context.tenant_id, 'Settlement Runtime View',
    'settlement_runtime_' || suffix, 'settlement', false, true
  );
  insert into public.auth_group_permissions (group_id, permission_id)
  select permission_group.id, permission.id
  from public.res_groups permission_group
  join public.auth_permissions permission
    on permission.code in ('settlement.view', 'sales.access', 'sales.view')
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code = 'settlement_runtime_' || suffix;
  insert into public.res_users_groups (tenant_id, user_id, group_id)
  select context.tenant_id, resources.operator_id, permission_group.id
  from public.res_groups permission_group
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code = 'settlement_runtime_' || suffix;
  insert into public.user_branch_access (tenant_id, user_id, branch_id)
  values (context.tenant_id, resources.operator_id, resources.branch_id);

  insert into public.financial_payment_methods (
    id, tenant_id, name, semantic_key, method_type, settlement_mode,
    is_active, requires_reference, requires_confirmation, created_by
  ) values
    (resources.payment_method_id, context.tenant_id, 'Settlement Runtime Cash',
      'settlement_cash_' || suffix, 'cash', 'direct', true, false, false, context.owner_id),
    (resources.inactive_method_id, context.tenant_id, 'Settlement Inactive Cash',
      'settlement_inactive_' || suffix, 'cash', 'direct', false, false, false, context.owner_id);
  insert into settlement_runtime_resources values (resources.*);
end
$$;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from settlement_runtime_context;
set local role authenticated;
do $$
declare
  context settlement_runtime_context%rowtype;
  resources settlement_runtime_resources%rowtype;
  provisioned jsonb;
begin
  select * into context from settlement_runtime_context;
  select * into resources from settlement_runtime_resources;
  provisioned := public.create_and_provision_money_destination(
    context.tenant_id, 'settlement_cashbox_' || left(replace(resources.branch_id::text, '-', ''), 8),
    'Settlement Allowed Cashbox', 'cashbox', resources.branch_id,
    null, null, null, null, null, '{}'::jsonb, true
  );
  resources.destination_id := (provisioned ->> 'destination_id')::uuid;
  provisioned := public.create_and_provision_money_destination(
    context.tenant_id, 'settlement_denied_' || left(replace(resources.branch_id::text, '-', ''), 8),
    'Settlement Denied Cashbox', 'cashbox', resources.branch_id,
    null, null, null, null, null, '{}'::jsonb, true
  );
  resources.denied_destination_id := (provisioned ->> 'destination_id')::uuid;
  provisioned := public.create_and_provision_money_destination(
    context.tenant_id, 'settlement_bank_' || left(replace(resources.branch_id::text, '-', ''), 8),
    'Settlement Incompatible Bank', 'bank', resources.branch_id,
    null, null, 'Runtime Bank', 'Runtime Account', '0000', '{}'::jsonb, true
  );
  resources.incompatible_destination_id := (provisioned ->> 'destination_id')::uuid;
  update settlement_runtime_resources set
    destination_id = resources.destination_id,
    denied_destination_id = resources.denied_destination_id,
    incompatible_destination_id = resources.incompatible_destination_id;
end
$$;
reset role;

do $$
declare resources settlement_runtime_resources%rowtype;
begin
  select * into resources from settlement_runtime_resources;
  insert into public.user_financial_account_access (
    tenant_id, user_id, account_id, branch_id, access_type
  )
  select context.tenant_id, resources.operator_id, destination.ledger_account_id,
    resources.branch_id, 'initiate'
  from settlement_runtime_context context
  join public.money_destinations destination
    on destination.id in (resources.destination_id, resources.incompatible_destination_id)
  on conflict do nothing;
end
$$;

create function pg_temp.make_settlement_sale(
  p_key text, p_amount numeric, p_branch_id uuid, p_confirm boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  resources settlement_runtime_resources%rowtype;
  created jsonb;
  sale_id uuid;
begin
  select * into resources from settlement_runtime_resources;
  created := public.create_sale(
    p_branch_id, resources.customer_id, current_date, 'EGP', p_key, p_key || ':create'
  );
  sale_id := (created ->> 'sale_id')::uuid;
  perform public.update_sale_draft(
    sale_id, 1, p_branch_id, resources.customer_id, current_date, 'EGP', p_key,
    jsonb_build_array(jsonb_build_object(
      'product_id', resources.product_id, 'quantity', 1, 'unit_price', p_amount
    )), p_key || ':update'
  );
  if p_confirm then
    perform public.confirm_sale(sale_id, 2, '[]'::jsonb, p_key || ':confirm');
  end if;
  return sale_id;
end
$$;

create function pg_temp.settlement_payment_count(p_sale_id uuid)
returns bigint language sql stable security definer
set search_path = pg_catalog, public as $$
  select count(*) from public.financial_payments payment
  where payment.source_app = 'settlement' and payment.source_model = 'sale'
    and payment.source_id = p_sale_id::text
$$;
create function pg_temp.settlement_allocation_count(p_sale_id uuid)
returns bigint language sql stable security definer
set search_path = pg_catalog, public as $$
  select count(*)
  from public.financial_payment_allocations allocation
  join public.financial_payments payment on payment.id = allocation.payment_id
  where payment.source_app = 'settlement' and payment.source_model = 'sale'
    and payment.source_id = p_sale_id::text
$$;
create function pg_temp.settlement_move_count(p_sale_id uuid)
returns bigint language sql stable security definer
set search_path = pg_catalog, public as $$
  select count(*)
  from public.financial_payment_accounting_links link
  join public.financial_payments payment on payment.id = link.payment_id
  where payment.source_app = 'settlement' and payment.source_model = 'sale'
    and payment.source_id = p_sale_id::text
$$;
create function pg_temp.settlement_command_exists(p_key text)
returns boolean language sql stable security definer
set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.obligation_settlement_commands command
    where command.idempotency_key = p_key
  )
$$;
create function pg_temp.sale_receivable_residual(p_sale_id uuid)
returns numeric language sql stable security definer
set search_path = pg_catalog, public as $$
  select line.amount_residual
  from public.sale_confirmation_links confirmation
  join public.financial_sale_postings posting
    on posting.id = confirmation.financial_sale_posting_id
  join public.account_move_lines line on line.id = posting.receivable_line_id
  where confirmation.sale_id = p_sale_id
$$;
create function pg_temp.settlement_payment_id(p_sale_id uuid)
returns uuid language sql stable security definer
set search_path = pg_catalog, public as $$
  select payment.id from public.financial_payments payment
  where payment.source_app='settlement' and payment.source_model='sale'
    and payment.source_id=p_sale_id::text
  order by payment.created_at limit 1
$$;
create function pg_temp.sale_receivable_line_id(p_sale_id uuid)
returns uuid language sql stable security definer
set search_path = pg_catalog, public as $$
  select posting.receivable_line_id
  from public.sale_confirmation_links confirmation
  join public.financial_sale_postings posting
    on posting.id=confirmation.financial_sale_posting_id
  where confirmation.sale_id=p_sale_id
$$;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from settlement_runtime_context;
do $$
declare resources settlement_runtime_resources%rowtype;
begin
  select * into resources from settlement_runtime_resources;
  resources.partial_sale_id := pg_temp.make_settlement_sale(
    'settlement-partial', 50000, resources.branch_id
  );
  resources.full_sale_id := pg_temp.make_settlement_sale(
    'settlement-full', 50000, resources.branch_id
  );
  resources.overpay_sale_id := pg_temp.make_settlement_sale(
    'settlement-overpay', 10000, resources.branch_id
  );
  resources.draft_sale_id := pg_temp.make_settlement_sale(
    'settlement-draft', 10000, resources.branch_id, false
  );
  set local session_replication_role = replica;
  insert into public.sales (
    id, tenant_id, branch_id, customer_id, sale_number,
    effective_sale_date, currency_code, status, total_amount,
    notes, version, create_idempotency_key, create_request_fingerprint,
    created_by, confirmed_by, confirmed_at
  ) select
    resources.noncanonical_sale_id, context.tenant_id, resources.branch_id,
    resources.customer_id,
    'SAL-2099-' || lpad((floor(random() * 999999999))::bigint::text, 9, '0'),
    current_date, 'EGP', 'confirmed', 10000,
    'settlement-noncanonical', 3, 'settlement-noncanonical:' || resources.noncanonical_sale_id,
    repeat('a', 64), context.owner_id, context.owner_id, now()
  from settlement_runtime_context context;
  set local session_replication_role = origin;
  resources.denied_branch_sale_id := pg_temp.make_settlement_sale(
    'settlement-denied-branch', 10000, resources.denied_branch_id
  );
  resources.failure_create_sale_id := pg_temp.make_settlement_sale(
    'settlement-fail-create', 10000, resources.branch_id
  );
  resources.failure_post_sale_id := pg_temp.make_settlement_sale(
    'settlement-fail-post', 10000, resources.branch_id
  );
  resources.failure_final_sale_id := pg_temp.make_settlement_sale(
    'settlement-fail-final', 10000, resources.branch_id
  );
  update settlement_runtime_resources set
    partial_sale_id = resources.partial_sale_id,
    full_sale_id = resources.full_sale_id,
    overpay_sale_id = resources.overpay_sale_id,
    draft_sale_id = resources.draft_sale_id,
    noncanonical_sale_id = resources.noncanonical_sale_id,
    denied_branch_sale_id = resources.denied_branch_sale_id,
    failure_create_sale_id = resources.failure_create_sale_id,
    failure_post_sale_id = resources.failure_post_sale_id,
    failure_final_sale_id = resources.failure_final_sale_id;
end
$$;

-- View-only permission returns target data but cannot collect.
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from settlement_runtime_context;
set local role authenticated;
do $$
declare resources settlement_runtime_resources%rowtype; options jsonb; rejected boolean := false;
begin
  select * into resources from settlement_runtime_resources;
  options := public.get_settlement_options('sale', resources.partial_sale_id::text);
  if options ->> 'can_settle' <> 'false'
     or options -> 'reason_codes' <> jsonb_build_array('SETTLEMENT_COLLECT_PERMISSION_REQUIRED') then
    raise exception 'SETTLEMENT_VIEW_ONLY_OPTIONS_FAILED: %', options;
  end if;
  begin
    perform public.settle_obligation(
      'sale', resources.partial_sale_id::text, 'money_payment', 1,
      resources.payment_method_id, 'missing-permission', resources.destination_id
    );
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'SETTLEMENT_MISSING_PERMISSION_NOT_REJECTED'; end if;
end
$$;
reset role;

do $$
begin
  insert into public.auth_group_permissions (group_id, permission_id)
  select permission_group.id, permission.id
  from public.res_groups permission_group
  join public.auth_permissions permission on permission.code = 'settlement.collect'
  join settlement_runtime_context context on context.tenant_id = permission_group.tenant_id
  where permission_group.code like 'settlement_runtime_%';
end
$$;

-- Options are business-safe and server-filtered to the operator resource scope.
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from settlement_runtime_context;
set local role authenticated;
do $$
declare resources settlement_runtime_resources%rowtype; options jsonb; serialized text;
begin
  select * into resources from settlement_runtime_resources;
  options := public.get_settlement_options('sale', resources.partial_sale_id::text);
  serialized := options::text;
  if options ->> 'can_settle' <> 'true'
     or (options ->> 'outstanding_amount')::numeric <> 50000
     or serialized not like '%' || resources.destination_id::text || '%'
     or serialized like '%' || resources.denied_destination_id::text || '%'
     or serialized like '%account_id%'
     or serialized like '%journal_id%'
     or serialized like '%move_id%'
     or serialized like '%reconciliation%' then
    raise exception 'SETTLEMENT_OPTIONS_CONTRACT_FAILED: %', options;
  end if;
end
$$;

-- A settlement-only user cannot call Financial primitives or write ledger/facts directly.
do $$
declare
  resources settlement_runtime_resources%rowtype;
  context settlement_runtime_context%rowtype;
  rejected integer := 0;
begin
  select * into resources from settlement_runtime_resources;
  select * into context from settlement_runtime_context;
  begin
    perform public.create_financial_payment(
      context.tenant_id, 'inbound', 1, resources.payment_method_id,
      'settlement-direct-financial-denied', resources.destination_id,
      'EGP', resources.customer_id, resources.branch_id
    );
  exception when insufficient_privilege then rejected := rejected + 1; end;
  begin
    insert into public.account_moves (
      tenant_id, journal_id, name, move_type, invoice_date, date,
      amount_total, state, currency_code, created_by
    ) values (
      context.tenant_id, gen_random_uuid(), 'ILLEGAL', 'journal', current_date,
      now(), 1, 'draft', 'EGP', resources.operator_id
    );
  exception when insufficient_privilege then rejected := rejected + 1; end;
  begin
    insert into public.obligation_settlements (
      tenant_id, command_id, target_type, target_id, business_reference,
      party_id, branch_id, currency_code, amount,
      outstanding_before, outstanding_after, created_by
    ) values (
      context.tenant_id, gen_random_uuid(), 'sale', resources.partial_sale_id::text,
      'ILLEGAL', resources.customer_id, resources.branch_id, 'EGP', 1, 1, 0,
      resources.operator_id
    );
  exception when insufficient_privilege then rejected := rejected + 1; end;
  if rejected <> 3 then raise exception 'SETTLEMENT_DIRECT_BOUNDARY_FAILED: %', rejected; end if;
end
$$;

-- 50k -> collect 20k -> 30k, retry-safe, then collect the remaining 30k -> zero.
do $$
declare
  resources settlement_runtime_resources%rowtype;
  first_result jsonb;
  retry_result jsonb;
  second_result jsonb;
  target_line uuid;
  payment_count integer;
  allocation_count integer;
  move_count integer;
  details jsonb;
  mismatch boolean := false;
begin
  select * into resources from settlement_runtime_resources;
  first_result := public.settle_obligation(
    'sale', resources.partial_sale_id::text, 'money_payment', 20000,
    resources.payment_method_id, 'partial-20k', resources.destination_id,
    'REF-20K', 'Phase 5A partial collection'
  );
  if (first_result ->> 'outstanding_before')::numeric <> 50000
     or (first_result ->> 'outstanding_after')::numeric <> 30000
     or first_result ->> 'idempotent_replay' <> 'false' then
    raise exception 'SETTLEMENT_PARTIAL_RESULT_FAILED: %', first_result;
  end if;
  retry_result := public.settle_obligation(
    'sale', resources.partial_sale_id::text, 'money_payment', 20000,
    resources.payment_method_id, 'partial-20k', resources.destination_id,
    'REF-20K', 'Phase 5A partial collection'
  );
  if retry_result ->> 'idempotent_replay' <> 'true'
     or retry_result ->> 'settlement_id' <> first_result ->> 'settlement_id' then
    raise exception 'SETTLEMENT_RETRY_FAILED: %', retry_result;
  end if;
  begin
    perform public.settle_obligation(
      'sale', resources.partial_sale_id::text, 'money_payment', 19999,
      resources.payment_method_id, 'partial-20k', resources.destination_id,
      'REF-20K', 'Phase 5A partial collection'
    );
  exception when unique_violation then mismatch := true; end;
  if not mismatch then raise exception 'SETTLEMENT_PAYLOAD_MISMATCH_NOT_REJECTED'; end if;

  select posting.receivable_line_id into target_line
  from public.sale_confirmation_links confirmation
  join public.financial_sale_postings posting
    on posting.id = confirmation.financial_sale_posting_id
  where confirmation.sale_id = resources.partial_sale_id;
  if pg_temp.sale_receivable_residual(resources.partial_sale_id) <> 30000 then
    raise exception 'SETTLEMENT_PARTIAL_RESIDUAL_FAILED';
  end if;
  details := public.get_sale_details(resources.partial_sale_id);
  if details -> 'payment' ->> 'status' <> 'partially_paid'
     or (details -> 'payment' ->> 'settled_amount')::numeric <> 20000
     or (details -> 'payment' ->> 'outstanding_amount')::numeric <> 30000 then
    raise exception 'SALE_DETAILS_PARTIAL_PAYMENT_INVALID: %', details;
  end if;
  payment_count := pg_temp.settlement_payment_count(resources.partial_sale_id);
  allocation_count := pg_temp.settlement_allocation_count(resources.partial_sale_id);
  move_count := pg_temp.settlement_move_count(resources.partial_sale_id);
  if payment_count <> 1 or allocation_count <> 1 or move_count <> 1 then
    raise exception 'SETTLEMENT_PARTIAL_DUPLICATES: %/%/%', payment_count, allocation_count, move_count;
  end if;

  second_result := public.settle_obligation(
    'sale', resources.partial_sale_id::text, 'money_payment', 30000,
    resources.payment_method_id, 'partial-remaining', resources.destination_id
  );
  if (second_result ->> 'outstanding_after')::numeric <> 0
     or pg_temp.sale_receivable_residual(resources.partial_sale_id) <> 0 then
    raise exception 'SETTLEMENT_FULL_RESIDUAL_FAILED: %', second_result;
  end if;
  details := public.get_sale_details(resources.partial_sale_id);
  if details -> 'payment' ->> 'status' <> 'paid'
     or (details -> 'payment' ->> 'settled_amount')::numeric <> 50000
     or (details -> 'payment' ->> 'outstanding_amount')::numeric <> 0 then
    raise exception 'SALE_DETAILS_PAID_INVALID: %', details;
  end if;
  if public.get_settlement_options('sale', resources.partial_sale_id::text)
       -> 'reason_codes' <> jsonb_build_array('OBLIGATION_ALREADY_SETTLED') then
    raise exception 'SETTLEMENT_PAID_OPTIONS_FAILED';
  end if;
end
$$;

-- Even after a real settlement exists, the caller cannot allocate it directly.
do $$
declare resources settlement_runtime_resources%rowtype; rejected boolean := false;
begin
  select * into resources from settlement_runtime_resources;
  begin
    perform public.allocate_financial_payment(
      (select tenant_id from settlement_runtime_context),
      pg_temp.settlement_payment_id(resources.partial_sale_id),
      pg_temp.sale_receivable_line_id(resources.partial_sale_id),
      1, 'direct-allocation-denied'
    );
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'SETTLEMENT_DIRECT_ALLOCATION_NOT_DENIED'; end if;
end
$$;

-- Full collection, overpayment, invalid method/destination, draft and invalid target.
do $$
declare resources settlement_runtime_resources%rowtype; rejected integer := 0; draft_options jsonb;
begin
  select * into resources from settlement_runtime_resources;
  perform public.settle_obligation(
    'sale', resources.full_sale_id::text, 'money_payment', 50000,
    resources.payment_method_id, 'full-50k', resources.destination_id
  );
  begin
    perform public.settle_obligation(
      'sale', resources.overpay_sale_id::text, 'money_payment', 10001,
      resources.payment_method_id, 'overpay', resources.destination_id
    );
  exception when check_violation then rejected := rejected + 1; end;
  begin
    perform public.settle_obligation(
      'sale', resources.overpay_sale_id::text, 'money_payment', 1,
      resources.inactive_method_id, 'inactive-method', resources.destination_id
    );
  exception when check_violation then rejected := rejected + 1; end;
  begin
    perform public.settle_obligation(
      'sale', resources.overpay_sale_id::text, 'money_payment', 1,
      resources.payment_method_id, 'denied-destination', resources.denied_destination_id
    );
  exception when insufficient_privilege then rejected := rejected + 1; end;
  begin
    perform public.settle_obligation(
      'sale', resources.overpay_sale_id::text, 'money_payment', 1,
      resources.payment_method_id, 'incompatible-destination', resources.incompatible_destination_id
    );
  exception when insufficient_privilege then rejected := rejected + 1; end;
  draft_options := public.get_settlement_options('sale', resources.draft_sale_id::text);
  if draft_options -> 'reason_codes' <> jsonb_build_array('TARGET_NOT_CONFIRMED') then
    raise exception 'SETTLEMENT_DRAFT_OPTIONS_FAILED: %', draft_options;
  end if;
  begin
    perform public.settle_obligation(
      'sale', resources.draft_sale_id::text, 'money_payment', 1,
      resources.payment_method_id, 'draft-denied', resources.destination_id
    );
  exception when check_violation then rejected := rejected + 1; end;
  begin
    perform public.settle_obligation(
      'sale', gen_random_uuid()::text, 'money_payment', 1,
      resources.payment_method_id, 'invalid-target', resources.destination_id
    );
  exception when no_data_found then rejected := rejected + 1; end;
  begin
    perform public.settle_obligation(
      'sale', resources.noncanonical_sale_id::text, 'money_payment', 1,
      resources.payment_method_id, 'noncanonical-target', resources.destination_id
    );
  exception when check_violation then rejected := rejected + 1; end;
  if rejected <> 7 then raise exception 'SETTLEMENT_REJECTION_MATRIX_FAILED: %', rejected; end if;
end
$$;

-- Branch and tenant isolation.
do $$
declare resources settlement_runtime_resources%rowtype; rejected boolean := false;
begin
  select * into resources from settlement_runtime_resources;
  begin
    perform public.get_settlement_options('sale', resources.denied_branch_sale_id::text);
  exception when no_data_found then rejected := true; end;
  if not rejected then raise exception 'SETTLEMENT_BRANCH_SCOPE_NOT_ENFORCED'; end if;
  rejected := false;
  begin
    perform public.settle_obligation(
      'sale', resources.denied_branch_sale_id::text, 'money_payment', 1,
      resources.payment_method_id, 'wrong-branch-command', resources.destination_id
    );
  exception when insufficient_privilege then rejected := true; end;
  if not rejected then raise exception 'SETTLEMENT_COMMAND_BRANCH_SCOPE_NOT_ENFORCED'; end if;
end
$$;
reset role;
select set_config('request.jwt.claim.sub', foreign_auth::text, true)
from settlement_runtime_context;
set local role authenticated;
do $$
declare resources settlement_runtime_resources%rowtype; rejected boolean := false;
begin
  select * into resources from settlement_runtime_resources;
  begin
    perform public.get_settlement_options('sale', resources.partial_sale_id::text);
  exception when insufficient_privilege or no_data_found then rejected := true; end;
  if not rejected then raise exception 'SETTLEMENT_TENANT_SCOPE_NOT_ENFORCED'; end if;
  rejected := false;
  begin
    perform public.get_sale_details(resources.partial_sale_id);
  exception when check_violation or insufficient_privilege or no_data_found then rejected := true; end;
  if not rejected then raise exception 'SALE_DETAILS_TENANT_SCOPE_NOT_ENFORCED'; end if;
end
$$;
reset role;

-- Failure after payment creation/before posting: the whole command rolls back.
create function pg_temp.fail_settlement_after_payment_create()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.event_type = 'submitted' and exists (
    select 1 from public.financial_payments payment
    where payment.id = new.payment_id and payment.source_app = 'settlement'
      and payment.source_id = (select failure_create_sale_id::text from settlement_runtime_resources)
  ) then raise exception 'INJECT_AFTER_PAYMENT_CREATE'; end if;
  return new;
end $$;
create trigger zz_settlement_fail_after_payment_create
before insert on public.financial_payment_events
for each row execute function pg_temp.fail_settlement_after_payment_create();

select set_config('request.jwt.claim.sub', operator_auth::text, true)
from settlement_runtime_context;
set local role authenticated;
do $$
declare resources settlement_runtime_resources%rowtype; rejected boolean := false;
begin
  select * into resources from settlement_runtime_resources;
  begin
    perform public.settle_obligation(
      'sale', resources.failure_create_sale_id::text, 'money_payment', 1000,
      resources.payment_method_id, 'fail-after-create', resources.destination_id
    );
  exception when others then rejected := sqlerrm = 'INJECT_AFTER_PAYMENT_CREATE'; end;
  if not rejected
     or pg_temp.settlement_payment_count(resources.failure_create_sale_id) <> 0
     or pg_temp.settlement_command_exists('fail-after-create') then
    raise exception 'SETTLEMENT_CREATE_FAILURE_LEAKED';
  end if;
end
$$;
reset role;
drop trigger zz_settlement_fail_after_payment_create on public.financial_payment_events;

-- Failure after posting/before allocation: payment, move and command all roll back.
create function pg_temp.fail_settlement_before_allocation()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if exists (
    select 1 from public.financial_payments payment
    where payment.id = new.payment_id and payment.source_app = 'settlement'
      and payment.source_id = (select failure_post_sale_id::text from settlement_runtime_resources)
  ) then raise exception 'INJECT_AFTER_POSTING'; end if;
  return new;
end $$;
create trigger zz_settlement_fail_before_allocation
before insert on public.financial_payment_allocations
for each row execute function pg_temp.fail_settlement_before_allocation();

select set_config('request.jwt.claim.sub', operator_auth::text, true)
from settlement_runtime_context;
set local role authenticated;
do $$
declare resources settlement_runtime_resources%rowtype; rejected boolean := false;
begin
  select * into resources from settlement_runtime_resources;
  begin
    perform public.settle_obligation(
      'sale', resources.failure_post_sale_id::text, 'money_payment', 1000,
      resources.payment_method_id, 'fail-after-post', resources.destination_id
    );
  exception when others then rejected := sqlerrm = 'INJECT_AFTER_POSTING'; end;
  if not rejected
     or pg_temp.settlement_payment_count(resources.failure_post_sale_id) <> 0
     or pg_temp.settlement_command_exists('fail-after-post') then
    raise exception 'SETTLEMENT_POST_FAILURE_LEAKED';
  end if;
end
$$;
reset role;
drop trigger zz_settlement_fail_before_allocation on public.financial_payment_allocations;

-- Failure after allocation/before command completion: every financial artifact rolls back.
create function pg_temp.fail_settlement_before_completion()
returns trigger language plpgsql set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.payload -> 'target' ->> 'id' =
      (select failure_final_sale_id::text from settlement_runtime_resources) then
    raise exception 'INJECT_AFTER_ALLOCATION';
  end if;
  return new;
end $$;
create trigger zz_settlement_fail_before_completion
before insert on public.obligation_settlement_events
for each row execute function pg_temp.fail_settlement_before_completion();

select set_config('request.jwt.claim.sub', operator_auth::text, true)
from settlement_runtime_context;
set local role authenticated;
do $$
declare resources settlement_runtime_resources%rowtype; rejected boolean := false; line_id uuid;
begin
  select * into resources from settlement_runtime_resources;
  select posting.receivable_line_id into line_id
  from public.sale_confirmation_links confirmation
  join public.financial_sale_postings posting on posting.id = confirmation.financial_sale_posting_id
  where confirmation.sale_id = resources.failure_final_sale_id;
  begin
    perform public.settle_obligation(
      'sale', resources.failure_final_sale_id::text, 'money_payment', 1000,
      resources.payment_method_id, 'fail-after-allocation', resources.destination_id
    );
  exception when others then rejected := sqlerrm = 'INJECT_AFTER_ALLOCATION'; end;
  if not rejected
     or pg_temp.sale_receivable_residual(resources.failure_final_sale_id) <> 10000
     or pg_temp.settlement_payment_count(resources.failure_final_sale_id) <> 0
     or pg_temp.settlement_command_exists('fail-after-allocation') then
    raise exception 'SETTLEMENT_FINAL_FAILURE_LEAKED';
  end if;
end
$$;
reset role;
drop trigger zz_settlement_fail_before_completion on public.obligation_settlement_events;

select jsonb_build_object(
  'canonical_sale_50k_partial_full', 'passed',
  'options_business_safe_scope_filtered', 'passed',
  'permission_tenant_branch_boundaries', 'passed',
  'invalid_method_destination_target_overpay', 'passed',
  'idempotency_and_duplicate_proof', 'passed',
  'direct_dml_and_financial_primitive_denial', 'passed',
  'failure_after_create_rollback', 'passed',
  'failure_after_post_rollback', 'passed',
  'failure_after_allocation_rollback', 'passed'
) as canonical_settlement_runtime;

rollback;
