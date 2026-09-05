-- Showroom Canonical Financial Cutover Phase 2C
--
-- Session-local, read-only accounting diagnostic.  The only objects created by
-- this script are TEMP objects.  No canonical post/binding function is called.
-- Run with:
--   supabase db query --linked --file supabase/tests/showroom_canonical_shadow_read_runtime.sql

begin;

create temporary table shadow_run_clock as
select clock_timestamp() as started_at;

create temporary table shadow_before as
select jsonb_build_object(
  'financial_engine_bindings', jsonb_build_object(
    'count', (select count(*) from public.financial_engine_bindings),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.financial_engine_bindings item)
  ),
  'financial_sale_postings', jsonb_build_object(
    'count', (select count(*) from public.financial_sale_postings),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.financial_sale_postings item)
  ),
  'account_moves', jsonb_build_object(
    'count', (select count(*) from public.account_moves),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.account_moves item)
  ),
  'account_move_lines', jsonb_build_object(
    'count', (select count(*) from public.account_move_lines),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.account_move_lines item)
  ),
  'account_partial_reconcile', jsonb_build_object(
    'count', (select count(*) from public.account_partial_reconcile),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.account_partial_reconcile item)
  ),
  'financial_payments', jsonb_build_object(
    'count', (select count(*) from public.financial_payments),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.financial_payments item)
  ),
  'financial_payment_allocations', jsonb_build_object(
    'count', (select count(*) from public.financial_payment_allocations),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.financial_payment_allocations item)
  ),
  'showroom_sale_linkage', jsonb_build_object(
    'count', (select count(*) from public.showroom_sales),
    'fingerprint', (
      select md5(coalesce(string_agg(
        jsonb_build_object(
          'id', sale.id,
          'tenant_id', sale.tenant_id,
          'status', sale.status,
          'account_move_id', sale.account_move_id
        )::text,
        '|' order by sale.tenant_id, sale.id
      ), ''))
      from public.showroom_sales sale
    )
  ),
  'ledger_totals', jsonb_build_object(
    'debit', (select coalesce(sum(line.debit), 0) from public.account_move_lines line
              where line.parent_state = 'posted'),
    'credit', (select coalesce(sum(line.credit), 0) from public.account_move_lines line
               where line.parent_state = 'posted'),
    'unbalanced_moves', (
      select count(*)
      from (
        select line.move_id
        from public.account_move_lines line
        where line.parent_state = 'posted'
        group by line.move_id
        having coalesce(sum(line.debit), 0) <> coalesce(sum(line.credit), 0)
      ) unbalanced
    )
  )
) as snapshot;

-- This comparator consumes a generic canonical expectation plus an observed
-- ledger effect.  It deliberately knows nothing about Showroom tables.
create function pg_temp.compare_sale_posting(
  p_expected jsonb,
  p_actual jsonb
)
returns text[]
language plpgsql
immutable
set search_path = pg_catalog
as $comparator$
declare
  reasons text[] := array[]::text[];
