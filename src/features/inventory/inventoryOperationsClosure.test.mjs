import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const stock = read('./pages/StockListPage.jsx');
const transfer = read('./components/TransferInventoryDialog.jsx');
const counts = read('../products/pages/InventoryCountsPage.jsx');
const api = read('./api/inventory.api.js');
const returns = read('./pages/InventoryReturnReviewsPage.jsx');
const sales = read('../sales/components/SaleActions.jsx');
const saleReturnAction = read('../sales/components/CanonicalSaleReturnAction.jsx');
const routes = read('../../app/router/menuRegistry.js');
const finalClosure = read('../../../supabase/migrations/20261015120000_inventory_operations_final_closure.sql');

test('transfer action and both endpoints require canonical permission and authorized scopes', () => {
  assert.match(stock, /can\('inventory\.transfer'\)/);
  assert.match(transfer, /can\('inventory\.transfer'\)/);
  assert.match(transfer, /canAccessBranch\(location\.branchId\).*canAccessStockLocation\(location\.id\)/s);
  assert.match(transfer, /source\.id !== destination\.id/);
  assert.match(transfer, /transferInventory\(/);
  assert.doesNotMatch(transfer, /from\(['"]stock_moves['"]\).*insert/s);
});

test('count UI separates start-save, submit-cancel and adjustment permissions', () => {
  assert.match(counts, /canCount = can\('inventory\.count'\)/);
  assert.match(counts, /canSubmitCount = can\('inventory\.count_submit'\)/);
  assert.match(counts, /canAdjust = can\('inventory\.adjust'\)/);
  assert.match(counts, /canCount \? <Button[^>]*onClick=\{save\}/s);
  assert.match(counts, /canSubmitCount \? <Button[^>]*onClick=\{submit\}/s);
  assert.match(counts, /cancelInventoryCount/);
  assert.match(api, /rpc\('cancel_inventory_count'/);
});

test('count cancellation is server scoped and matched closure creates no adjustment', () => {
  assert.match(counts, /canSubmitCount = can\('inventory\.count_submit'\)/);
  assert.match(counts, /cancelInventoryCount/);
  assert.match(counts, /closeMatchedInventoryCount/);
  assert.match(counts, /بدون إنشاء حركة أو تسوية مخزون/);
});

test('return review list and release are backend scoped and permission protected', () => {
  assert.match(routes, /inventory\/operations\/returns/);
  assert.match(returns, /can\('inventory\.return_review_release'\)/);
  assert.match(returns, /listPendingInventoryReturnReviews/);
  assert.match(returns, /releaseReturnedInventoryUnit/);
  assert.match(returns, /reason/);
  assert.match(api, /rpc\('list_pending_inventory_return_reviews'/);
  assert.match(api, /rpc\('release_returned_inventory_unit'/);
});

test('count adjustments and return review releases retain idempotency keys across uncertain retries', () => {
  assert.match(counts, /attemptKey\(commandAttempts, 'adjustment-post', command\)/);
  assert.match(counts, /attemptKey\(commandAttempts, 'matched-count-close', payload\)/);
  assert.match(returns, /previous\?\.fingerprint === fingerprint/);
  assert.match(returns, /idempotencyKey: attempt\.idempotencyKey/);
});

test('adjustments cannot adopt unknown identities and their line audit remains location scoped', () => {
  assert.match(finalClosure, /adjustment_type = 'operational_adoption'/);
  assert.match(finalClosure, /INVENTORY_ADJUSTMENT_IDENTITY_REQUIRES_CANONICAL_ADOPTION/);
  assert.match(finalClosure, /create policy inventory_adjustment_lines_read/);
  assert.match(finalClosure, /has_stock_location_access\(adjustment\.location_id\)/);
});

test('sales return action is hidden unless sales.return is granted', () => {
  assert.match(sales, /CanonicalSaleReturnAction/);
  assert.match(saleReturnAction, /can\('sales\.return'\)/);
});
