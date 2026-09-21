import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(new URL('../../../supabase/migrations/20260909120000_canonical_historical_showroom_sales_import.sql', import.meta.url), 'utf8');
const adapter = await readFile(new URL('../../../supabase/migrations/20260909121000_canonical_historical_sales_read_adapter.sql', import.meta.url), 'utf8');

test('import is atomic, exactly scoped, idempotent and collision-safe', () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /v_existing not in \(0, 215\)/);
  assert.match(migration, /HISTORICAL_IMPORT_IDENTITY_COLLISION/);
  assert.match(migration, /HISTORICAL_IMPORT_SCOPE_MISMATCH/);
  assert.match(migration, /source_system='showroom'\) <> 215/);
  assert.match(migration, /sum\(s\.total_amount\).*<> 11369400/s);
  assert.match(migration, /HISTORICAL_SALE_IMMUTABLE/);
});

test('import creates no operational financial or inventory facts', () => {
  for (const forbidden of ['insert into public.account_moves', 'insert into public.account_move_lines',
    'insert into public.financial_payments', 'insert into public.stock_moves',
    'insert into public.inventory_reservations', 'insert into public.sale_deliveries']) {
    assert.doesNotMatch(migration.toLowerCase(), new RegExp(forbidden));
  }
  assert.match(migration, /HISTORICAL_IMPORT_SIDE_EFFECT_DETECTED/);
});

test('historical adapter is authenticated read-only evidence', () => {
  assert.match(adapter, /security definer/);
  assert.match(adapter, /public\.has_permission\('sales\.view'/);
  assert.match(adapter, /revoke all.*public, anon/s);
  assert.doesNotMatch(adapter.toLowerCase(), /\b(insert|update|delete)\s+(into|public|from)\b/);
});