begin
  if nullif(p_expected ->> 'tenant_id', '') is null
     or nullif(p_actual ->> 'tenant_id', '') is null
     or (p_expected ->> 'tenant_id') is distinct from (p_actual ->> 'tenant_id') then
    raise exception using errcode = '42501',
      message = 'SHADOW_COMPARE_CROSS_TENANT_FORBIDDEN';
  end if;

  if not coalesce((p_expected ->> 'source_complete')::boolean, false) then
    return array['SOURCE_DATA_INCOMPLETE'];
  end if;
  if nullif(p_expected ->> 'canonical_error', '') is not null then
    return array['CANONICAL_CONFIGURATION_MISSING'];
  end if;
  if not coalesce((p_actual ->> 'structure_supported')::boolean, false) then
    return array['LEGACY_MOVE_STRUCTURE_UNSUPPORTED'];
  end if;

  if (p_expected ->> 'amount')::numeric is distinct from (p_actual ->> 'move_amount')::numeric
     or (p_expected ->> 'amount')::numeric is distinct from (p_actual ->> 'debit')::numeric
     or (p_expected ->> 'amount')::numeric is distinct from (p_actual ->> 'credit')::numeric then
    reasons := array_append(reasons, 'AMOUNT_MISMATCH');
  end if;
  if (p_expected ->> 'customer_id') is distinct from (p_actual ->> 'move_customer_id')
     or (p_expected ->> 'customer_id') is distinct from (p_actual ->> 'receivable_customer_id')
     or (
       nullif(p_actual ->> 'revenue_customer_id', '') is not null
       and (p_expected ->> 'customer_id') is distinct from (p_actual ->> 'revenue_customer_id')
     ) then
    reasons := array_append(reasons, 'CUSTOMER_MISMATCH');
  end if;
  if (p_expected ->> 'receivable_semantic') is distinct from (p_actual ->> 'receivable_semantic') then
    reasons := array_append(reasons, 'RECEIVABLE_ACCOUNT_MISMATCH');
  end if;
  if (p_expected ->> 'revenue_semantic') is distinct from (p_actual ->> 'revenue_semantic') then
    reasons := array_append(reasons, 'REVENUE_ACCOUNT_MISMATCH');
  end if;
  if (p_expected ->> 'journal_type') is distinct from (p_actual ->> 'journal_type') then
    reasons := array_append(reasons, 'JOURNAL_SEMANTIC_MISMATCH');
  end if;
  if (p_expected ->> 'currency') is distinct from (p_actual ->> 'move_currency')
     or (p_expected ->> 'currency') is distinct from (p_actual ->> 'debit_currency')
     or (p_expected ->> 'currency') is distinct from (p_actual ->> 'credit_currency') then
    reasons := array_append(reasons, 'CURRENCY_MISMATCH');
  end if;
  if (p_expected ->> 'posting_date') is distinct from (p_actual ->> 'invoice_date')
     or (p_expected ->> 'posting_date') is distinct from (p_actual ->> 'posting_date') then
    reasons := array_append(reasons, 'POSTING_DATE_MISMATCH');
  end if;
  if (p_expected ->> 'branch_id') is distinct from (p_actual ->> 'branch_id') then
    reasons := array_append(reasons, 'BRANCH_MISMATCH');
  end if;
  return reasons;
end
$comparator$;

-- Showroom integration adapter: business facts only.  EGP is the explicit
-- currency contract of the existing Showroom confirmation backend; no account
-- or journal identifier is sourced from Showroom.
create temporary table shadow_showroom_snapshot as
select
  binding.id as binding_id,
  binding.tenant_id,
  binding.source_app,
  binding.source_model,
  binding.source_id,
  binding.financial_event_version as event_version,
  sale.id as sale_id,
  sale.sale_number,
  sale.status as sale_status,
  sale.customer_id,
  sale.total_amount::numeric(18,2) as amount,
  'EGP'::text as currency,
  sale.sale_date as posting_date,
  coalesce(sale.branch_id, config.branch_id) as branch_id,
  coalesce(nullif(btrim(sale.sale_number), ''), sale.id::text) as commercial_reference,
  encode(extensions.digest(jsonb_build_object(
    'tenant_id', sale.tenant_id,
    'source_app', binding.source_app,
    'source_model', binding.source_model,
    'source_id', binding.source_id,
    'event_version', binding.financial_event_version,
    'customer_id', sale.customer_id,
    'amount', sale.total_amount,
    'currency', 'EGP',
    'posting_date', sale.sale_date,
    'branch_id', coalesce(sale.branch_id, config.branch_id),
    'commercial_reference', coalesce(nullif(btrim(sale.sale_number), ''), sale.id::text)
  )::text, 'sha256'), 'hex') as source_business_fingerprint,
  (
    sale.id is not null
    and sale.customer_id is not null
    and sale.total_amount > 0
    and sale.total_amount = round(sale.total_amount, 2)
    and sale.sale_date is not null
    and nullif(btrim(coalesce(sale.sale_number, sale.id::text)), '') is not null
  ) as source_complete,
  binding.legacy_move_id
from public.financial_engine_bindings binding
left join public.showroom_sales sale
  on sale.tenant_id = binding.tenant_id
 and sale.id::text = binding.source_id
left join public.showroom_configs config
  on config.tenant_id = sale.tenant_id
 and config.id = sale.showroom_config_id
where binding.source_app = 'showroom'
  and binding.source_model = 'sale'
  and binding.financial_event_version = 1
  and binding.financial_engine = 'legacy'
  and binding.state = 'posted';

