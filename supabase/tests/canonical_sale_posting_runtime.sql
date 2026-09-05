begin;

create temporary table canonical_sale_before as
select
  (select count(*) from public.account_moves where state = 'posted') as moves,
  (select count(*) from public.account_move_lines where parent_state = 'posted') as lines,
  (select count(*) from public.account_partial_reconcile) as partials,
  (select count(*) from public.financial_payments) as payments,
  (select count(*) from public.financial_payment_allocations) as allocations,
  (select coalesce(sum(debit), 0) from public.account_move_lines where parent_state = 'posted') as debit,
  (select coalesce(sum(credit), 0) from public.account_move_lines where parent_state = 'posted') as credit;

create temporary table canonical_sale_context as
select
  owner.tenant_id,
  owner.id as owner_id,
  owner.auth_user_id as owner_auth,
  other_user.id as other_user_id,
  other_user.auth_user_id as other_auth,
  foreign_partner.tenant_id as foreign_tenant_id,
  foreign_partner.id as foreign_partner_id
from public.tenant_users owner
join lateral (
  select candidate.*
  from public.tenant_users candidate
  where candidate.tenant_id = owner.tenant_id
    and candidate.is_active
    and candidate.role <> 'owner'
    and candidate.auth_user_id is not null
  order by candidate.id
  limit 1
) other_user on true
join lateral (
  select partner.tenant_id, partner.id
  from public.partners partner
  where partner.tenant_id <> owner.tenant_id
    and partner.active
    and partner.customer_rank > 0
  order by partner.tenant_id, partner.id
  limit 1
) foreign_partner on true
where owner.role = 'owner'
  and owner.is_active
  and owner.auth_user_id is not null
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
order by owner.tenant_id
limit 1;

do $$
begin
  if not exists (select 1 from canonical_sale_context) then
    raise exception 'CANONICAL_SALE_POSTING_FIXTURE_UNAVAILABLE';
  end if;
end
$$;

create temporary table canonical_sale_resources (
  branch_id uuid,
  customer_id uuid,
  receivable_account_id uuid,
  revenue_account_id uuid,
  journal_id uuid,
  posting_id uuid,
  move_id uuid,
  receivable_line_id uuid
);
grant select on canonical_sale_context to public;
grant select, update on canonical_sale_resources to public;

do $$
declare
  context canonical_sale_context%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  resources canonical_sale_resources%rowtype;
