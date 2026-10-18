import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../supabase/migrations/20261018180000_inventory_dashboard_summary.sql');
const overview = read('../products/pages/InventoryOverviewPage.jsx');
const stock = read('./pages/StockListPage.jsx');
const returns = read('./pages/InventoryReturnReviewsPage.jsx');
const locations = read('../products/pages/InventoryLocationsPage.jsx');
const api = read('./api/inventory.api.js');

test('dashboard summary is read-only and tenant, branch and location scoped', () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, public/);
  assert.match(migration, /current_tenant_id\(\)/);
  assert.match(migration, /current_tenant_user_id\(\)/);
  assert.match(migration, /has_permission\('inventory\.availability'/);
  assert.match(migration, /has_branch_access\(location\.branch_id\)/);
  assert.match(migration, /has_stock_location_access\(location\.id\)/);
  assert.match(migration, /unit\.tenant_id = v_tenant_id/);
  assert.doesNotMatch(migration, /\b(insert|update|delete)\s+(into|public\.)/i);
});

test('dashboard totals reuse canonical availability and reservation rules', () => {
  assert.match(migration, /inventory_reservation_lines/);
  assert.match(migration, /inventory_reservations/);
  assert.match(migration, /stock_quants/);
  assert.match(migration, /inventory_tracking_unit_states/);
  assert.match(migration, /data_status = 'complete'/);
  assert.match(migration, /greatest\(balance\.total_quantity - balance\.reserved_quantity, 0\)/);
  assert.match(api, /rpc\('get_inventory_dashboard_summary'/);
});

test('attention units are scoped and based on recorded data and image attachments', () => {
  assert.match(migration, /data_status in \('incomplete', 'needs_review'\)/);
  assert.match(migration, /related_model = 'stock_tracking_units'/);
  assert.match(migration, /mime_type like 'image\/%'/);
  assert.match(migration, /left\(attachment\.file_path, length\(v_tenant_id::text\) \+ 1\)/);
  assert.match(migration, /limit 6/);
  assert.match(overview, /وحدات تحتاج استكمال بيانات/);
  assert.match(overview, /وحدات بلا صور/);
});

test('overview reuses the canonical movement RPC and separates loading, error and empty states', () => {
  assert.match(overview, /listStockMovements\(\{ page: 1, pageSize: 6 \}\)/);
  assert.match(overview, /جاري تحميل ملخص المخزون/);
  assert.match(overview, /تعذر تحميل نظرة المخزون/);
  assert.match(overview, /لا توجد حركات مسجلة ضمن نطاقك/);
  assert.doesNotMatch(overview, /getStockMoves|getSerialUnits|productsService\.listProducts/);
});

test('dashboard shortcuts are permission-aware and preserve approved receiving and transfer dialogs', () => {
  assert.match(overview, /can\('inventory\.receive'\)/);
  assert.match(overview, /can\('inventory\.transfer'\)/);
  assert.match(overview, /stock\?action=receive/);
  assert.match(overview, /stock\?action=transfer/);
  assert.match(stock, /searchParams\.get\('action'\)/);
  assert.match(stock, /setAddOpen\(true\)/);
  assert.match(stock, /اختر المنتج المطلوب من القائمة ثم اضغط «نقل»/);
  assert.match(stock, /<AddStockDialog/);
  assert.match(stock, /<TransferInventoryDialog/);
});

test('remaining Inventory support pages use platform headers and breadcrumbs without changing counts', () => {
  for (const page of [overview, returns, locations]) {
    assert.match(page, /PageHeader/);
    assert.match(page, /getCanonicalBreadcrumbs/);
  }
});