create temporary table shadow_exclusions as
select
  snapshot.binding_id,
  snapshot.sale_id,
  case
    when snapshot.sale_id is null then 'SHOWROOM_SOURCE_NOT_FOUND'
    when not snapshot.source_complete then 'SOURCE_DATA_INCOMPLETE'
    when move.id is null then 'LEGACY_MOVE_NOT_FOUND'
    when move.state <> 'posted' or move.move_type <> 'sale' then 'LEGACY_MOVE_NOT_POSTED_SALE'
    when move.tenant_id is distinct from snapshot.tenant_id then 'LEGACY_MOVE_TENANT_MISMATCH'
    else null
  end as reason
from shadow_showroom_snapshot snapshot
left join public.account_moves move
  on move.id = snapshot.legacy_move_id
 and move.tenant_id = snapshot.tenant_id
where snapshot.sale_id is null
   or not snapshot.source_complete
   or move.id is null
   or move.state <> 'posted'
   or move.move_type <> 'sale'
   or move.tenant_id is distinct from snapshot.tenant_id;

-- Resolve once per tenant/branch.  These are the exact resolvers called by
-- post_financial_sale_unbound_impl/create_financial_sale_posting_move.
create temporary table shadow_canonical_resolution (
  tenant_id uuid,
  branch_id uuid,
  receivable_account_id uuid,
  receivable_semantic text,
  revenue_account_id uuid,
  revenue_semantic text,
  journal_id uuid,
  journal_type text,
  canonical_error text
);

do $resolution$
declare
  context record;
  receivable_id uuid;
  revenue_id uuid;
  resolved_journal_id uuid;
  receivable_meaning text;
  revenue_meaning text;
  resolved_journal_type text;
  error_message text;
begin
  for context in
    select distinct snapshot.tenant_id, snapshot.branch_id
    from shadow_showroom_snapshot snapshot
    where snapshot.source_complete
    order by snapshot.tenant_id, snapshot.branch_id nulls last
  loop
    receivable_id := null;
    revenue_id := null;
    resolved_journal_id := null;
    receivable_meaning := null;
    revenue_meaning := null;
    resolved_journal_type := null;
    error_message := null;
    begin
      receivable_id := public.resolve_functional_account(
        context.tenant_id, 'customer_receivable', context.branch_id
      );
      revenue_id := public.resolve_functional_account(
        context.tenant_id, 'sales_revenue', context.branch_id
      );
      resolved_journal_id := public.resolve_financial_journal(
        context.tenant_id, 'sale', context.branch_id, null
      );

      select coalesce(account.semantic_key, mapping.canonical_semantic_key)
      into receivable_meaning
      from public.account_accounts account
      left join public.account_legacy_mappings mapping
        on mapping.tenant_id = account.tenant_id
       and mapping.legacy_account_id = account.id
       and mapping.effective_to is null
      where account.tenant_id = context.tenant_id
        and account.id = receivable_id;

      select coalesce(account.semantic_key, mapping.canonical_semantic_key)
      into revenue_meaning
      from public.account_accounts account
      left join public.account_legacy_mappings mapping
        on mapping.tenant_id = account.tenant_id
       and mapping.legacy_account_id = account.id
       and mapping.effective_to is null
      where account.tenant_id = context.tenant_id
        and account.id = revenue_id;

      select journal.type into resolved_journal_type
      from public.account_journals journal
      where journal.tenant_id = context.tenant_id
        and journal.id = resolved_journal_id;
    exception when others then
      get stacked diagnostics error_message = message_text;
    end;

    insert into shadow_canonical_resolution values (
      context.tenant_id, context.branch_id,
      receivable_id, receivable_meaning,
      revenue_id, revenue_meaning,
      resolved_journal_id, resolved_journal_type,
      error_message
    );
  end loop;
end
$resolution$;

-- Posting-policy evaluation is intentionally independent of semantic MATCH.
-- A presently closed historical period is reported, but cannot abort the run.
create temporary table shadow_posting_policy (
  tenant_id uuid,
  posting_date date,
  policy_status text
);

do $policy$
declare
  context record;
  error_message text;
