import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { createNavigationRegistry } from '../../../platform/navigation/navigationRegistry.js';
import { createRouteManifest } from '../../../platform/routing/routeManifest.js';
import { resolveBreadcrumbs } from '../../../platform/routing/breadcrumbResolver.js';
import { SALES_ROUTES } from '../routes/salesRoutes.js';
import { SALES_APP_REGISTRATION, SALES_ROUTE_METADATA } from './salesPlatformRegistration.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('Sales has a valid official app registration with no application navigation', () => {
  const registration = createNavigationRegistry([SALES_APP_REGISTRATION]).get('sales');
  assert.equal(registration.name, 'المبيعات');
  assert.equal(registration.href, SALES_ROUTES.overview);
  assert.equal(registration.navigation.mode, 'none');
  assert.equal(registration.shell.contentWidth, 'wide');
  assert.equal(registration.shell.breadcrumbs, true);
});

test('official metadata covers every Sales route and static routes beat details', () => {
  const manifest = createRouteManifest(SALES_ROUTE_METADATA);
  const expected = [
    [SALES_ROUTES.overview, 'sales.overview'],
    [SALES_ROUTES.legacyList, 'sales.list-redirect'],
    [SALES_ROUTES.create, 'sales.create'],
    [SALES_ROUTES.branch('branch-42'), 'sales.branch'],
    [SALES_ROUTES.legacyInvoices, 'sales.invoices'],
    [SALES_ROUTES.legacyContracts, 'sales.contracts-redirect'],
    [SALES_ROUTES.details('sale-42'), 'sales.details'],
  ];
  expected.forEach(([pathname, id]) => assert.equal(manifest.resolve(pathname)?.route.id, id));
  assert.equal(manifest.resolve(SALES_ROUTES.details('sale-42')).params.saleId, 'sale-42');
  assert.equal(manifest.resolve(SALES_ROUTES.branch('branch-42')).params.branchId, 'branch-42');
});

test('Sales breadcrumbs use metadata and accept page-owned dynamic entity context', () => {
  const manifest = createRouteManifest(SALES_ROUTE_METADATA);
  const details = manifest.resolve(SALES_ROUTES.details('sale-42')).route;
  const items = resolveBreadcrumbs({
    appRegistration: SALES_APP_REGISTRATION,
    routeMetadata: details,
    context: { currentLabel: 'SAL-0042' },
  });
  assert.deepEqual(items.map((item) => item.label), ['الرئيسية', 'المبيعات', 'SAL-0042']);
});

test('Sales landing identifies the application without a redundant overview crumb', () => {
  const manifest = createRouteManifest(SALES_ROUTE_METADATA);
  const overview = manifest.resolve(SALES_ROUTES.overview).route;
  const items = resolveBreadcrumbs({
    appRegistration: SALES_APP_REGISTRATION,
    routeMetadata: overview,
  });
  assert.deepEqual(items.map((item) => item.label), ['الرئيسية', 'المبيعات']);
});

test('Sales is composed officially and has no legacy shell or duplicate route bar', () => {
  const runtime = read('../../../app/layouts/PlatformRuntimeLayout.jsx');
  const compatibility = read('../../../app/layouts/platformRuntimeCompatibility.js');
  const router = read('../../../app/router/AppRouter.jsx');
  const shell = read('../components/SalesPageShell.jsx');
  assert.match(runtime, /OFFICIAL_APP_REGISTRY/);
  assert.match(runtime, /OFFICIAL_ROUTE_MANIFEST/);
  assert.doesNotMatch(compatibility, /\bsales\s*:/);
  assert.match(router, /path=\{ROUTES\.sales\}[\s\S]*element=\{<AppAccessRoute appCode="sales" \/>\}/);
  assert.doesNotMatch(router, /SalesWorkspaceLayout/);
  assert.doesNotMatch(shell, /SalesRouteBar|aria-label="مسار التنقل"|useLocation|URLSearchParams|-mx-/);
  assert.equal(existsSync(new URL('../layouts/SalesWorkspaceLayout.jsx', import.meta.url)), false);
});

test('platform remains independent from the Sales feature', () => {
  const platformShell = read('../../../platform/shell/PlatformShell.jsx');
  const platformIndex = read('../../../platform/index.js');
  assert.doesNotMatch(`${platformShell}\n${platformIndex}`, /features\/sales|appCode\s*===\s*['"]sales/);
});
