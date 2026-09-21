import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getCanonicalBreadcrumbs, getPlatformRouteMetadata } from './platformNavigation.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('platform home is the first canonical breadcrumb', () => {
  for (const path of ['/apps/inventory/unique-units', '/app/sales']) {
    assert.equal(getCanonicalBreadcrumbs(path, { currentLabel: '#123' })[0].to, '/app');
  }
});

test('Paperwork breadcrumbs start at the application and express its primary sections', () => {
  const request = getCanonicalBreadcrumbs('/apps/paperwork/requests/123', { currentLabel: 'طلب #123' });
  assert.deepEqual(request.map((item) => item.label), ['إدارة أوراق الملكية', 'طلبات الأوراق', 'طلب #123']);
  const processor = getCanonicalBreadcrumbs('/apps/paperwork/processors/123', { currentLabel: 'جهة الإصدار' });
  assert.deepEqual(processor.map((item) => item.label), ['إدارة أوراق الملكية', 'طلبات الأوراق', 'عند الجهات', 'جهة الإصدار']);
  const document = getCanonicalBreadcrumbs('/apps/paperwork/documents/123', { currentLabel: 'مستند #123' });
  assert.deepEqual(document.map((item) => item.label), ['إدارة أوراق الملكية', 'المستندات', 'مستند #123']);
});

test('canonical detail metadata resolves its owning section by longest match', () => {
  assert.equal(getPlatformRouteMetadata('/apps/paperwork/requests/123').section.label, 'طلبات الأوراق');
  assert.equal(getPlatformRouteMetadata('/apps/paperwork/processors/123').section.label, 'عند الجهات');
  assert.equal(getPlatformRouteMetadata('/apps/paperwork/documents/123').section.label, 'المستندات');
});

test('shared platform home never uses browser history', () => {
  const home = read('../ui/platform-home-link.jsx');
  const shell = read('../ui/workspace-app-layout.jsx');
  const runtimeShell = read('../../app/layouts/PlatformRuntimeLayout.jsx');
  const platformTopBar = read('../../platform/shell/PlatformTopBar.jsx');
  assert.match(home, /to=\{ROUTES\.app\}/);
  assert.match(shell, /PlatformHomeLink/);
  assert.match(runtimeShell, /PlatformShell/);
  assert.match(platformTopBar, /to=\{home\.to\}/);
  assert.doesNotMatch(`${home}\n${shell}\n${platformTopBar}`, /navigate\(-1\)|history\.back/);
});

test('breadcrumb rendering is accessible and does not load data', () => {
  const source = read('../ui/app-breadcrumbs.jsx');
  assert.match(source, /aria-label="مسار التنقل"/);
  assert.match(source, /aria-current/);
  assert.doesNotMatch(source, /supabase|fetch\(|\.from\(/);
});