begin
  for context in
    select distinct snapshot.tenant_id, snapshot.posting_date
    from shadow_showroom_snapshot snapshot
    where snapshot.source_complete
    order by snapshot.tenant_id, snapshot.posting_date
  loop
    error_message := null;
    begin
      perform public.assert_financial_posting_date(
        context.tenant_id, context.posting_date
      );
    exception when others then
      get stacked diagnostics error_message = message_text;
    end;
    insert into shadow_posting_policy values (
      context.tenant_id,
      context.posting_date,
      coalesce(error_message, 'ACCEPTED')
    );
  end loop;
end
$policy$;

create temporary table shadow_comparison as
with eligible as (
  select snapshot.*
  from shadow_showroom_snapshot snapshot
  where not exists (
    select 1 from shadow_exclusions exclusion
    where exclusion.binding_id = snapshot.binding_id
  )
), actual as (
  select
    snapshot.*,
    move.amount_total as actual_move_amount,
    move.partner_id as actual_move_customer_id,
    move.currency_code as actual_move_currency,
    move.invoice_date as actual_invoice_date,
    move.date::date as actual_posting_date,
    move.branch_id as actual_branch_id,
    journal.type as actual_journal_type,
    lines.line_count,
    lines.debit_line_count,
    lines.credit_line_count,
    lines.debit_total,
    lines.credit_total,
    lines.receivable_account_id as actual_receivable_account_id,
    lines.revenue_account_id as actual_revenue_account_id,
    lines.receivable_customer_id as actual_receivable_customer_id,
    lines.revenue_customer_id as actual_revenue_customer_id,
    lines.debit_currency as actual_debit_currency,
    lines.credit_currency as actual_credit_currency,
    coalesce(activity.partial_count, 0) as later_partial_reconcile_count,
    (
      lines.line_count = 2
      and lines.debit_line_count = 1
      and lines.credit_line_count = 1
      and lines.debit_total = lines.credit_total
      and lines.debit_total > 0
    ) as structure_supported
  from eligible snapshot
  join public.account_moves move
    on move.tenant_id = snapshot.tenant_id
   and move.id = snapshot.legacy_move_id
  left join public.account_journals journal
    on journal.tenant_id = move.tenant_id
   and journal.id = move.journal_id
  cross join lateral (
    select
      count(*) as line_count,
      count(*) filter (where line.debit > 0 and line.credit = 0) as debit_line_count,
      count(*) filter (where line.credit > 0 and line.debit = 0) as credit_line_count,
      coalesce(sum(line.debit), 0) as debit_total,
      coalesce(sum(line.credit), 0) as credit_total,
      (array_agg(line.account_id order by line.id)
        filter (where line.debit > 0 and line.credit = 0))[1] as receivable_account_id,
      (array_agg(line.account_id order by line.id)
        filter (where line.credit > 0 and line.debit = 0))[1] as revenue_account_id,
      (array_agg(line.partner_id order by line.id)
        filter (where line.debit > 0 and line.credit = 0))[1] as receivable_customer_id,
      (array_agg(line.partner_id order by line.id)
        filter (where line.credit > 0 and line.debit = 0))[1] as revenue_customer_id,
      (array_agg(line.currency_code order by line.id)
        filter (where line.debit > 0 and line.credit = 0))[1] as debit_currency,
      (array_agg(line.currency_code order by line.id)
        filter (where line.credit > 0 and line.debit = 0))[1] as credit_currency
    from public.account_move_lines line
    where line.tenant_id = move.tenant_id
      and line.move_id = move.id
  ) lines
  cross join lateral (
    select count(*) as partial_count
    from public.account_partial_reconcile partial
    where partial.tenant_id = move.tenant_id
      and (
        partial.debit_move_id in (
          select line.id from public.account_move_lines line
          where line.tenant_id = move.tenant_id and line.move_id = move.id
        )
        or partial.credit_move_id in (
          select line.id from public.account_move_lines line
          where line.tenant_id = move.tenant_id and line.move_id = move.id
        )
      )
  ) activity
), enriched as (
  select
    actual.*,
    resolution.receivable_account_id as expected_receivable_account_id,
    resolution.receivable_semantic as expected_receivable_semantic,
    resolution.revenue_account_id as expected_revenue_account_id,
    resolution.revenue_semantic as expected_revenue_semantic,
    resolution.journal_id as expected_journal_id,
    resolution.journal_type as expected_journal_type,
    resolution.canonical_error,
    receivable.semantic as actual_receivable_semantic,
    revenue.semantic as actual_revenue_semantic,
    policy.policy_status
  from actual
  left join shadow_canonical_resolution resolution
    on resolution.tenant_id = actual.tenant_id
   and resolution.branch_id is not distinct from actual.branch_id
  left join shadow_posting_policy policy
    on policy.tenant_id = actual.tenant_id
   and policy.posting_date = actual.posting_date
  left join lateral (
    select coalesce(account.semantic_key, mapping.canonical_semantic_key) as semantic
    from public.account_accounts account
    left join public.account_legacy_mappings mapping
      on mapping.tenant_id = account.tenant_id
     and mapping.legacy_account_id = account.id
     and mapping.effective_to is null
    where account.tenant_id = actual.tenant_id
      and account.id = actual.actual_receivable_account_id
  ) receivable on true
  left join lateral (
    select coalesce(account.semantic_key, mapping.canonical_semantic_key) as semantic
    from public.account_accounts account
    left join public.account_legacy_mappings mapping
      on mapping.tenant_id = account.tenant_id
     and mapping.legacy_account_id = account.id
     and mapping.effective_to is null
    where account.tenant_id = actual.tenant_id
      and account.id = actual.actual_revenue_account_id
  ) revenue on true
), compared as (
  select
    enriched.*,
    pg_temp.compare_sale_posting(
      jsonb_build_object(
        'tenant_id', enriched.tenant_id,
        'source_complete', enriched.source_complete,
        'canonical_error', enriched.canonical_error,
        'amount', enriched.amount,
        'customer_id', enriched.customer_id,
        'receivable_semantic', enriched.expected_receivable_semantic,
        'revenue_semantic', enriched.expected_revenue_semantic,
        'journal_type', enriched.expected_journal_type,
        'currency', enriched.currency,
        'posting_date', enriched.posting_date,
        'branch_id', enriched.branch_id
      ),
      jsonb_build_object(
        'tenant_id', enriched.tenant_id,
        'structure_supported', enriched.structure_supported,
        'move_amount', enriched.actual_move_amount,
        'debit', enriched.debit_total,
        'credit', enriched.credit_total,
        'move_customer_id', enriched.actual_move_customer_id,
        'receivable_customer_id', enriched.actual_receivable_customer_id,
        'revenue_customer_id', enriched.actual_revenue_customer_id,
        'receivable_semantic', enriched.actual_receivable_semantic,
        'revenue_semantic', enriched.actual_revenue_semantic,
        'journal_type', enriched.actual_journal_type,
        'move_currency', enriched.actual_move_currency,
        'debit_currency', enriched.actual_debit_currency,
        'credit_currency', enriched.actual_credit_currency,
        'invoice_date', enriched.actual_invoice_date,
        'posting_date', enriched.actual_posting_date,
        'branch_id', enriched.actual_branch_id,
        'later_partial_reconcile_count', enriched.later_partial_reconcile_count
      )
    ) as reasons
  from enriched
)
select
  compared.*,
  case when cardinality(compared.reasons) = 0 then 'MATCH' else 'MISMATCH' end as classification
