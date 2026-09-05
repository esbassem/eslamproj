import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../../../../supabase/migrations/20260905120000_canonical_sale_posting_core.sql',
  import.meta.url,
);
const sql = await readFile(migrationUrl, 'utf8');
const replayMigration = await readFile(
  new URL(
    '../../../../supabase/migrations/20260905122000_canonical_sale_posting_replay_hardening.sql',
    import.meta.url,
  ),
  'utf8',
);

const publicContract = sql.match(
  /create or replace function public\.post_financial_sale\([\s\S]*?\n\)\nreturns jsonb/iu,
)?.[0] ?? '';

test('sale posting exposes business-event inputs and no raw accounting instructions', () => {
  assert.match(publicContract, /p_source_app text/iu);
  assert.match(publicContract, /p_source_model text/iu);
  assert.match(publicContract, /p_source_id text/iu);
  assert.match(publicContract, /p_event_version integer/iu);
  assert.match(publicContract, /p_source_business_fingerprint text/iu);
  assert.match(publicContract, /p_partner_id uuid/iu);
  assert.match(publicContract, /p_amount numeric/iu);
  assert.match(publicContract, /p_posting_date date/iu);
  assert.doesNotMatch(publicContract, /receivable_account|revenue_account|journal_id|debit|credit/iu);
});

test('Financial Core owns account, journal, date, and balanced move resolution', () => {
  assert.match(sql, /resolve_functional_account\([\s\S]*?'customer_receivable'/iu);
  assert.match(sql, /resolve_functional_account\([\s\S]*?'sales_revenue'/iu);
  assert.match(sql, /resolve_financial_journal\([\s\S]*?'sale'/iu);
  assert.match(sql, /assert_financial_posting_date\(/iu);
  assert.match(sql, /accounting_assert_move_balanced\(move_id\)/iu);
  assert.match(sql, /'financial_sale_posting:' \|\| p_posting_id::text/iu);
});

test('idempotency is protected by locks and independent unique constraints', () => {
  assert.match(sql, /unique \(tenant_id, idempotency_key\)/iu);
  assert.match(
    sql,
    /unique \(tenant_id, source_app, source_model, source_id, event_version\)/iu,
  );
  assert.match(sql, /financial_sale_posting:key:/iu);
  assert.match(sql, /financial_sale_posting:source:/iu);
  assert.match(sql, /FINANCIAL_SALE_IDEMPOTENCY_PAYLOAD_MISMATCH/iu);
  assert.match(sql, /FINANCIAL_SALE_SOURCE_EVENT_PAYLOAD_MISMATCH/iu);
});

test('replay is resolved before mutable creation policy is re-evaluated', () => {
  const replayPosition = replayMigration.indexOf('select * into existing');
  const implementationPosition = replayMigration.indexOf(
    'return public.post_financial_sale_validated_impl',
  );
  assert.ok(replayPosition > 0);
  assert.ok(implementationPosition > replayPosition);
  assert.match(replayMigration, /FINANCIAL_SALE_IDEMPOTENCY_PAYLOAD_MISMATCH/iu);
  assert.match(replayMigration, /FINANCIAL_SALE_SOURCE_EVENT_PAYLOAD_MISMATCH/iu);
  assert.doesNotMatch(
    replayMigration.slice(0, implementationPosition),
    /assert_financial_posting_date|FINANCIAL_SALE_CUSTOMER_INVALID_OR_INACTIVE/iu,
  );
});

test('contract is narrow, protected, and does not create payment or allocation state', () => {
  assert.match(sql, /financial\.sale\.post_operational/iu);
  assert.match(sql, /FINANCIAL_SALE_POSTING_REQUIRES_CANONICAL_CONTRACT/iu);
  assert.match(sql, /revoke all on function public\.create_financial_sale_posting_move/iu);
  assert.match(
    sql,
    /create_financial_sale_posting_move\([\s\S]*?from public, anon, authenticated, service_role/iu,
  );
  assert.doesNotMatch(sql, /insert into public\.financial_payments/iu);
  assert.doesNotMatch(sql, /insert into public\.financial_payment_allocations/iu);
  assert.doesNotMatch(sql, /insert into public\.account_partial_reconcile/iu);
});

test('persistent result identifies the future allocation target and provenance', () => {
  for (const field of [
    'posting_id',
    'account_move_id',
    'receivable_line_id',
    'partner_id',
    'original_amount',
    'current_residual',
    'currency_code',
    'source_app',
    'source_model',
    'source_id',
    'event_version',
    'accounting_state',
  ]) {
    assert.match(sql, new RegExp(`'${field}'`, 'u'));
  }
});

test('generic Financial Core primitive has no Showroom domain coupling', () => {
  assert.doesNotMatch(
    sql,
    /showroom|motorcycle|chassis|engine_number|paperwork|crm_lead/iu,
  );
});
