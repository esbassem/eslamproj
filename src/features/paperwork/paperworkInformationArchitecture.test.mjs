import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getPlatformRouteMetadata } from '../../core/navigation/platformNavigation.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Paperwork routes resolve to one of the three primary sidebar destinations', () => {
  const cases = [
    ['/apps/paperwork', '/apps/paperwork'],
    ['/apps/paperwork/requests', '/apps/paperwork/requests'],
    ['/apps/paperwork/requests/request-1', '/apps/paperwork/requests'],
    ['/apps/paperwork/processors', '/apps/paperwork/requests'],
    ['/apps/paperwork/processors/processor-1', '/apps/paperwork/requests'],
    ['/apps/paperwork/documents', '/apps/paperwork/documents'],
    ['/apps/paperwork/documents/document-1', '/apps/paperwork/documents'],
    ['/apps/paperwork/vault', '/apps/paperwork/documents'],
  ];
  cases.forEach(([pathname, primaryTo]) => {
    assert.equal(getPlatformRouteMetadata(pathname).section.primaryTo, primaryTo, pathname);
  });
});

test('canonical entry owns summary, activity and the only requests list', () => {
  const home = read('./pages/PaperworkHomePage.jsx');
  assert.match(home, /getHomeSummary/);
  assert.match(home, /آخر الطلبات|query\.data\.recentRequests/);
  assert.doesNotMatch(home, /كل الطلبات|PaperworkRequestsContent/);
  assert.match(home, /PAPERWORK_ROUTES\.processors/);
  assert.match(home, /PAPERWORK_ROUTES\.vault/);
  assert.match(home, /withPaperworkSearch\(PAPERWORK_ROUTES\.requests/);
});

test('launcher opens the summary while needs-action opens the dedicated requests page', () => {
  const registry = read('../../app/router/appRouteRegistry.js');
  const appsService = read('../../services/apps.service.js');
  const router = read('../../app/router/AppRouter.jsx');
  assert.match(registry, /appCode: 'paperwork'[\s\S]*path: '\/apps\/paperwork'/);
  assert.match(appsService, /name: 'الرئيسية'[\s\S]*href: '\/apps\/paperwork'/);
  assert.match(appsService, /name: 'طلبات الأوراق'[\s\S]*href: '\/apps\/paperwork\/requests'/);
  assert.match(router, /<Route index element=\{<PaperworkHomePage \/>\}/);
  assert.match(router, /path="requests" element=\{<PaperworkRequestsPage \/>\}/);
});

test('documents own vault navigation and the permission-gated manual receipt entry', () => {
  const navigation = read('./shared/PaperworkDocumentsNavigation.jsx');
  const manualReceipt = read('./manual-receipt/PaperworkManualReceipt.jsx');
  assert.match(navigation, /PAPERWORK_ROUTES\.documents/);
  assert.match(navigation, /PAPERWORK_ROUTES\.vault/);
  assert.match(navigation, /PaperworkManualReceipt showTrigger/);
  assert.match(manualReceipt, /PAPERWORK_PERMISSIONS\.RECEIVE/);
  assert.match(manualReceipt, /PAPERWORK_TASK_ROUTES\.manualReceipt/);
  assert.doesNotMatch(read('./pages/PaperworkHomePage.jsx'), /actions=\{canReceive/);
});

test('forward migration exposes home, requests and documents as active primary menus', () => {
  const migration = read('../../../supabase/migrations/20260824170000_add_paperwork_home_primary_menu.sql');
  assert.match(migration, /name = 'الرئيسية'[\s\S]*route_path = '\/apps\/paperwork'/);
  assert.match(migration, /name = 'طلبات الأوراق'[\s\S]*route_path = '\/apps\/paperwork\/requests'/);
  assert.match(migration, /code in \('paperwork\.processors', 'paperwork\.vault'\)/);
  assert.match(migration, /active = false/);
  assert.match(migration, /three primary menus/);
  assert.doesNotMatch(migration, /delete from/);
});

test('canonical requests corrective migration changes menu metadata only', () => {
  const migration = read('../../../supabase/migrations/20260823130000_canonicalize_paperwork_requests_destination.sql');
  assert.match(migration, /tenant_modules[\s\S]*state = 'installed'/);
  assert.match(migration, /code = 'paperwork\.requests'[\s\S]*route_path = '\/apps\/paperwork'/);
  assert.match(migration, /code = 'paperwork\.documents'[\s\S]*route_path = '\/apps\/paperwork\/documents'/);
  assert.doesNotMatch(migration, /paperwork_requests|paperwork_documents|auth_permissions|create policy/i);
});

test('frontend menu normalization keeps Paperwork at three items even with stale workspace metadata', () => {
  const appsService = read('../../services/apps.service.js');
  assert.match(appsService, /appCode === 'paperwork'/);
  assert.match(appsService, /paperwork\.root.*paperwork\.overview.*paperwork\.requests.*paperwork\.documents/);
  assert.match(appsService, /name: 'الرئيسية'[\s\S]*href: '\/apps\/paperwork'/);
  assert.match(appsService, /name: 'طلبات الأوراق'[\s\S]*href: '\/apps\/paperwork\/requests'/);
  assert.doesNotMatch(appsService.match(/appCode === 'paperwork'[\s\S]*?\n  \}/)?.[0] || '', /paperwork\.processors|paperwork\.vault/);
});

test('Paperwork pages render the canonical top breadcrumb trail', () => {
  const page = read('./shared/PaperworkPage.jsx');
  assert.match(page, /getCanonicalBreadcrumbs/);
  assert.match(page, /breadcrumbs=\{breadcrumbs\}/);
  assert.match(page, /PageHeader/);
  assert.match(page, /breadcrumbSize="large"/);
});