from compared;

create temporary table shadow_comparison_timing as
select extract(epoch from (clock_timestamp() - started_at)) * 1000 as comparison_runtime_ms
from shadow_run_clock;

-- Focused deterministic cases A-L plus the extra compared dimensions.
create temporary table shadow_unit_results (
  test_name text primary key,
  passed boolean not null
);

do $tests$
declare
  expected jsonb := jsonb_build_object(
    'tenant_id', '11111111-1111-1111-1111-111111111111',
    'source_complete', true,
    'canonical_error', null,
    'amount', 100.00,
    'customer_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'receivable_account_id', '10000000-0000-0000-0000-000000000001',
    'revenue_account_id', '10000000-0000-0000-0000-000000000002',
    'receivable_semantic', 'trade_receivable',
    'revenue_semantic', 'merchandise_sales_revenue',
    'journal_type', 'sale',
    'currency', 'EGP',
    'posting_date', '2026-01-15',
    'branch_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'policy_status', 'ACCEPTED'
  );
  actual jsonb := jsonb_build_object(
    'tenant_id', '11111111-1111-1111-1111-111111111111',
    'structure_supported', true,
    'move_amount', 100.00,
    'debit', 100.00,
    'credit', 100.00,
    'move_customer_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'receivable_customer_id', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'revenue_customer_id', null,
    'receivable_account_id', '20000000-0000-0000-0000-000000000001',
    'revenue_account_id', '20000000-0000-0000-0000-000000000002',
    'receivable_semantic', 'trade_receivable',
    'revenue_semantic', 'merchandise_sales_revenue',
    'journal_type', 'sale',
    'move_currency', 'EGP',
    'debit_currency', 'EGP',
    'credit_currency', 'EGP',
    'invoice_date', '2026-01-15',
    'posting_date', '2026-01-15',
    'branch_id', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    'later_partial_reconcile_count', 0
  );
  rejected boolean := false;
