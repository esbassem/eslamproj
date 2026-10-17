import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../supabase/migrations/20261017120000_inventory_navigation_and_stock_balances.sql');
const appsService = read('../../services/apps.service.js');
const appContext = read('../../contexts/AppContext.jsx');
const menuRegistry = read('../../app/router/menuRegistry.js');
const router = read('../../app/router/AppRouter.jsx');
const navigation = read('../../core/navigation/platformNavigation.js');
const api = read('./api/inventory.api.js');
const hook = read('./hooks/useStock.js');
const page = read('./pages/StockListPage.jsx');

test('Inventory navigation is stored in the existing global catalog without touching tenant installations', () => {
  assert.match(migration, /public\.ir_modules/);
  assert.match(migration, /public\.ir_ui_menus/);
  assert.doesNotMatch(migration, /(?:insert into|update|delete from)\s+public\.tenant_modules/i);
  assert.match(migration, /'inventory\.stock_group'/);
  assert.match(migration, /'inventory\.operations_group'/);
  assert.match(migration, /'inventory\.configuration_group'/);
  assert.match(migration, /'inventory\.return_reviews'/);
  assert.match(migration, /name = 'مواقع المخزون'[\s\S]*route_path = '\/apps\/inventory\/operations\/locations'/);
});

test('standalone categories are removed from navigation while their old route redirects safely', () => {
  assert.doesNotMatch(menuRegistry, /register\(\['\/apps\/inventory\/products\/categories'/);
  assert.match(router, /path="\/apps\/inventory\/products\/categories"[\s\S]*to="\/apps\/inventory\/products"/);
  assert.doesNotMatch(navigation, /label: 'التصنيفات'/);
  assert.match(navigation, /label: 'المنتجات والتصنيفات'/);
  assert.match(migration, /active = false[\s\S]*\/apps\/inventory\/products\/categories/);
});

test('dynamic Inventory menus are filtered by action permissions before rendering', () => {
  assert.match(appsService, /appCode === 'products'/);
  assert.match(appsService, /inventory\.return_review_release/);
  assert.match(appsService, /inventory\.count_submit/);
  assert.match(appsService, /inventory\.availability/);
  assert.match(appsService, /products\.manage/);
  assert.match(appsService, /allowedCodes\.has\(menu\.code\)/);
  assert.match(appContext, /buildAppMenusFromWorkspace\([\s\S]*\{ userRole, permissionCodes \}/);
  assert.match(appContext, /\[apps, installedMenus, permissionCodes, userRole\]/);
});

test('stock balances use one paginated server read model with canonical scope enforcement', () => {
  assert.match(migration, /create or replace function public\.list_inventory_stock_balances/);
  assert.match(migration, /public\.has_branch_access\(location\.branch_id\)/);
  assert.match(migration, /public\.has_stock_location_access\(location\.id\)/);
  assert.match(migration, /public\.inventory_tracking_unit_states/);
  assert.match(migration, /public\.inventory_reservation_lines/);
  assert.match(migration, /limit v_page_size offset/);
  assert.match(api, /rpc\('list_inventory_stock_balances'/);
  assert.doesNotMatch(hook, /inventoryService\.getStock/);
});

test('stock page supports scoped filters, defaults and distinct loading/error/empty states', () => {
  for (const contract of [
    /defaultBranchId/,
    /defaultStockLocationId/,
    /canAccessBranch/,
    /canAccessStockLocation/,
    /اسم المنتج أو الكود أو Barcode/,
    /كل الفروع المصرح بها/,
    /كل المواقع المصرح بها/,
    /كل التصنيفات/,
    /availableQuantity/,
    /reservedQuantity/,
    /totalQuantity/,
    /PageHeader/,
    /getCanonicalBreadcrumbs/,
  ]) assert.match(page, contract);
  assert.match(page, /isLoading \?/);
  assert.match(page, /!error && stock\.length/);
  assert.match(page, /: !error \? <StockEmptyState/);
});

test('Receiving and Transfer remain unchanged actions and refresh the active stock query', () => {
  assert.match(page, /<AddStockDialog/);
  assert.match(page, /<TransferInventoryDialog/);
  assert.match(page, /onSaved=\{reload\}/);
  assert.doesNotMatch(page, /inventoryService\.(receiveInventory|transferInventory)\(/);
});
