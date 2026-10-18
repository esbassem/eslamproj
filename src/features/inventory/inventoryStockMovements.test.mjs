import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../supabase/migrations/20261018120000_inventory_stock_movements.sql');
const page = read('./pages/StockMovesPage.jsx');
const api = read('./api/inventory.api.js');

test('movement RPC is read-only and tenant, permission, branch and location scoped', () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, public/);
  assert.match(migration, /current_tenant_id\(\)/);
  assert.match(migration, /current_tenant_user_id\(\)/);
  assert.match(migration, /has_permission\('inventory\.read'/);
  assert.match(migration, /has_branch_access/);
  assert.match(migration, /has_stock_location_access/);
  assert.match(migration, /event\.tenant_id = v_tenant_id/);
  assert.match(migration, /move\.tenant_id = v_tenant_id/);
  assert.match(migration, /from authorized_locations scoped_location/);
  assert.doesNotMatch(migration, /\b(insert|update|delete)\s+(into|public\.)/i);
});

test('canonical events lead and legacy moves are included only when not duplicated', () => {
  assert.match(migration, /event_rows as/);
  assert.match(migration, /legacy_move_rows as/);
  assert.match(migration, /Match legacy rows to canonical events one-for-one/);
  assert.match(migration, /event\.tracking_unit_id is not distinct from move\.tracking_unit_id/);
  assert.match(migration, /event\.product_id = move\.product_product_id/);
  assert.match(migration, /event\.quantity = move\.quantity/);
  assert.match(migration, /event\.from_location_id is not distinct from move\.source_location_id/);
  assert.match(migration, /event\.to_location_id is not distinct from move\.destination_location_id/);
  assert.match(migration, /ordinal_move\.created_at, ordinal_move\.id/);
  assert.match(migration, /public\.inventory_receipt_lines/);
  assert.match(migration, /public\.inventory_delivery_lines/);
  assert.match(migration, /public\.inventory_return_lines/);
  assert.doesNotMatch(migration, /abs\(extract\(epoch/);
});

test('search, filters, dates, pagination and ordering are server-side', () => {
  assert.match(migration, /p_movement_type/);
  assert.match(migration, /p_date_from/);
  assert.match(migration, /p_date_to/);
  assert.match(migration, /v_search/);
  assert.match(migration, /offset \(v_page - 1\) \* v_page_size limit v_page_size/);
  assert.match(migration, /order by occurred_at desc, record_source, id desc/);
  assert.match(api, /rpc\('list_inventory_stock_movements'/);
  assert.match(api, /p_branch_id: branchId/);
  assert.match(api, /p_location_id: locationId/);
});

test('movement page persists filters in URL and separates loading, error and empty states', () => {
  assert.match(page, /useSearchParams\(\)/);
  for (const parameter of ['q', 'branch', 'location', 'type', 'from', 'to', 'page']) {
    assert.match(page, new RegExp(`searchParams\\.get\\('${parameter}'\\)`));
  }
  assert.match(page, /جاري تحميل حركات المخزون/);
  assert.match(page, /تعذر تحميل حركات المخزون/);
  assert.match(page, /لا توجد حركات مطابقة/);
  assert.match(page, /PageHeader/);
});

test('only real serial and Sales detail routes are emitted', () => {
  assert.match(page, /\/apps\/inventory\/unique-units\/\$\{move\.trackingUnitId\}/);
  assert.match(migration, /'\/app\/sales\/' \|\|/);
  assert.match(migration, /has_permission\('sales\.access'/);
  assert.doesNotMatch(page, /receipts\/\$\{|transfers\/\$\{|adjustments\/\$\{/);
});