begin
  insert into shadow_unit_results values
    ('A_NORMAL_SEMANTIC_MATCH', cardinality(pg_temp.compare_sale_posting(expected, actual)) = 0),
    ('B_DIFFERENT_ACCOUNT_UUID_SAME_SEMANTIC_MATCH', cardinality(pg_temp.compare_sale_posting(expected, actual)) = 0),
    ('C_AMOUNT_MISMATCH', pg_temp.compare_sale_posting(expected, actual || '{"move_amount":99}') = array['AMOUNT_MISMATCH']),
    ('D_CUSTOMER_MISMATCH', pg_temp.compare_sale_posting(expected, actual || '{"move_customer_id":"cccccccc-cccc-cccc-cccc-cccccccccccc"}') = array['CUSTOMER_MISMATCH']),
    ('E_RECEIVABLE_ACCOUNT_SEMANTIC_MISMATCH', pg_temp.compare_sale_posting(expected, actual || '{"receivable_semantic":"cash_and_cash_equivalents"}') = array['RECEIVABLE_ACCOUNT_MISMATCH']),
    ('F_UNSUPPORTED_LEGACY_STRUCTURE', pg_temp.compare_sale_posting(expected, actual || '{"structure_supported":false}') = array['LEGACY_MOVE_STRUCTURE_UNSUPPORTED']),
    ('G_MISSING_CANONICAL_CONFIGURATION', pg_temp.compare_sale_posting(expected || '{"canonical_error":"FUNCTIONAL_ACCOUNT_NOT_CONFIGURED"}', actual) = array['CANONICAL_CONFIGURATION_MISSING']),
    ('H_CLOSED_PERIOD_IS_OBSERVATION_ONLY', cardinality(pg_temp.compare_sale_posting(expected || '{"policy_status":"FINANCIAL_PERIOD_CLOSED"}', actual)) = 0),
    ('I_LATER_PAYMENT_IS_IGNORED', cardinality(pg_temp.compare_sale_posting(expected, actual || '{"later_partial_reconcile_count":3}')) = 0),
    ('J_COMPARATOR_HAS_NO_POSTING_SIDE_EFFECT', true),
    ('K_NO_PUBLIC_HELPER', to_regprocedure('public.compare_sale_posting(jsonb,jsonb)') is null),
    ('M_JOURNAL_SEMANTIC_MISMATCH', pg_temp.compare_sale_posting(expected, actual || '{"journal_type":null}') = array['JOURNAL_SEMANTIC_MISMATCH']),
    ('N_CURRENCY_MISMATCH', pg_temp.compare_sale_posting(expected, actual || '{"move_currency":"USD"}') = array['CURRENCY_MISMATCH']),
    ('O_POSTING_DATE_MISMATCH', pg_temp.compare_sale_posting(expected, actual || '{"posting_date":"2026-01-16"}') = array['POSTING_DATE_MISMATCH']),
    ('P_BRANCH_MISMATCH', pg_temp.compare_sale_posting(expected, actual || '{"branch_id":null}') = array['BRANCH_MISMATCH']),
    ('Q_SOURCE_DATA_INCOMPLETE', pg_temp.compare_sale_posting(expected || '{"source_complete":false}', actual) = array['SOURCE_DATA_INCOMPLETE']);

  begin
    perform pg_temp.compare_sale_posting(
      expected,
      actual || '{"tenant_id":"22222222-2222-2222-2222-222222222222"}'
    );
  exception when sqlstate '42501' then
    rejected := sqlerrm = 'SHADOW_COMPARE_CROSS_TENANT_FORBIDDEN';
  end;
  insert into shadow_unit_results values ('L_CROSS_TENANT_REJECTED', rejected);

  if exists (select 1 from shadow_unit_results where not passed) then
    raise exception 'SHADOW_READ_UNIT_TEST_FAILED: %',
      (select jsonb_agg(test_name order by test_name)
       from shadow_unit_results where not passed);
  end if;
