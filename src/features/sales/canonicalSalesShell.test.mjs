import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getAppAccessPermission } from '../../core/authorization/appAccess.js';
import { getPlatformRouteMetadata } from '../../core/navigation/platformNavigation.js';
import { getAppBasePath } from '../../utils/appResolver.js';
import { createCanonicalSalesNavigationMenus } from './routes/salesNavigation.js';
import { SALES_ROUTES } from './routes/salesRoutes.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const appRouter = read('../../app/router/AppRouter.jsx');
const routeRegistry = read('../../app/router/appRouteRegistry.js');
const lazyRoutes = read('../../app/router/lazyRoutes.jsx');
const menuRegistry = read('../../app/router/menuRegistry.js');
const appsService = read('../../services/apps.service.js');
const overviewPage = read('./pages/SalesOverviewPage.jsx');
const branchPage = read('./pages/SalesBranchPage.jsx');
const createPage = read('./pages/SaleCreatePage.jsx');
const detailsPage = read('./pages/SaleDetailsPage.jsx');

test('canonical Sales routes are explicit and the application root no longer loads InvoicesPage', () => {
  assert.deepEqual(
    [SALES_ROUTES.overview, SALES_ROUTES.legacyList, SALES_ROUTES.create, SALES_ROUTES.branch('branch-1'), SALES_ROUTES.details('sale-1')],
    ['/app/sales', '/app/sales/list', '/app/sales/new', '/app/sales/branches/branch-1', '/app/sales/sale-1'],
  );
  assert.match(routeRegistry, /appCode: 'sales', path: '\/app\/sales', loader: routeLoaders\.salesOverview/);
  assert.doesNotMatch(routeRegistry, /appCode: 'sales', path: '\/app\/sales', loader: routeLoaders\.invoices/);
  assert.match(appRouter, /path=\{ROUTES\.sales\}[\s\S]*AppAccessRoute appCode="sales"[\s\S]*<AppLayout \/>/);
  assert.match(appRouter, /<Route index element=\{<SalesOverviewPage \/>\}/);
  assert.match(appRouter, /path="list" element=\{<Navigate to=\{ROUTES\.sales\} replace \/>\}/);
  assert.match(appRouter, /path="new" element=\{<SaleCreatePage \/>\}/);
  assert.match(appRouter, /path="branches\/:branchId" element=\{<SalesBranchPage \/>\}/);
  assert.match(appRouter, /path=":saleId" element=\{<SaleDetailsPage \/>\}/);
});

test('route loaders and menu resolver know every primary Sales shell route', () => {
  for (const loader of ['salesOverview', 'salesBranch', 'saleCreate', 'saleDetails']) {
    assert.match(routeRegistry, new RegExp(`${loader}: cached\\('${loader}'`));
    assert.match(lazyRoutes, new RegExp(loader));
  }
  assert.match(menuRegistry, /register\(\['\/app\/sales'\], 'salesOverview', 'SalesOverviewPage'\)/);
  assert.doesNotMatch(menuRegistry, /SalesListPage|salesList/);
  assert.match(menuRegistry, /register\(\['\/app\/sales\/new'\], 'saleCreate', 'SaleCreatePage'\)/);
});

test('Sales navigation exposes only overview and the new-sale workflow', () => {
  const menus = createCanonicalSalesNavigationMenus({ id: 'sales-module' });
  assert.deepEqual(menus.map((item) => [item.code, item.name, item.routePath]), [
    ['sales.overview', 'نظرة عامة', '/app/sales'],
    ['sales.new', 'بيع جديد', '/app/sales/new'],
  ]);
  assert.ok(menus.every((item) => item.appId === 'sales-module' && item.appCode === 'sales' && item.active));
  assert.match(appsService, /normalizedAppCode === 'sales'[\s\S]*createCanonicalSalesNavigationMenus\(app\)/);
  assert.doesNotMatch(JSON.stringify(menus), /sales\.invoices|sales\.contracts/);
});

test('Sales access uses the existing installed-app permission convention without role checks', () => {
  assert.equal(getAppAccessPermission('sales'), 'sales.access');
  assert.equal(getAppBasePath('sales'), '/app/sales');
  assert.match(appRouter, /AppAccessRoute appCode="sales"/);
  for (const source of [overviewPage, branchPage, createPage, detailsPage]) {
    assert.doesNotMatch(source, /role\s*===|tenantUser\?\.role/);
  }
});

test('branch route is scoped by URL identity and publishes its resolved branch name', () => {
  assert.match(branchPage, /const \{ branchId = '' \} = useParams\(\)/);
  assert.match(branchPage, /useSalesBranchReports/);
  assert.match(branchPage, /item\.branch\.id === branchId/);
  assert.match(branchPage, /publishRouteContext\(\{ currentLabel: report\.branch\.name \}\)/);
  assert.match(branchPage, /البحث في مبيعات الفرع/);
  assert.match(branchPage, /تحديد شهر التقرير/);
  assert.match(branchPage, /onChange=\{\(event\) => setMonth\(event\.target\.value\)\}/);
  assert.match(branchPage, /can\('sales\.create'\)/);
  assert.match(branchPage, /SALES_ROUTES\.create/);
  assert.match(branchPage, /useSalesList/);
  assert.match(branchPage, /branchId,/);
  assert.match(branchPage, /pageSize: 100/);
  assert.match(branchPage, /loadAll: true/);
  assert.doesNotMatch(branchPage, /SalesRecords|أداء ومبيعات الشهر الحالي|فواتير الفرع/);
  assert.doesNotMatch(branchPage, /supabase|\.rpc\(|\.from\(|fetch\(/);
});

test('details are not a menu row and resolve back to the Sales overview', () => {
  assert.equal(getPlatformRouteMetadata('/app/sales/6d82a').section.primaryTo, '/app/sales');
  assert.equal(getPlatformRouteMetadata('/app/sales/new').section.primaryTo, '/app/sales/new');
  assert.equal(getPlatformRouteMetadata('/app/sales/list').section, null);
  assert.match(detailsPage, /useParams\(\)/);
  assert.match(detailsPage, /const \{ saleId = '' \} = useParams\(\)/);
});

test('create and details keep their route boundaries while overview owns bounded reporting reads', () => {
  for (const source of [createPage, detailsPage]) {
    assert.doesNotMatch(source, /supabase|\.rpc\(|\.from\(|fetch\(|create_sale|update_sale_draft|get_sale|get_sale_readiness|confirm_sale|SettlementDialog/);
    assert.doesNotMatch(source, /features\/showroom/);
  }
  assert.match(overviewPage, /useSalesBranchReports/);
  assert.match(overviewPage, /useSalesList/);
  assert.doesNotMatch(overviewPage, /supabase|client\.rpc\(|features\/showroom/);
});

test('legacy invoices and contracts remain reachable away from the canonical Sales root', () => {
  assert.equal(SALES_ROUTES.legacyInvoices, '/app/sales/invoices');
  assert.equal(SALES_ROUTES.legacyContracts, '/app/sales/contracts');
  assert.match(routeRegistry, /invoices: cached\('invoices',[\s\S]*features\/invoices\/pages\/InvoicesPage/);
  assert.match(appRouter, /path="invoices" element=\{<InvoicesPage \/>\}/);
  assert.match(appRouter, /path="contracts" element=\{<Navigate to=\{ROUTES\.contracts\} replace \/>\}/);
  assert.match(menuRegistry, /register\(\['\/app\/sales\/invoices'\], 'invoices', 'InvoicesPage'\)/);
});
