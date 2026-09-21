-- Phase 2E.2 rollback-safe runtime contract. All fixtures and payments roll back.
begin;

create temporary table phase2e2_before as
select
  (select count(*) from public.financial_payments) payments,
  (select count(*) from public.financial_payment_accounting_links) payment_links,
  (select count(*) from public.financial_payment_allocations) allocations,
  (select count(*) from public.account_moves) moves,
  (select count(*) from public.account_move_lines) lines,
  (select count(*) from public.account_partial_reconcile) partials;

create temporary table phase2e2_context as
select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth,
  unassigned.id operator_auth, foreign_member.auth_user_id foreign_auth,
  marker.canonical_generation
from public.showroom_financial_cutovers marker
join public.tenant_users owner
  on owner.tenant_id = marker.tenant_id
 and owner.role = 'owner' and owner.is_active
 and owner.auth_user_id is not null
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
  where member.tenant_id <> marker.tenant_id
    and member.is_active and member.auth_user_id is not null
    and not exists (
      select 1 from public.tenant_users target_member
      where target_member.tenant_id = marker.tenant_id
        and target_member.auth_user_id = member.auth_user_id
        and target_member.is_active
    )
  order by member.tenant_id, member.id
  limit 1
) foreign_member on true
where marker.source_app = 'showroom' and marker.source_model = 'sale'
  and exists (
    select 1 from public.account_functional_accounts item
    where item.tenant_id = marker.tenant_id
      and item.functional_role = 'customer_receivable' and item.is_active
  )
  and exists (
    select 1 from public.account_functional_accounts item
    where item.tenant_id = marker.tenant_id
      and item.functional_role = 'sales_revenue' and item.is_active
  )
order by owner.tenant_id
limit 1;

do $$
begin
  if not exists (select 1 from phase2e2_context) then
    raise exception 'PHASE2E2_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end
$$;

create temporary table phase2e2_resources (
  branch_id uuid, forbidden_branch_id uuid, operator_id uuid,
  showroom_config_id uuid, forbidden_config_id uuid,
  customer_id uuid, payment_method_id uuid, destination_id uuid,
  partial_sale_id uuid, full_sale_id uuid, overpay_sale_id uuid,
  wrong_branch_sale_id uuid, posting_failure_sale_id uuid,
  allocation_failure_sale_id uuid, noncanonical_sale_id uuid
);
grant select on phase2e2_context to authenticated;
grant select, update on phase2e2_resources to authenticated;

do $$
declare
  context phase2e2_context%rowtype;
  resources phase2e2_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