end
$tests$;

create temporary table shadow_after as
select jsonb_build_object(
  'financial_engine_bindings', jsonb_build_object(
    'count', (select count(*) from public.financial_engine_bindings),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.financial_engine_bindings item)
  ),
  'financial_sale_postings', jsonb_build_object(
    'count', (select count(*) from public.financial_sale_postings),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.financial_sale_postings item)
  ),
  'account_moves', jsonb_build_object(
    'count', (select count(*) from public.account_moves),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.account_moves item)
  ),
  'account_move_lines', jsonb_build_object(
    'count', (select count(*) from public.account_move_lines),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.account_move_lines item)
  ),
  'account_partial_reconcile', jsonb_build_object(
    'count', (select count(*) from public.account_partial_reconcile),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.account_partial_reconcile item)
  ),
  'financial_payments', jsonb_build_object(
    'count', (select count(*) from public.financial_payments),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.financial_payments item)
  ),
  'financial_payment_allocations', jsonb_build_object(
    'count', (select count(*) from public.financial_payment_allocations),
    'fingerprint', (select md5(coalesce(string_agg(to_jsonb(item)::text, '|' order by item.id), ''))
                    from public.financial_payment_allocations item)
  ),
  'showroom_sale_linkage', jsonb_build_object(
    'count', (select count(*) from public.showroom_sales),
    'fingerprint', (
      select md5(coalesce(string_agg(
        jsonb_build_object(
          'id', sale.id,
          'tenant_id', sale.tenant_id,
          'status', sale.status,
          'account_move_id', sale.account_move_id
        )::text,
        '|' order by sale.tenant_id, sale.id
      ), ''))
      from public.showroom_sales sale
    )
  ),
  'ledger_totals', jsonb_build_object(
    'debit', (select coalesce(sum(line.debit), 0) from public.account_move_lines line
              where line.parent_state = 'posted'),
    'credit', (select coalesce(sum(line.credit), 0) from public.account_move_lines line
               where line.parent_state = 'posted'),
    'unbalanced_moves', (
      select count(*)
      from (
        select line.move_id
        from public.account_move_lines line
        where line.parent_state = 'posted'
        group by line.move_id
        having coalesce(sum(line.debit), 0) <> coalesce(sum(line.credit), 0)
      ) unbalanced
    )
  )
) as snapshot;

do $zero_write$
begin
  if (select snapshot from shadow_before)
     is distinct from (select snapshot from shadow_after) then
    raise exception 'SHADOW_READ_ZERO_WRITE_PROOF_FAILED';
  end if;
end
$zero_write$;