begin
  select * into context from canonical_sale_context;
  resources.receivable_account_id := public.resolve_functional_account(
    context.tenant_id, 'customer_receivable', null
  );
  resources.revenue_account_id := public.resolve_functional_account(
    context.tenant_id, 'sales_revenue', null
  );

  resources.branch_id := gen_random_uuid();
  insert into public.branches (id, tenant_id, name, code, is_active)
  values (
    resources.branch_id, context.tenant_id,
    'Canonical Sale Test Branch ' || suffix,
    'CST' || left(suffix, 6), true
  );
  insert into public.partners (
    tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values (
    context.tenant_id, resources.branch_id,
    'Canonical Sale Test Customer ' || suffix,
    'person', false, true, 1, 0, 0, true
  ) returning id into resources.customer_id;

  resources.journal_id := public.resolve_financial_journal(
    context.tenant_id, 'sale', resources.branch_id, null
  );

  insert into public.account_functional_accounts (
    tenant_id, branch_id, functional_role, account_id
  ) values
    (context.tenant_id, resources.branch_id, 'customer_receivable', resources.receivable_account_id),
    (context.tenant_id, resources.branch_id, 'sales_revenue', resources.revenue_account_id);

  insert into canonical_sale_resources values (resources.*);
end
$$;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from canonical_sale_context;
set local role authenticated;

select public.set_financial_period_lock(
  tenant_id, current_date, false,
  'Canonical Sale Posting rollback fixture: open current date'
)
from canonical_sale_context;
select public.configure_financial_posting_policy(
  tenant_id, false,
  'Canonical Sale Posting rollback fixture: reject future dates'
)
from canonical_sale_context;

do $$
declare
  context canonical_sale_context%rowtype;
  resources canonical_sale_resources%rowtype;
  result jsonb;
  replay jsonb;
  source_replay jsonb;
  move public.account_moves%rowtype;
  receivable public.account_move_lines%rowtype;
  payment_count bigint;
  allocation_count bigint;
  partial_count bigint;
begin
  select * into context from canonical_sale_context;
  select * into resources from canonical_sale_resources;
  select count(*) into payment_count from public.financial_payments;
  select count(*) into allocation_count from public.financial_payment_allocations;
  select count(*) into partial_count from public.account_partial_reconcile;

  result := public.post_financial_sale(
    context.tenant_id, 'test_sales_app', 'commercial_sale', 'sale-1001', 1,
    'canonical-sale-valid-1001', repeat('a', 64), resources.customer_id,
    12500.25, 'egp', current_date, resources.branch_id, 'TEST-1001'
  );
  resources.posting_id := (result->>'posting_id')::uuid;
  resources.move_id := (result->>'account_move_id')::uuid;
  resources.receivable_line_id := (result->>'receivable_line_id')::uuid;
  update canonical_sale_resources set
    posting_id = resources.posting_id,
    move_id = resources.move_id,
    receivable_line_id = resources.receivable_line_id;

  select * into move from public.account_moves where id = resources.move_id;
  select * into receivable from public.account_move_lines
  where id = resources.receivable_line_id;
  if move.state <> 'posted'
     or move.move_type <> 'sale'
     or move.journal_id <> resources.journal_id
     or move.amount_total <> 12500.25
     or (select count(*) from public.account_move_lines where move_id = move.id) <> 2
     or (select sum(debit) from public.account_move_lines where move_id = move.id) <> 12500.25
     or (select sum(credit) from public.account_move_lines where move_id = move.id) <> 12500.25
     or receivable.account_id <> resources.receivable_account_id
     or receivable.partner_id <> resources.customer_id
     or receivable.debit <> 12500.25
     or receivable.credit <> 0
     or receivable.amount_residual <> 12500.25
     or receivable.line_type <> 'open_item'
     or not exists (
       select 1 from public.account_move_lines line
       where line.move_id = move.id
         and line.account_id = resources.revenue_account_id
         and line.debit = 0 and line.credit = 12500.25
         and line.amount_residual = 0 and line.line_type = 'income'
     )
  then
    raise exception 'CANONICAL_UNPAID_SALE_LEDGER_RESULT_INVALID: %', jsonb_build_object(
      'move_state', move.state,
      'move_type', move.move_type,
      'move_journal', move.journal_id,
      'expected_journal', resources.journal_id,
      'amount_total', move.amount_total,
      'line_count', (select count(*) from public.account_move_lines where move_id = move.id),
      'debit_sum', (select sum(debit) from public.account_move_lines where move_id = move.id),
      'credit_sum', (select sum(credit) from public.account_move_lines where move_id = move.id),
      'receivable_account', receivable.account_id,
      'expected_receivable', resources.receivable_account_id,
      'receivable_partner', receivable.partner_id,
      'expected_partner', resources.customer_id,
      'receivable_debit', receivable.debit,
      'receivable_credit', receivable.credit,
      'receivable_residual', receivable.amount_residual,
      'receivable_line_type', receivable.line_type,
      'revenue_match', exists (
        select 1 from public.account_move_lines line
        where line.move_id = move.id
          and line.account_id = resources.revenue_account_id
          and line.debit = 0 and line.credit = 12500.25
          and line.amount_residual = 0 and line.line_type = 'income'
      )
    );
  end if;
  if result->>'current_residual' <> '12500.25'
     or result->>'accounting_state' <> 'posted'
     or (result->>'idempotent_replay')::boolean then
    raise exception 'CANONICAL_UNPAID_SALE_RESULT_INVALID: %', result;
  end if;
  if (select count(*) from public.financial_payments) <> payment_count
     or (select count(*) from public.financial_payment_allocations) <> allocation_count
     or (select count(*) from public.account_partial_reconcile) <> partial_count then
    raise exception 'SALE_POSTING_CREATED_PAYMENT_OR_ALLOCATION';
  end if;

  replay := public.post_financial_sale(
    context.tenant_id, 'test_sales_app', 'commercial_sale', 'sale-1001', 1,
    'canonical-sale-valid-1001', repeat('a', 64), resources.customer_id,
    12500.25, 'EGP', current_date, resources.branch_id, 'TEST-1001'
  );
  if not (replay->>'idempotent_replay')::boolean
     or replay->>'replay_basis' <> 'idempotency_key'
     or (replay->>'posting_id')::uuid <> resources.posting_id
     or (replay->>'account_move_id')::uuid <> resources.move_id
     or (select count(*) from public.financial_sale_postings
         where tenant_id = context.tenant_id
           and source_app = 'test_sales_app'
           and source_model = 'commercial_sale'
           and source_id = 'sale-1001'
           and event_version = 1) <> 1 then
    raise exception 'CANONICAL_SALE_SAME_KEY_REPLAY_INVALID: %', replay;
  end if;

  source_replay := public.post_financial_sale(
    context.tenant_id, 'test_sales_app', 'commercial_sale', 'sale-1001', 1,
    'canonical-sale-different-key-1001', repeat('a', 64), resources.customer_id,
    12500.25, 'EGP', current_date, resources.branch_id, 'TEST-1001'
  );
  if not (source_replay->>'idempotent_replay')::boolean
     or source_replay->>'replay_basis' <> 'source_event'
     or (source_replay->>'posting_id')::uuid <> resources.posting_id
     or (source_replay->>'account_move_id')::uuid <> resources.move_id then
    raise exception 'CANONICAL_SALE_SOURCE_EVENT_REPLAY_INVALID: %', source_replay;
  end if;

  -- Replay is readback, not a new posting: later policy changes cannot reject
  -- the immutable result, while changed payload still wins as a mismatch.
  begin
    perform public.set_financial_period_lock(
      context.tenant_id, current_date, true,
      'Canonical Sale replay-before-policy proof'
    );
    replay := public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'sale-1001', 1,
      'canonical-sale-valid-1001', repeat('a', 64), resources.customer_id,
      12500.25, 'EGP', current_date, resources.branch_id, 'TEST-1001'
    );
    if not (replay->>'idempotent_replay')::boolean
       or (replay->>'posting_id')::uuid <> resources.posting_id then
      raise exception 'REPLAY_WAS_REJECTED_BY_LATER_PERIOD_POLICY';
    end if;
    begin
      perform public.post_financial_sale(
        context.tenant_id, 'test_sales_app', 'commercial_sale', 'sale-1001', 1,
        'canonical-sale-valid-1001', repeat('a', 64), resources.customer_id,
        12500.26, 'EGP', current_date + 1, resources.branch_id, 'TEST-1001'
      );
      raise exception 'CHANGED_REPLAY_BYPASSED_FINGERPRINT';
    exception
      when unique_violation then
        if sqlerrm <> 'FINANCIAL_SALE_IDEMPOTENCY_PAYLOAD_MISMATCH' then raise; end if;
    end;
    raise exception 'ROLLBACK_REPLAY_POLICY_FIXTURE';
  exception
    when raise_exception then
      if sqlerrm <> 'ROLLBACK_REPLAY_POLICY_FIXTURE' then raise; end if;
  end;

  begin
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'sale-1001', 1,
      'canonical-sale-valid-1001', repeat('a', 64), resources.customer_id,
      12500.26, 'EGP', current_date, resources.branch_id, 'TEST-1001'
    );
    raise exception 'CHANGED_IDEMPOTENCY_PAYLOAD_ACCEPTED';
  exception
    when unique_violation then
      if sqlerrm <> 'FINANCIAL_SALE_IDEMPOTENCY_PAYLOAD_MISMATCH' then raise; end if;
  end;

  begin
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'sale-1001', 1,
      'canonical-sale-conflicting-source-key', repeat('b', 64), resources.customer_id,
      12500.25, 'EGP', current_date, resources.branch_id, 'TEST-1001'
    );
    raise exception 'CHANGED_SOURCE_EVENT_PAYLOAD_ACCEPTED';
  exception
    when unique_violation then
      if sqlerrm <> 'FINANCIAL_SALE_SOURCE_EVENT_PAYLOAD_MISMATCH' then raise; end if;
  end;