begin
  select * into context from phase2e2_context;
  resources.branch_id := gen_random_uuid();
  resources.forbidden_branch_id := gen_random_uuid();
  resources.operator_id := gen_random_uuid();
  resources.showroom_config_id := gen_random_uuid();
  resources.forbidden_config_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid();
  resources.payment_method_id := gen_random_uuid();
  resources.partial_sale_id := gen_random_uuid();
  resources.full_sale_id := gen_random_uuid();
  resources.overpay_sale_id := gen_random_uuid();
  resources.wrong_branch_sale_id := gen_random_uuid();
  resources.posting_failure_sale_id := gen_random_uuid();
  resources.allocation_failure_sale_id := gen_random_uuid();
  resources.noncanonical_sale_id := gen_random_uuid();

  insert into public.branches (id, tenant_id, name, code, is_active) values
    (resources.branch_id, context.tenant_id, 'Phase 2E.2 Branch',
      'P2E' || left(suffix, 5), true),
    (resources.forbidden_branch_id, context.tenant_id,
      'Phase 2E.2 Forbidden Branch', 'P2F' || left(suffix, 5), true);
  insert into public.showroom_configs (id, tenant_id, branch_id, name, code) values
    (resources.showroom_config_id, context.tenant_id, resources.branch_id,
      'Phase 2E.2 Showroom', 'P2E-' || left(suffix, 6)),
    (resources.forbidden_config_id, context.tenant_id, resources.forbidden_branch_id,
      'Phase 2E.2 Forbidden Showroom', 'P2F-' || left(suffix, 6));
  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values (
    resources.customer_id, context.tenant_id, resources.branch_id,
    'Phase 2E.2 Customer', 'person', false, true, 1, 0, 0, true
  );
  insert into public.tenant_users (
    id, tenant_id, auth_user_id, full_name, role, is_active
  ) values (
    resources.operator_id, context.tenant_id, context.operator_auth,
    'Phase 2E.2 Showroom Operator', 'sales', true
  );
  insert into public.res_groups (
    tenant_id, name, code, category, is_system, active
  ) values (
    context.tenant_id, 'Phase 2E.2 Showroom Access',
    'phase2e2_showroom_' || suffix, 'showroom', false, true
  );
  insert into public.auth_group_permissions (group_id, permission_id)
  select permission_group.id, permission.id
  from public.res_groups permission_group
  join public.auth_permissions permission
    on permission.code = 'showroom_point.access'
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code = 'phase2e2_showroom_' || suffix;
  insert into public.res_users_groups (tenant_id, user_id, group_id)
  select context.tenant_id, resources.operator_id, permission_group.id
  from public.res_groups permission_group
  where permission_group.tenant_id = context.tenant_id
    and permission_group.code = 'phase2e2_showroom_' || suffix;
  insert into public.user_branch_access (tenant_id, user_id, branch_id)
  values (context.tenant_id, resources.operator_id, resources.branch_id);

  insert into public.financial_payment_methods (
    id, tenant_id, name, semantic_key, method_type, settlement_mode,
    is_active, requires_reference, requires_confirmation, created_by
  ) values (
    resources.payment_method_id, context.tenant_id,
    'Phase 2E.2 Cash', 'phase2e2_cash_' || suffix, 'cash', 'direct',
    true, false, false, context.owner_id
  );
  insert into phase2e2_resources values (resources.*);
end
$$;

-- The owner provisions a real Canonical Money Destination; no fixture account
-- or journal identifier is ever accepted by the Showroom payment command.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from phase2e2_context;
set local role authenticated;
do $$
declare
  context phase2e2_context%rowtype;
  resources phase2e2_resources%rowtype;
  result jsonb;
begin
  select * into context from phase2e2_context;
  select * into resources from phase2e2_resources;
  result := public.create_and_provision_money_destination(
    context.tenant_id, 'phase2e2_cashbox_' ||
      left(replace(resources.branch_id::text, '-', ''), 8),
    'Phase 2E.2 Cashbox', 'cashbox', resources.branch_id,
    null, null, null, null, null, '{}'::jsonb, true
  );
  resources.destination_id := (result ->> 'destination_id')::uuid;
  update phase2e2_resources set destination_id = resources.destination_id;
end
$$;
reset role;

