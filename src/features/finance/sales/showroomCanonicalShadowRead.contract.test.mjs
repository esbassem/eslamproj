import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../../supabase/migrations/20260910130000_final_legacy_showroom_retirement.sql', import.meta.url),
  'utf8',
);

test('retirement has an audited baseline gate and uses no cascading drops', () => {
  assert.match(migration, /SHOWROOM_RETIREMENT_BASELINE_DRIFT/);
  assert.match(migration, /SHOWROOM_RETIREMENT_EXTERNAL_FK_DATA_REMAINS/);
  assert.match(migration, /lock table[\s\S]*access exclusive mode/iu);
  assert.doesNotMatch(migration, /drop\s+(?:table|function)[^;]*\bcascade\b/iu);
});

test('retirement preserves canonical provenance, ledger, paperwork archive, and inventory references', () => {
  assert.match(migration, /sale_historical_sources\) <> 218/);
  assert.match(migration, /sale_line_historical_sources\) <> 218/);
  assert.match(migration, /paperwork_legacy_sale_sources\) <> 2/);
  assert.match(migration, /reference_type = 'showroom_sale'\) <> 63/);
  assert.doesNotMatch(migration, /(?:delete from|update) public\.(?:sales|sale_lines|sale_historical_sources|sale_line_historical_sources|account_moves|account_move_lines|financial_payments|account_partial_reconcile|stock_moves|paperwork_legacy_sale_sources)/iu);
});

test('all nine operational tables and 28 owned functions are explicitly retired', () => {
  const tableDrops = migration.match(/drop table public\.showroom_[a-z_]+;/gu) ?? [];
  const functionDrops = migration.match(/drop function public\.[a-z_]*showroom[a-z_]*\([^;]*\);/gu) ?? [];
  assert.equal(tableDrops.length, 9);
  assert.equal(functionDrops.length, 28);
  assert.match(migration, /drop column original_sale_id/);
  assert.match(migration, /drop column original_sale_line_id/);
  assert.match(migration, /drop column sale_return_operation_id/);
});

test('generic Financial Core retains canonical and ordinary authorization paths', () => {
  assert.match(migration, /is_trusted_sales_confirmation_context/);
  assert.match(migration, /can_perform_financial_action\(uuid,text,uuid,text,uuid,boolean\)/);
  assert.match(migration, /SHOWROOM_POSTING_CAPABILITY_DETACH_NOT_APPLIED/);
});