end
$$;

-- Input, customer, account, journal, and date policy failures all fail closed.
set local role postgres;
do $$
declare
  context canonical_sale_context%rowtype;
  resources canonical_sale_resources%rowtype;
  blocked boolean;
begin
  select * into context from canonical_sale_context;
  select * into resources from canonical_sale_resources;

  blocked := false;
  begin
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'invalid-zero', 1,
      'canonical-sale-invalid-zero', repeat('c', 64), resources.customer_id,
      0, 'EGP', current_date, resources.branch_id, 'INVALID-ZERO'
    );
  exception when invalid_parameter_value then blocked := sqlerrm = 'FINANCIAL_SALE_AMOUNT_INVALID'; end;
  if not blocked then raise exception 'NONPOSITIVE_SALE_AMOUNT_ACCEPTED'; end if;

  blocked := false;
  begin
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'invalid-scale', 1,
      'canonical-sale-invalid-scale', repeat('d', 64), resources.customer_id,
      1.001, 'EGP', current_date, resources.branch_id, 'INVALID-SCALE'
    );
  exception when invalid_parameter_value then blocked := sqlerrm = 'FINANCIAL_SALE_AMOUNT_INVALID'; end;
  if not blocked then raise exception 'OVERPRECISION_SALE_AMOUNT_ACCEPTED'; end if;

  blocked := false;
  begin
    update public.partners set active = false where id = resources.customer_id;
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'inactive-customer', 1,
      'canonical-sale-inactive-customer', repeat('e', 64), resources.customer_id,
      100, 'EGP', current_date, resources.branch_id, 'INACTIVE-CUSTOMER'
    );
  exception when check_violation then blocked := sqlerrm = 'FINANCIAL_SALE_CUSTOMER_INVALID_OR_INACTIVE'; end;
  if not blocked then raise exception 'INACTIVE_CUSTOMER_ACCEPTED'; end if;

  blocked := false;
  begin
    update public.account_functional_accounts set is_active = false
    where tenant_id = context.tenant_id and functional_role = 'sales_revenue';
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'missing-revenue', 1,
      'canonical-sale-missing-revenue', repeat('f', 64), resources.customer_id,
      100, 'EGP', current_date, resources.branch_id, 'MISSING-REVENUE'
    );
  exception when check_violation then blocked := sqlerrm like 'FUNCTIONAL_ACCOUNT_NOT_CONFIGURED_OR_INCOMPATIBLE:%'; end;
  if not blocked then raise exception 'MISSING_REVENUE_ACCOUNT_ACCEPTED'; end if;

  blocked := false;
  begin
    update public.account_journals set is_active = false
    where tenant_id = context.tenant_id and type = 'sale';
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'missing-journal', 1,
      'canonical-sale-missing-journal', repeat('1', 64), resources.customer_id,
      100, 'EGP', current_date, resources.branch_id, 'MISSING-JOURNAL'
    );
  exception when check_violation then blocked := sqlerrm = 'FINANCIAL_JOURNAL_NOT_CONFIGURED: sale'; end;
  if not blocked then raise exception 'MISSING_SALES_JOURNAL_ACCEPTED'; end if;

  blocked := false;
  begin
    perform public.set_financial_period_lock(
      context.tenant_id, current_date, true, 'Canonical Sale closed-period proof'
    );
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'closed-period', 1,
      'canonical-sale-closed-period', repeat('2', 64), resources.customer_id,
      100, 'EGP', current_date, resources.branch_id, 'CLOSED-PERIOD'
    );
  exception when check_violation then blocked := sqlerrm = 'FINANCIAL_PERIOD_CLOSED'; end;
  if not blocked then raise exception 'CLOSED_PERIOD_SALE_ACCEPTED'; end if;

  blocked := false;
  begin
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'future-date', 1,
      'canonical-sale-future-date', repeat('3', 64), resources.customer_id,
      100, 'EGP', current_date + 1, resources.branch_id, 'FUTURE-DATE'
    );
  exception when check_violation then blocked := sqlerrm = 'FUTURE_FINANCIAL_POSTING_DATE_NOT_ALLOWED'; end;
  if not blocked then raise exception 'DISALLOWED_FUTURE_SALE_ACCEPTED'; end if;