-- Build confirmed Canonical sale fixtures through the Canonical posting contract,
-- then bind each resulting posting to its Showroom sale.
create function pg_temp.make_phase2e2_canonical_sale(
  p_sale_id uuid, p_branch_id uuid, p_config_id uuid, p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  context phase2e2_context%rowtype;
  resources phase2e2_resources%rowtype;
  result jsonb;
begin
  select * into context from phase2e2_context;
  select * into resources from phase2e2_resources;
  insert into public.showroom_sales (
    id, tenant_id, branch_id, customer_id, sale_date, status,
    total_amount, showroom_config_id, created_by, notes
  ) values (
    p_sale_id, context.tenant_id, p_branch_id, resources.customer_id,
    current_date, 'pending_payment', p_amount, p_config_id,
    context.owner_id, 'Phase 2E.2 Canonical payment fixture'
  );
  result := public.post_financial_sale(
    context.tenant_id, 'showroom', 'sale', p_sale_id::text, 1,
    'phase2e2-sale-' || p_sale_id::text, repeat('e', 64),
    resources.customer_id, p_amount, 'EGP', current_date,
    p_branch_id, 'P2E2-' || left(replace(p_sale_id::text, '-', ''), 12)
  );
  update public.showroom_sales
  set status = 'confirmed', account_move_id = (result ->> 'account_move_id')::uuid
  where id = p_sale_id and tenant_id = context.tenant_id;
end
$$;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from phase2e2_context;
do $$
declare resources phase2e2_resources%rowtype;
begin
  select * into resources from phase2e2_resources;
  perform pg_temp.make_phase2e2_canonical_sale(resources.partial_sale_id,
    resources.branch_id, resources.showroom_config_id, 50000);
  perform pg_temp.make_phase2e2_canonical_sale(resources.full_sale_id,
    resources.branch_id, resources.showroom_config_id, 50000);
  perform pg_temp.make_phase2e2_canonical_sale(resources.overpay_sale_id,
    resources.branch_id, resources.showroom_config_id, 50000);
  perform pg_temp.make_phase2e2_canonical_sale(resources.wrong_branch_sale_id,
    resources.forbidden_branch_id, resources.forbidden_config_id, 50000);
  perform pg_temp.make_phase2e2_canonical_sale(resources.posting_failure_sale_id,
    resources.branch_id, resources.showroom_config_id, 50000);
  perform pg_temp.make_phase2e2_canonical_sale(resources.allocation_failure_sale_id,
    resources.branch_id, resources.showroom_config_id, 50000);
  insert into public.showroom_sales (
    id, tenant_id, branch_id, customer_id, sale_date, status,
    total_amount, showroom_config_id, created_by, notes
  ) select resources.noncanonical_sale_id, context.tenant_id,
    resources.branch_id, resources.customer_id, current_date, 'confirmed',
    50000, resources.showroom_config_id, context.owner_id,
    'Phase 2E.2 non-Canonical fixture'
  from phase2e2_context context;
end
$$;

-- A caller from another tenant cannot address a sale by guessing its id.
select set_config('request.jwt.claim.sub', foreign_auth::text, true)
from phase2e2_context;
set local role authenticated;
do $$
declare resources phase2e2_resources%rowtype;
begin
  select * into resources from phase2e2_resources;
  begin
    perform public.collect_showroom_sale_payment(
      resources.partial_sale_id, 1, resources.payment_method_id,
      'tenant-denied', resources.destination_id, null, null
    );
    raise exception 'PHASE2E2_WRONG_TENANT_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
end
$$;

-- The operator has Showroom access only: no generic accounting action grant.
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from phase2e2_context;
do $$
declare
  context phase2e2_context%rowtype;
  permission_code text;
begin
  select * into context from phase2e2_context;
  if not public.has_permission('showroom_point.access', context.tenant_id) then
    raise exception 'PHASE2E2_SHOWROOM_PERMISSION_MISSING';
  end if;
  foreach permission_code in array array[
    'financial.payment.create', 'financial.payment.submit',
    'financial.payment.confirm', 'financial.payment.post',
    'financial.payment.allocate'
  ] loop
    if public.has_permission(permission_code, context.tenant_id) then
      raise exception 'PHASE2E2_OPERATOR_HAS_GENERIC_PERMISSION: %', permission_code;
    end if;
  end loop;
end
$$;

-- Partial payment: 50,000 -> 20,000 -> residual 30,000.
create temporary table phase2e2_partial_result as
select public.collect_showroom_sale_payment(
  resources.partial_sale_id, 20000, resources.payment_method_id,
  'partial-20000', resources.destination_id, null, 'Partial collection'
) result
from phase2e2_resources resources;
reset role;

do $$
declare
  context phase2e2_context%rowtype;
  resources phase2e2_resources%rowtype;
  result jsonb := (select item.result from phase2e2_partial_result item);
  posting public.financial_sale_postings%rowtype;
  v_payment_id uuid := (result ->> 'payment_id')::uuid;
begin
  select * into context from phase2e2_context;
  select * into resources from phase2e2_resources;
  select canonical.* into posting
  from public.financial_sale_postings canonical
  where canonical.tenant_id = context.tenant_id
    and canonical.source_app = 'showroom' and canonical.source_model = 'sale'
    and canonical.source_id = resources.partial_sale_id::text;
  if (result ->> 'remaining_amount')::numeric <> 30000
     or result ->> 'payment_status' <> 'confirmed'
     or result ->> 'accounting_state' <> 'posted'
     or (select amount_residual from public.account_move_lines
         where id = posting.receivable_line_id) <> 30000
     or (select count(*) from public.financial_payments where id = v_payment_id) <> 1
     or (select count(*) from public.financial_payment_accounting_links link
         where link.payment_id = v_payment_id) <> 1
     or (select count(*) from public.financial_payment_allocations allocation
         where allocation.payment_id = v_payment_id
           and allocation.status = 'active' and allocation.amount = 20000
           and allocation.target_account_line_id = posting.receivable_line_id) <> 1
     or (select count(*) from public.account_partial_reconcile partial
         join public.financial_payment_allocations allocation
           on allocation.partial_reconcile_id = partial.id
         where allocation.payment_id = v_payment_id) <> 1
  then
    raise exception 'PHASE2E2_PARTIAL_PAYMENT_INVALID: %', jsonb_build_object(
      'result', result,
      'target_residual', (select amount_residual from public.account_move_lines
        where id = posting.receivable_line_id),
      'payments', (select count(*) from public.financial_payments
        where id = v_payment_id),
      'links', (select count(*) from public.financial_payment_accounting_links link
        where link.payment_id = v_payment_id),
      'allocations', (select count(*) from public.financial_payment_allocations allocation
        where allocation.payment_id = v_payment_id
          and allocation.status = 'active' and allocation.amount = 20000
          and allocation.target_account_line_id = posting.receivable_line_id),
      'partials', (select count(*) from public.account_partial_reconcile partial
        join public.financial_payment_allocations allocation
          on allocation.partial_reconcile_id = partial.id
        where allocation.payment_id = v_payment_id)
    );
  end if;
end
$$;

-- Exact retry returns the same payment/allocation and creates no duplicate.
set local role authenticated;
create temporary table phase2e2_retry_result as
select public.collect_showroom_sale_payment(
  resources.partial_sale_id, 20000, resources.payment_method_id,
  'partial-20000', resources.destination_id, null, 'Partial collection'
) result
from phase2e2_resources resources;
reset role;

do $$
declare
  first_result jsonb := (select result from phase2e2_partial_result);
  retry_result jsonb := (select result from phase2e2_retry_result);
begin
  if not (retry_result ->> 'idempotent_replay')::boolean
     or retry_result ->> 'payment_id' <> first_result ->> 'payment_id'
     or retry_result ->> 'allocation_id' <> first_result ->> 'allocation_id'
     or (select count(*) from public.financial_payments
         where id = (first_result ->> 'payment_id')::uuid) <> 1
     or (select count(*) from public.financial_payment_allocations
         where payment_id = (first_result ->> 'payment_id')::uuid) <> 1
     or (select count(*) from public.financial_payment_accounting_links
         where payment_id = (first_result ->> 'payment_id')::uuid) <> 1
     or (select count(*) from public.account_moves
         where ref = 'financial_payment:' || (first_result ->> 'payment_id')) <> 1
     or (select count(*) from public.account_partial_reconcile partial
         join public.financial_payment_allocations allocation
           on allocation.partial_reconcile_id = partial.id
         where allocation.payment_id = (first_result ->> 'payment_id')::uuid) <> 1
  then
    raise exception 'PHASE2E2_RETRY_NOT_IDEMPOTENT: %', retry_result;
  end if;
end
$$;

-- Full settlement produces zero target residual.
set local role authenticated;
create temporary table phase2e2_full_result as
select public.collect_showroom_sale_payment(
  resources.full_sale_id, 50000, resources.payment_method_id,
  'full-50000', resources.destination_id, null, 'Full collection'
) result
from phase2e2_resources resources;
reset role;

do $$
begin
  if ((select result from phase2e2_full_result) ->> 'remaining_amount')::numeric <> 0 then
    raise exception 'PHASE2E2_FULL_PAYMENT_RESIDUAL_INVALID';
  end if;
end
$$;

-- Overpayment, wrong branch, invalid method/destination and a generation-1
-- sale all fail before any payment row is retained.
set local role authenticated;
do $$
declare
  resources phase2e2_resources%rowtype;
  blocked boolean;
begin
  select * into resources from phase2e2_resources;
  blocked := false;
  begin
    perform public.collect_showroom_sale_payment(resources.overpay_sale_id, 50000.01,
      resources.payment_method_id, 'overpay', resources.destination_id, null, null);
  exception when check_violation then blocked := sqlerrm = 'SHOWROOM_PAYMENT_EXCEEDS_SALE_RESIDUAL'; end;
  if not blocked then raise exception 'PHASE2E2_OVERPAYMENT_ACCEPTED'; end if;

  blocked := false;
  begin
    perform public.collect_showroom_sale_payment(resources.wrong_branch_sale_id, 1,
      resources.payment_method_id, 'wrong-branch', resources.destination_id, null, null);
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'PHASE2E2_WRONG_BRANCH_ACCEPTED'; end if;

  blocked := false;
  begin
    perform public.collect_showroom_sale_payment(resources.overpay_sale_id, 1,
      gen_random_uuid(), 'invalid-method', resources.destination_id, null, null);
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'PHASE2E2_INVALID_METHOD_ACCEPTED'; end if;

  blocked := false;
  begin
    perform public.collect_showroom_sale_payment(resources.overpay_sale_id, 1,
      resources.payment_method_id, 'invalid-destination', gen_random_uuid(), null, null);
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'PHASE2E2_INVALID_DESTINATION_ACCEPTED'; end if;

  blocked := false;
  begin
    perform public.collect_showroom_sale_payment(resources.noncanonical_sale_id, 1,
      resources.payment_method_id, 'noncanonical', resources.destination_id, null, null);
  exception when check_violation then blocked := sqlerrm = 'SHOWROOM_SALE_NOT_CANONICAL_GENERATION'; end;
  if not blocked then raise exception 'PHASE2E2_NONCANONICAL_SALE_ACCEPTED'; end if;
end
$$;
reset role;

-- Forced posting and allocation failures prove the entire RPC rolls back.
create function pg_temp.fail_phase2e2_posting()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.financial_payments payment
    join phase2e2_resources resources
      on payment.source_id = resources.posting_failure_sale_id::text
    where payment.id = new.payment_id
  ) then
    raise exception 'PHASE2E2_FORCED_POSTING_FAILURE';
  end if;
  return new;
