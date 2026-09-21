import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20260905130000_financial_engine_binding_guard.sql', import.meta.url),
  'utf8',
);
const retirement = readFileSync(
  new URL('../../../../supabase/migrations/20260910130000_final_legacy_showroom_retirement.sql', import.meta.url),
  'utf8',
);

test('binding identity has one immutable engine owner and no ledger values', () => {
  assert.match(migration, /create table public\.financial_engine_bindings/iu);
  assert.match(
    migration,
    /unique \(tenant_id, source_app, source_model, source_id, financial_event_version\)/iu,
  );
  assert.match(migration, /financial_engine in \('legacy', 'canonical'\)/iu);
  assert.match(migration, /FINANCIAL_ENGINE_BINDING_OWNERSHIP_IMMUTABLE/iu);
  assert.match(migration, /FINANCIAL_ENGINE_BINDING_DELETE_FORBIDDEN/iu);
  assert.doesNotMatch(
    migration.match(/create table public\.financial_engine_bindings[\s\S]*?\n\);/iu)?.[0] ?? '',
    /\b(amount|debit|credit|account_id|journal_id)\b/iu,
  );
});

test('engine acquisition is serialized and conflicts fail closed', () => {
  assert.match(migration, /financial_engine_binding:source:/iu);
  assert.match(migration, /pg_advisory_xact_lock/iu);
  assert.match(migration, /FINANCIAL_ENGINE_CONFLICT_LEGACY_OWNED/iu);
  assert.match(migration, /FINANCIAL_ENGINE_CONFLICT_CANONICAL_OWNED/iu);
  assert.match(migration, /idempotent_replay/iu);
});

test('historical adoption is evidence-based and ledger read-only', () => {
  const backfill = migration.match(
    /-- Evidence-only Showroom backfill[\s\S]*?alter function public\.post_financial_sale/iu,
  )?.[0] ?? '';
  for (const evidence of [
    /move\.id = item\.account_move_id/iu,
    /move\.tenant_id = item\.tenant_id/iu,
    /move\.state = 'posted'/iu,
    /move\.move_type = 'sale'/iu,
    /move\.partner_id is not distinct from item\.customer_id/iu,
    /move\.amount_total is not distinct from item\.total_amount/iu,
  ]) assert.match(backfill, evidence);
  assert.doesNotMatch(backfill, /\b(update|delete from) public\.account_move/iu);
  assert.doesNotMatch(backfill, /cutoff|created_at\s*[<>]|sale_date\s*[<>]/iu);
});

test('canonical posting and Legacy Showroom confirmation both acquire ownership', () => {
  assert.match(
    migration,
    /create function public\.post_financial_sale[\s\S]*?'canonical', 'canonical_sale_posting'/iu,
  );
  assert.match(
    migration,
    /create function public\.complete_showroom_sale[\s\S]*?'legacy', 'showroom_complete_sale'/iu,
  );
  assert.match(migration, /bind_showroom_sale_to_legacy_engine/iu);
});

test('only original-posting dependent cancellation and return paths are guarded', () => {
  assert.match(
    migration,
    /create function public\.cancel_showroom_sale[\s\S]*?assert_showroom_sale_not_canonical/iu,
  );
  assert.match(
    migration,
    /create function public\.create_confirmed_showroom_sale_return[\s\S]*?assert_showroom_sale_not_canonical/iu,
  );
  assert.doesNotMatch(
    migration,
    /alter function public\.(pay_showroom_sale_accounting|settle_showroom_sale_with_open_credits|settle_showroom_sale_balance|settle_showroom_sale_balance_to_destination)/iu,
  );
});

test('binding mutation primitives are not client executable', () => {
  assert.match(
    migration,
    /revoke all on table public\.financial_engine_bindings[\s\S]*?public, anon, authenticated, service_role/iu,
  );
  for (const name of [
    'acquire_financial_engine_binding',
    'finalize_financial_engine_binding',
    'bind_showroom_sale_to_legacy_engine',
    'assert_showroom_sale_not_canonical',
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${name}\\(`, 'iu'),
    );
  }
});

test('retirement removes the Legacy binding adapter without deleting generic bindings', () => {
  assert.match(retirement, /drop function public\.bind_showroom_sale_to_legacy_engine/iu);
  assert.doesNotMatch(retirement, /drop table public\.financial_engine_bindings/iu);
});