end
$$;
set local role authenticated;

-- A failure after move construction but before linkage must roll back the move and both lines.
set local role postgres;
create function pg_temp.reject_sale_link_for_atomicity_test()
returns trigger language plpgsql as $$
begin
  raise exception using errcode = '23514', message = 'INTENTIONAL_SALE_LINK_FAILURE';
end
$$;
create trigger zz_canonical_sale_atomicity_test
before insert on public.financial_sale_postings
for each row execute function pg_temp.reject_sale_link_for_atomicity_test();
set local role authenticated;

do $$
declare
  context canonical_sale_context%rowtype;
  resources canonical_sale_resources%rowtype;
  before_moves bigint;
  before_lines bigint;
  blocked boolean := false;
begin
  select * into context from canonical_sale_context;
  select * into resources from canonical_sale_resources;
  select count(*) into before_moves from public.account_moves;
  select count(*) into before_lines from public.account_move_lines;
  begin
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'midway-failure', 1,
      'canonical-sale-midway-failure', repeat('4', 64), resources.customer_id,
      100, 'EGP', current_date, resources.branch_id, 'MIDWAY-FAILURE'
    );
  exception when check_violation then blocked := sqlerrm = 'INTENTIONAL_SALE_LINK_FAILURE'; end;
  if not blocked
     or (select count(*) from public.account_moves) <> before_moves
     or (select count(*) from public.account_move_lines) <> before_lines
     or exists (
       select 1 from public.financial_sale_postings
       where tenant_id = context.tenant_id and source_id = 'midway-failure'
     ) then
    raise exception 'CANONICAL_SALE_FAILURE_NOT_ATOMIC';
  end if;
