import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createPaperworkNavigationState,
  isSafePaperworkReturnTo,
  resolvePaperworkReturnContext,
} from './routes/paperworkNavigation.js';
import { PAPERWORK_ROUTES, PAPERWORK_TASK_ROUTES, withPaperworkSearch } from './routes/paperworkRoutes.js';
import { getCanonicalBreadcrumbs, getPlatformRouteMetadata } from '../../core/navigation/platformNavigation.js';
import {
  clearManualReceiptDraft,
  hasManualReceiptDraft,
  readManualReceiptDraft,
  writeManualReceiptDraft,
} from './manual-receipt/manualReceiptDraft.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('route helpers preserve shareable list state', () => {
  assert.equal(
    withPaperworkSearch(PAPERWORK_ROUTES.requests, { q: 'ahmed', filter: 'sent_to_processor', page: 3 }),
    '/apps/paperwork/requests?q=ahmed&filter=sent_to_processor&page=3',
  );
  assert.equal(
    withPaperworkSearch(PAPERWORK_ROUTES.documents, { q: '12345', filter: 'delivered', page: 2 }),
    '/apps/paperwork/documents?q=12345&filter=delivered&page=2',
  );
});

test('return context preserves requests filters and pagination', () => {
  const source = { pathname: PAPERWORK_ROUTES.requests, search: '?q=ahmed&filter=preparation&page=3' };
  const state = createPaperworkNavigationState(source, { scrollTop: 420, returnLabel: 'الطلبات المفلترة' });
  const resolved = resolvePaperworkReturnContext({ state }, PAPERWORK_ROUTES.requests, 'الطلبات');
  assert.equal(resolved.returnTo, '/apps/paperwork/requests?q=ahmed&filter=preparation&page=3');
  assert.equal(resolved.returnLabel, 'الطلبات المفلترة');
  assert.equal(resolved.scrollTop, 420);
});

test('documents, vault, processor and related-detail contexts remain deterministic', () => {
  const cases = [
    ['/apps/paperwork/documents?q=VIN&filter=delivered&page=2', PAPERWORK_ROUTES.documents],
    ['/apps/paperwork/vault?q=engine', PAPERWORK_ROUTES.documents],
    ['/apps/paperwork/processors/processor-1', PAPERWORK_ROUTES.requests],
    ['/apps/paperwork/requests/request-1?tab=documents', PAPERWORK_ROUTES.documents],
    ['/apps/paperwork/documents/document-1', PAPERWORK_ROUTES.requests],
  ];
  for (const [returnTo, fallback] of cases) {
    assert.equal(resolvePaperworkReturnContext({ state: { paperworkReturnTo: returnTo } }, fallback).returnTo, returnTo);
  }
});

test('unsafe return targets are rejected in favor of detail fallbacks', () => {
  for (const target of ['https://evil.example', '//evil.example/path', '/apps/crm', 'javascript:alert(1)', '']) {
    assert.equal(isSafePaperworkReturnTo(target), false);
    assert.equal(
      resolvePaperworkReturnContext({ state: { paperworkReturnTo: target } }, PAPERWORK_ROUTES.documents).returnTo,
      PAPERWORK_ROUTES.documents,
    );
  }
  assert.equal(isSafePaperworkReturnTo('/apps/paperwork/requests/id?tab=documents'), true);
});