end
$$;
create trigger phase2e2_force_posting_failure
before insert on public.financial_payment_accounting_links
for each row execute function pg_temp.fail_phase2e2_posting();

create function pg_temp.fail_phase2e2_allocation()
returns trigger language plpgsql as $$
begin
  if exists (
    select 1 from public.financial_payments payment
    join phase2e2_resources resources
      on payment.source_id = resources.allocation_failure_sale_id::text
    where payment.id = new.payment_id
  ) then
    raise exception 'PHASE2E2_FORCED_ALLOCATION_FAILURE';
  end if;
  return new;
end
$$;
create trigger phase2e2_force_allocation_failure
before insert on public.financial_payment_allocations
for each row execute function pg_temp.fail_phase2e2_allocation();

create temporary table phase2e2_failure_before as
select
  (select count(*) from public.financial_payments) payments,
  (select count(*) from public.financial_payment_accounting_links) payment_links,
  (select count(*) from public.financial_payment_allocations) allocations,
  (select count(*) from public.account_moves) moves,
  (select count(*) from public.account_move_lines) lines,
  (select count(*) from public.account_partial_reconcile) partials;

set local role authenticated;
do $$
declare resources phase2e2_resources%rowtype;
begin
  select * into resources from phase2e2_resources;
  begin
    perform public.collect_showroom_sale_payment(resources.posting_failure_sale_id, 1000,
      resources.payment_method_id, 'posting-failure', resources.destination_id, null, null);
    raise exception 'PHASE2E2_POSTING_FAILURE_ACCEPTED';
  exception when others then
    if sqlerrm = 'PHASE2E2_POSTING_FAILURE_ACCEPTED'
       or position('PHASE2E2_FORCED_POSTING_FAILURE' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.collect_showroom_sale_payment(resources.allocation_failure_sale_id, 1000,
      resources.payment_method_id, 'allocation-failure', resources.destination_id, null, null);
    raise exception 'PHASE2E2_ALLOCATION_FAILURE_ACCEPTED';
  exception when others then
    if sqlerrm = 'PHASE2E2_ALLOCATION_FAILURE_ACCEPTED'
       or position('PHASE2E2_FORCED_ALLOCATION_FAILURE' in sqlerrm) = 0 then raise; end if;
  end;
end
$$;

reset role;
do $$
declare
  resources phase2e2_resources%rowtype;
begin
  select * into resources from phase2e2_resources;
  if exists (
    select 1 from public.financial_payments payment
    where payment.source_app = 'showroom' and payment.source_model = 'sale'
      and payment.source_id in (
        resources.posting_failure_sale_id::text,
        resources.allocation_failure_sale_id::text
      )
  ) or exists (
    select 1 from public.account_moves move
    where move.ref like 'financial_payment:%'
      and exists (
        select 1 from public.financial_payments payment
        where payment.id::text = split_part(move.ref, ':', 2)
          and payment.source_id in (
            resources.posting_failure_sale_id::text,
            resources.allocation_failure_sale_id::text
          )
      )
  ) then
    raise exception 'PHASE2E2_FAILURE_LEFT_PAYMENT_OR_MOVE';
  end if;
  if exists (
    select 1 from public.financial_payment_allocations allocation
    join public.financial_payments payment on payment.id = allocation.payment_id
    where payment.source_id in (
      resources.posting_failure_sale_id::text,
      resources.allocation_failure_sale_id::text
    )
  ) then
    raise exception 'PHASE2E2_FAILURE_LEFT_ALLOCATION_OR_RECONCILIATION';
  end if;
  if (select count(*) from public.financial_payments)
       <> (select payments from phase2e2_failure_before)
     or (select count(*) from public.financial_payment_accounting_links)
       <> (select payment_links from phase2e2_failure_before)
     or (select count(*) from public.financial_payment_allocations)
       <> (select allocations from phase2e2_failure_before)
     or (select count(*) from public.account_moves)
       <> (select moves from phase2e2_failure_before)
     or (select count(*) from public.account_move_lines)
       <> (select lines from phase2e2_failure_before)
     or (select count(*) from public.account_partial_reconcile)
       <> (select partials from phase2e2_failure_before)
  then
    raise exception 'PHASE2E2_FAILURE_TRANSACTION_NOT_ATOMIC';
  end if;
end
$$;

set local role authenticated;
do $$
begin
  begin
    perform public.is_trusted_showroom_payment_context(
      null, 'financial.payment.create', null, null, null
    );
    raise exception 'PHASE2E2_INTERNAL_CAPABILITY_EXPOSED';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

do $$
declare
  partial_result jsonb := (select result from phase2e2_partial_result);
  full_result jsonb := (select result from phase2e2_full_result);
begin
  if partial_result ->> 'payment_id' = full_result ->> 'payment_id'
     or (select count(*) from public.financial_payments
         where id in ((partial_result ->> 'payment_id')::uuid,
                      (full_result ->> 'payment_id')::uuid)) <> 2
     or (select count(*) from public.financial_payment_allocations
         where payment_id in ((partial_result ->> 'payment_id')::uuid,
                              (full_result ->> 'payment_id')::uuid)) <> 2
  then
    raise exception 'PHASE2E2_SUCCESS_CARDINALITY_INVALID';
  end if;
  raise notice 'PHASE2E2_RUNTIME_OK partial_residual=30000 full_residual=0 retry=true rollback=true';
end
$$;

rollback;