end
$$;

set local role postgres;
drop trigger zz_canonical_sale_atomicity_test on public.financial_sale_postings;
set local role authenticated;

-- Unauthorized, cross-tenant, direct-table, and internal-helper paths are denied.
select set_config('request.jwt.claim.sub', other_auth::text, true)
from canonical_sale_context;
do $$
declare
  context canonical_sale_context%rowtype;
  resources canonical_sale_resources%rowtype;
  blocked boolean := false;
begin
  select * into context from canonical_sale_context;
  select * into resources from canonical_sale_resources;
  begin
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'unauthorized', 1,
      'canonical-sale-unauthorized', repeat('5', 64), resources.customer_id,
      100, 'EGP', current_date, resources.branch_id, 'UNAUTHORIZED'
    );
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'UNAUTHORIZED_SALE_POSTING_ACCEPTED'; end if;

  blocked := false;
  begin
    insert into public.financial_sale_postings (
      tenant_id, source_app, source_model, source_id, event_version,
      idempotency_key, request_fingerprint, source_business_fingerprint,
      account_move_id, receivable_line_id, partner_id, amount, currency_code,
      posting_date, commercial_reference, created_by, posted_by
    ) values (
      context.tenant_id, 'forged_app', 'forged_sale', 'forged', 1,
      'forged', repeat('6', 64), repeat('6', 64), resources.move_id,
      resources.receivable_line_id, resources.customer_id, 12500.25, 'EGP',
      current_date, 'FORGED', context.other_user_id, context.other_user_id
    );
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'DIRECT_SALE_POSTING_INSERT_ACCEPTED'; end if;

  blocked := false;
  begin
    perform public.create_financial_sale_posting_move(
      gen_random_uuid(), context.tenant_id, resources.customer_id, 1, 'EGP',
      current_date, resources.branch_id, 'FORGED', resources.receivable_account_id,
      resources.revenue_account_id, resources.journal_id, context.other_user_id
    );
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'INTERNAL_SALE_MOVE_HELPER_EXECUTABLE'; end if;
end
$$;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from canonical_sale_context;
do $$
declare
  context canonical_sale_context%rowtype;
  resources canonical_sale_resources%rowtype;
  blocked boolean := false;