test('detail pages have direct-link fallbacks and URL-addressable request tabs', () => {
  const request = read('./pages/PaperworkRequestDetailsPage.jsx');
  const document = read('./pages/PaperworkDocumentDetailsPage.jsx');
  const processor = read('./pages/PaperworkProcessorDetailsPage.jsx');
  assert.match(request, /resolvePaperworkReturnContext\(location, PAPERWORK_ROUTES\.requests/);
  assert.match(document, /resolvePaperworkReturnContext\(location, PAPERWORK_ROUTES\.documents/);
  assert.match(processor, /resolvePaperworkReturnContext\(location, PAPERWORK_ROUTES\.processors/);
  assert.match(request, /params\.get\("tab"\)/);
  assert.match(request, /current\.set\("tab", item\.id\)/);
});

test('processors operational view has a contextual back to canonical requests', () => {
  const home = read('./pages/PaperworkHomePage.jsx');
  const processors = read('./pages/PaperworkProcessorsPage.jsx');
  assert.match(home, /PAPERWORK_ROUTES\.processors[\s\S]*createPaperworkNavigationState\(location/);
  assert.match(processors, /resolvePaperworkReturnContext\(location, PAPERWORK_ROUTES\.requests/);
  assert.match(processors, /contextualBack=\{contextualBack\}/);
  assert.doesNotMatch(processors, /navigate\(-1\)/);
});

test('paperwork header uses a compact navigation control and disables it at the app root', () => {
  const home = read('./pages/PaperworkHomePage.jsx');
  const header = read('../../core/ui/page-header.jsx');
  const page = read('./shared/PaperworkPage.jsx');
  const backButton = read('./shared/PaperworkBackButton.jsx');
  assert.match(home, /contextualBack=\{<PaperworkBackButton disabled \/>\}/);
  assert.doesNotMatch(home, /description="الملخص التشغيلي/);
  assert.match(header, /contextualBack[\s\S]*AppBreadcrumbs[\s\S]*<h1/);
  assert.match(backButton, /disabled=\{disabled\}/);
  assert.match(backButton, /لا توجد صفحة سابقة/);
  assert.match(page, /getCanonicalBreadcrumbs/);
  assert.match(page, /breadcrumbs=\{breadcrumbs\}/);
});

test('canonical entity ownership comes from platform route metadata', () => {
  assert.equal(getPlatformRouteMetadata(PAPERWORK_ROUTES.requestDetails('id')).section.to, PAPERWORK_ROUTES.root);
  assert.equal(getPlatformRouteMetadata(PAPERWORK_ROUTES.processorDetails('id')).section.to, PAPERWORK_ROUTES.processors);
  assert.equal(getPlatformRouteMetadata(PAPERWORK_ROUTES.documentDetails('id')).section.to, PAPERWORK_ROUTES.documents);
  const documentCrumbs = getCanonicalBreadcrumbs(PAPERWORK_ROUTES.documentDetails('id'), { currentLabel: 'مستند #55' });
  assert.equal(documentCrumbs[0].to, PAPERWORK_ROUTES.root);
  assert.equal(documentCrumbs[1].to, PAPERWORK_ROUTES.documents);
  assert.equal(documentCrumbs.at(-1).label, 'مستند #55');
});

test('source context changes back label without changing canonical breadcrumbs', () => {
  const vault = resolvePaperworkReturnContext({ state: {
    paperworkReturnTo: PAPERWORK_ROUTES.vault,
    paperworkReturnLabel: 'الخزنة',
  } }, PAPERWORK_ROUTES.documents, 'المستندات');
  assert.equal(vault.returnLabel, 'الخزنة');
  assert.equal(getCanonicalBreadcrumbs(PAPERWORK_ROUTES.documentDetails('id'), { currentLabel: 'جواب' })[1].label, 'المستندات');
  const direct = resolvePaperworkReturnContext({}, PAPERWORK_ROUTES.documents, 'المستندات');
  assert.equal(direct.returnLabel, 'المستندات');
});

test('manual receipt draft persists safe metadata and clears explicitly', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const identity = { tenantId: 'tenant-1', userId: 'user-1' };
  writeManualReceiptDraft(identity, {
    step: 3,
    unit: { id: 'unit-1', trackingNumber: 'VIN-1', secret: 'excluded' },
    ownerName: 'أحمد',
    requestId: 'request-1',
    photo: { name: 'jawab.jpg', type: 'image/jpeg', size: 1200, blob: 'excluded' },
  }, storage);
  const draft = readManualReceiptDraft(identity, storage);
  assert.equal(draft.step, 3);
  assert.equal(draft.unit.id, 'unit-1');
  assert.equal(draft.unit.secret, undefined);
  assert.deepEqual(draft.attachment, { name: 'jawab.jpg', type: 'image/jpeg', size: 1200, needsReselection: true });
  assert.equal(draft.photo, undefined);
  assert.equal(hasManualReceiptDraft(identity, storage), true);
  clearManualReceiptDraft(identity, storage);
  assert.equal(hasManualReceiptDraft(identity, storage), false);
});

test('manual receipt has one explicit and validated Inventory return contract', () => {
  assert.equal(PAPERWORK_TASK_ROUTES.manualReceipt(), '/apps/paperwork?flow=manual-receipt');
  const inventoryUrl = new URL(PAPERWORK_TASK_ROUTES.inventoryForManualReceipt(), 'https://local.test');
  assert.equal(inventoryUrl.pathname, '/apps/inventory/unique-units');
  assert.equal(inventoryUrl.searchParams.get('paperworkFlow'), 'manual-receipt');
  assert.equal(inventoryUrl.searchParams.get('returnTo'), '/apps/paperwork?flow=manual-receipt');
  const inventory = read('../inventory/pages/SerialUnitsPage.jsx');
  assert.match(inventory, /paperworkReturnTo[\s\S]*paperworkTrackingUnit/);
});

test('manual and bulk task flows guard unsaved work', () => {
  const manual = read('./manual-receipt/ManualReceiptFlow.jsx');
  const receiptHost = read('./manual-receipt/PaperworkManualReceipt.jsx');
  const bulk = read('./processors/BulkReceiptFlow.jsx');
  assert.match(manual, /beforeunload/);
  assert.match(receiptHost, /hasManualReceiptDraft[\s\S]*window\.confirm/);
  assert.match(bulk, /hasUnsavedChanges[\s\S]*window\.confirm/);
});

test('shared detail header owns canonical breadcrumbs and context-aware back', () => {
  const header = read('./shared/PaperworkDetailPage.jsx');
  for (const page of ['./pages/PaperworkRequestDetailsPage.jsx', './pages/PaperworkProcessorDetailsPage.jsx', './pages/PaperworkDocumentDetailsPage.jsx']) {
    assert.match(read(page), /PaperworkDetailPage/);
  }
  assert.match(header, /contextualBack/);
  assert.match(header, /returnContext\.returnLabel/);
});

test('canonical detail paths keep their owning Sidebar section active', () => {
  const sidebar = read('../../features/workspace/components/SidebarNav.jsx');
  assert.match(sidebar, /currentPath\.startsWith\(`\$\{href\}\/`\)/);
  assert.equal(PAPERWORK_ROUTES.requestDetails('id').startsWith(`${PAPERWORK_ROUTES.requests}/`), true);
  assert.equal(PAPERWORK_ROUTES.processorDetails('id').startsWith(`${PAPERWORK_ROUTES.processors}/`), true);
  assert.equal(PAPERWORK_ROUTES.documentDetails('id').startsWith(`${PAPERWORK_ROUTES.documents}/`), true);
});

test('architecture refinement adds no duplicate detail routes or navigation loops', () => {
  const router = read('../../app/router/AppRouter.jsx');
  for (const route of ['requests/:requestId', 'processors/:processorId', 'documents/:documentId']) {
    assert.equal(router.split(`path="${route}"`).length - 1, 1);
  }
  assert.doesNotMatch(router, /vault\/documents\/:|processors\/:processorId\/requests\/:/);
  assert.doesNotMatch(read('./routes/paperworkNavigation.js'), /navigate\(-1\)|history\.back/);
});

test('requests list is a dedicated page and preserves search params', () => {
  const router = read('../../app/router/AppRouter.jsx');
  assert.match(router, /path="requests" element=\{<PaperworkRequestsPage \/>\}/);
  assert.notEqual(PAPERWORK_ROUTES.requests, PAPERWORK_ROUTES.root);
  assert.equal(PAPERWORK_ROUTES.legacyRequests, '/apps/paperwork/requests');
});

test('list pages synchronize URL state with back-forward navigation', () => {
  const requests = read('./pages/PaperworkRequestsPage.jsx');
  const documents = read('./shared/DocumentListPage.jsx');
  const vault = read('./pages/PaperworkVaultPage.jsx');
  for (const source of [requests, documents, vault]) {
    assert.match(source, /useSearchParams/);
    assert.match(source, /setSearch\(querySearch\)/);
  }
  assert.match(requests, /params\.get\('page'\)/);
  assert.match(documents, /params\.get\("page"\)/);
});

test('cross-entity links all carry the central navigation state', () => {
  for (const path of [
    './pages/PaperworkRequestsPage.jsx',
    './pages/PaperworkProcessorsPage.jsx',
    './pages/PaperworkProcessorDetailsPage.jsx',
    './pages/PaperworkVaultPage.jsx',
    './shared/DocumentListPage.jsx',
    './requests/RequestDetailsTabs.jsx',
    './documents/DocumentContext.jsx',
  ]) assert.match(read(path), /createPaperworkNavigationState/);
});

test('navigation polish does not change app access or action permissions', () => {
  const navigation = [
    read('./routes/paperworkNavigation.js'),
    read('../../core/ui/app-breadcrumbs.jsx'),
    read('./hooks/usePaperworkListScroll.js'),
  ].join('\n');
  assert.doesNotMatch(navigation, /auth_permissions|resource_scope|PAPERWORK_PERMISSIONS|has_permission|create policy/i);
});