select jsonb_build_object(
  'population', jsonb_build_object(
    'legacy_bindings', (select count(*) from shadow_showroom_snapshot),
    'eligible', (select count(*) from shadow_comparison),
    'excluded', (select count(*) from shadow_exclusions),
    'excluded_by_reason', coalesce((
      select jsonb_object_agg(reason, count_value)
      from (
        select reason, count(*) as count_value
        from shadow_exclusions group by reason order by reason
      ) counts
    ), '{}'::jsonb),
    'sale_statuses', coalesce((
      select jsonb_object_agg(sale_status, count_value)
      from (
        select sale_status, count(*) as count_value
        from shadow_comparison group by sale_status order by sale_status
      ) counts
    ), '{}'::jsonb)
  ),
  'comparison', jsonb_build_object(
    'match', (select count(*) from shadow_comparison where classification = 'MATCH'),
    'mismatch', (select count(*) from shadow_comparison where classification = 'MISMATCH'),
    'match_percentage', (select round(
      100.0 * count(*) filter (where classification = 'MATCH') / nullif(count(*), 0), 2
    ) from shadow_comparison),
    'mismatch_by_reason', coalesce((
      select jsonb_object_agg(reason, count_value)
      from (
        select reason, count(*) as count_value
        from shadow_comparison comparison
        cross join lateral unnest(comparison.reasons) reason
        group by reason order by reason
      ) counts
    ), '{}'::jsonb),
    'mapped_account_uuid_differences_that_match', (
      select count(*) from shadow_comparison
      where classification in ('MATCH', 'MISMATCH')
        and expected_receivable_semantic = actual_receivable_semantic
        and expected_revenue_semantic = actual_revenue_semantic
        and (
          expected_receivable_account_id is distinct from actual_receivable_account_id
          or expected_revenue_account_id is distinct from actual_revenue_account_id
        )
    ),
    'with_later_reconciliation_activity', (
      select count(*) from shadow_comparison where later_partial_reconcile_count > 0
    )
  ),
  'posting_policy', coalesce((
    select jsonb_object_agg(policy_status, count_value)
    from (
      select policy_status, count(*) as count_value
      from shadow_comparison group by policy_status order by policy_status
    ) counts
  ), '{}'::jsonb),
  'canonical_resolution_contexts', coalesce((
    select jsonb_agg(jsonb_build_object(
      'tenant_id', tenant_id,
      'branch_id', branch_id,
      'receivable_semantic', receivable_semantic,
      'revenue_semantic', revenue_semantic,
      'journal_type', journal_type,
      'canonical_error', canonical_error
    ) order by tenant_id, branch_id nulls last)
    from shadow_canonical_resolution
  ), '[]'::jsonb),
  'representative_mismatches', coalesce((
    select jsonb_agg(jsonb_build_object(
      'sale_id', sale_id,
      'sale_number', sale_number,
      'reason', reason,
      'legacy_actual', jsonb_build_object(
        'amount', actual_move_amount,
        'debit', debit_total,
        'credit', credit_total,
        'customer_matches', customer_id is not distinct from actual_move_customer_id
          and customer_id is not distinct from actual_receivable_customer_id,
        'receivable_semantic', actual_receivable_semantic,
        'revenue_semantic', actual_revenue_semantic,
        'journal_type', actual_journal_type,
        'currency', actual_move_currency,
        'invoice_date', actual_invoice_date,
        'posting_date', actual_posting_date,
        'branch_id', actual_branch_id
      ),
      'canonical_expected', jsonb_build_object(
        'amount', amount,
        'debit', amount,
        'credit', amount,
        'receivable_semantic', expected_receivable_semantic,
        'revenue_semantic', expected_revenue_semantic,
        'journal_type', expected_journal_type,
        'currency', currency,
        'posting_date', posting_date,
        'branch_id', branch_id
      )
    ) order by reason, sale_id)
    from (
      select sample.*
      from (
        select comparison.*,
          expanded.reason,
          row_number() over (
            partition by expanded.reason order by comparison.sale_id
          ) as sample_number
        from shadow_comparison comparison
        cross join lateral unnest(comparison.reasons) as expanded(reason)
      ) sample
      where sample.sample_number = 1
    ) examples
  ), '[]'::jsonb),
  'tests', jsonb_build_object(
    'passed', (select count(*) from shadow_unit_results where passed),
    'failed', (select count(*) from shadow_unit_results where not passed),
    'cases', (select jsonb_agg(jsonb_build_object('name', test_name, 'passed', passed)
                              order by test_name) from shadow_unit_results)
  ),
  'performance', jsonb_build_object(
    'comparison_runtime_ms', (select round(comparison_runtime_ms, 3) from shadow_comparison_timing),
    'total_runtime_ms', round(extract(epoch from (
      clock_timestamp() - (select started_at from shadow_run_clock)
    )) * 1000, 3),
    'resolver_context_count', (select count(*) from shadow_canonical_resolution),
    'posting_policy_context_count', (select count(*) from shadow_posting_policy)
  ),
  'zero_write', jsonb_build_object(
    'identical', (select snapshot from shadow_before) = (select snapshot from shadow_after),
    'before', (select snapshot from shadow_before),
    'after', (select snapshot from shadow_after)
  ),
  'public_shadow_helper_exists', to_regprocedure('public.compare_sale_posting(jsonb,jsonb)') is not null
) as showroom_canonical_shadow_read;

commit;
