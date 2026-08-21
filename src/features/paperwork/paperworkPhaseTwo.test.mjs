import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('canonical Paperwork routes are real lazy route owners', () => {
  const router = read('../../app/router/AppRouter.jsx');
  for (const route of ['requests', 'requests/:requestId', 'processors', 'processors/:processorId', 'vault', 'documents', 'documents/:documentId']) {
    assert.match(router, new RegExp(`path="${route.replace(/[/:]/g, '\\$&')}"`));
  }
  assert.doesNotMatch(router, /PaperworkWorkspacePage/);
  assert.match(router, /AppAccessRoute appCode="paperwork"[\s\S]*?<AppLayout \/>/);
  assert.doesNotMatch(router, /PaperworkWorkspaceLayout/);
});

test('Paperwork navigation is owned by the central app shell', () => {
  const migration = read('../../../supabase/migrations/20260821190000_align_paperwork_app_navigation.sql');
  for (const code of ['paperwork.root', 'paperwork.requests', 'paperwork.processors', 'paperwork.vault', 'paperwork.documents']) {
    assert.match(migration, new RegExp(code.replace('.', '\\.')));
  }
  assert.equal(existsSync(new URL('./layouts/PaperworkWorkspaceLayout.jsx', import.meta.url)), false);
});

test('detail pages use deterministic Paperwork back routes', () => {
  assert.match(read('./pages/PaperworkRequestDetailsPage.jsx'), /PAPERWORK_ROUTES\.requests/);
  assert.match(read('./pages/PaperworkProcessorDetailsPage.jsx'), /PAPERWORK_ROUTES\.processors/);
  const documentDetails = read('./pages/PaperworkDocumentDetailsPage.jsx');
  assert.match(documentDetails, /paperworkBackTo/);
  assert.match(documentDetails, /PAPERWORK_ROUTES\.documents/);
  for (const source of [
    read('./pages/PaperworkRequestDetailsPage.jsx'),
    read('./pages/PaperworkDocumentDetailsPage.jsx'),
    read('./pages/PaperworkProcessorDetailsPage.jsx'),
  ]) assert.doesNotMatch(source, /navigate\(-1\)/);
});

test('list routes use summary contracts rather than workspace data', () => {
  const requests = read('./pages/PaperworkRequestsPage.jsx');
  const vault = read('./pages/PaperworkVaultPage.jsx');
  const documents = read('./shared/DocumentListPage.jsx');
  assert.match(requests, /listRequestSummaries/);
  assert.match(vault, /listVaultPaperworkSummary/);
  assert.match(documents, /listDocumentSummaries/);
  for (const source of [requests, vault, documents]) assert.doesNotMatch(source, /usePaperworkWorkspaceData|listPaperworkDocuments/);
});

test('requests filters do not expose the needs-action tab', () => {
  const viewModels = read('./adapters/paperworkViewModels.js');
  const filters = viewModels.match(/REQUEST_FILTERS[\s\S]*?\]\);/)?.[0] || '';
  assert.doesNotMatch(filters, /id:\s*['"]action['"]|يحتاج إجراء/);
});

test('details and manual receipt are composed and legacy workspace is removed', () => {
  const requestDetails = read('./pages/PaperworkRequestDetailsPage.jsx');
  for (const component of ['RequestDocumentsTab', 'RequestActivityTab', 'DeliveryBalanceSummary']) assert.match(requestDetails, new RegExp(component));
  assert.match(read('./pages/PaperworkDocumentDetailsPage.jsx'), /DocumentActions.*DocumentContext/s);
  assert.match(read('./manual-receipt/ManualReceiptFlow.jsx'), /CompleteTrackingUnitWizard/);
  assert.equal(existsSync(new URL('./pages/PaperworkWorkspacePage.jsx', import.meta.url)), false);
  assert.equal(existsSync(new URL('./components/PaperworkRequestDetailsDrawer.jsx', import.meta.url)), false);
});

test('Phase 2 does not introduce authorization or database workflow changes', () => {
  const source = [read('./services/queries/paperworkRead.service.js'), read('./requests/RequestActions.jsx'), read('./documents/DocumentActions.jsx')].join('\n');
  assert.doesNotMatch(source, /auth_permissions|resource_scope|create policy|alter table/i);
});
