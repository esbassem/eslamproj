import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(new URL('../../../supabase/migrations/20260909130000_supplemental_historical_cancelled_sales_import.sql', import.meta.url), 'utf8');

test('supplemental import is atomic and restricted to the two approved records', () => {
  assert.match(sql, /^begin;/);
  assert.match(sql, /46efd2df-5097-4449-b5f9-3e23c7554fa9/);
  assert.match(sql, /a09d1ff0-7491-4ae8-af74-b805cd667d02/);
  assert.match(sql, /count\(\*\) from supplemental_manifest\) <> 2/);
  assert.match(sql, /SUPPLEMENTAL_HISTORICAL_IDENTITY_COLLISION/);
  assert.match(sql, /SUPPLEMENTAL_HISTORICAL_REPLAY_FACT_MISMATCH/);
  assert.match(sql, /status='cancelled'/);
});

test('required serial and financial evidence is preserved without operational writes', () => {
  assert.match(sql, /CANCELLED_SERIAL_RESERVED_WITHOUT_HISTORICAL_RELEASE/);
  assert.match(sql, /CANCELLED_SERIAL_REUSED_WITHOUT_HISTORICAL_RETURN_MOVE/);
  assert.match(sql, /2e8127b7-884d-4f65-bf37-3b9d79ce046b/);
  assert.match(sql, /SUPPLEMENTAL_HISTORICAL_SIDE_EFFECT_DETECTED/);
  for (const forbidden of ['insert into public.account_moves', 'insert into public.account_move_lines',
    'insert into public.financial_payments', 'insert into public.stock_moves',
    'insert into public.inventory_reservations', 'insert into public.sale_deliveries']) {
    assert.doesNotMatch(sql.toLowerCase(), new RegExp(forbidden));
  }
});