begin
  select * into context from canonical_sale_context;
  select * into resources from canonical_sale_resources;
  begin
    perform public.post_financial_sale(
      context.foreign_tenant_id, 'test_sales_app', 'commercial_sale', 'foreign-source', 1,
      'canonical-sale-foreign-source', repeat('7', 64), context.foreign_partner_id,
      100, 'EGP', current_date, null, 'FOREIGN-SOURCE'
    );
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'CROSS_TENANT_SOURCE_ACCEPTED'; end if;

  blocked := false;
  begin
    perform public.post_financial_sale(
      context.tenant_id, 'test_sales_app', 'commercial_sale', 'foreign-customer', 1,
      'canonical-sale-foreign-customer', repeat('8', 64), context.foreign_partner_id,
      100, 'EGP', current_date, resources.branch_id, 'FOREIGN-CUSTOMER'
    );
  exception when check_violation then blocked := sqlerrm = 'FINANCIAL_SALE_CUSTOMER_INVALID_OR_INACTIVE'; end;
  if not blocked then raise exception 'CROSS_TENANT_CUSTOMER_ACCEPTED'; end if;
end
$$;

set local role postgres;
do $$
declare
  baseline canonical_sale_before%rowtype;
  context canonical_sale_context%rowtype;
  resources canonical_sale_resources%rowtype;
begin
  select * into baseline from canonical_sale_before;
  select * into context from canonical_sale_context;
  select * into resources from canonical_sale_resources;
  if exists (
    select 1
    from public.account_moves move
    join public.account_move_lines line
      on line.move_id = move.id and line.tenant_id = move.tenant_id
    where move.state = 'posted'
    group by move.id
    having round(sum(line.debit - line.credit), 2) <> 0
  ) then
    raise exception 'UNBALANCED_POSTED_MOVE';
  end if;
  if (select count(*) from public.financial_payments) <> baseline.payments
     or (select count(*) from public.financial_payment_allocations) <> baseline.allocations
     or (select count(*) from public.account_partial_reconcile) <> baseline.partials then
    raise exception 'CANONICAL_SALE_PAYMENT_BOUNDARY_REGRESSION';
  end if;
  if (select count(*) from public.account_moves where state = 'posted') <> baseline.moves + 1
     or (select count(*) from public.account_move_lines where parent_state = 'posted') <> baseline.lines + 2 then
    raise exception 'CANONICAL_SALE_UNEXPECTED_LEDGER_CARDINALITY';
  end if;
  raise notice 'CANONICAL_SALE_POSTING_RUNTIME_PASSED posting_id=% move_id=% receivable_line_id=%',
    resources.posting_id, resources.move_id, resources.receivable_line_id;
end
$$;

rollback;
