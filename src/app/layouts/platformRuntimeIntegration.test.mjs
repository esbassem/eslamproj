import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { adaptLegacyRouteMetadata, canActivateLegacyApp, getLegacyVisibleMenus, resolveLegacyRuntimePolicy } from './platformRuntimeCompatibility.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const routerSource = read('../router/AppRouter.jsx');
const runtimeSource = read('./PlatformRuntimeLayout.jsx');
const legacyHostSource = read('./AppLayout.jsx');
const platformShellSource = read('../../platform/shell/PlatformShell.jsx');
const mobileNavigationSource = read('../../platform/navigation/MobileAppNavigation.jsx');

test('authenticated application routes render through PlatformRuntimeLayout', () => {
  assert.match(routerSource, /<Route element=\{<ProtectedRoute \/>\}>[\s\S]*<Route element=\{<PlatformRuntimeLayout \/>\}>[\s\S]*modeRoutes\.map/);
  assert.match(runtimeSource, /<PlatformShell[\s\S]*\{outlet\}[\s\S]*<\/PlatformShell>/);
});

test('legacy AppLayout remains a compatibility content host', () => {
  assert.match(legacyHostSource, /export function LegacyAppHost/);
  assert.match(legacyHostSource, /<Suspense[\s\S]*\{outlet\}/);
  assert.doesNotMatch(legacyHostSource, /<AppSidebar|<AppTopbar/);
});

test('runtime compatibility resolves sidebar, none and fullBleed policies', () => {
  assert.equal(resolveLegacyRuntimePolicy('dashboard', '/admin').topBarDivider, false);
  assert.equal(resolveLegacyRuntimePolicy('dashboard', '/admin').appIdentity, false);
  assert.equal(resolveLegacyRuntimePolicy('products', '/apps/inventory').navigationMode, 'sidebar');
  assert.equal(resolveLegacyRuntimePolicy('sales', '/app/sales').navigationMode, 'sidebar');
  assert.deepEqual(
    resolveLegacyRuntimePolicy('receivables', '/app/receivables'),
    { navigationMode: 'none', contentWidth: 'fullBleed', variant: 'fullBleed', topBar: false, topBarDivider: true, appIdentity: true, breadcrumbs: false },
  );
  assert.equal(resolveLegacyRuntimePolicy('pos', '/app/pos/location/session/session-id/sell').topBar, false);
});

test('legacy route metadata supplies a safe fallback for applications awaiting adoption', () => {
  const fallback = adaptLegacyRouteMetadata('/apps/unknown/deep-link', 'unknown', resolveLegacyRuntimePolicy('unknown'));
  assert.equal(fallback.appCode, 'unknown');
  assert.equal(fallback.path, '/apps/unknown/deep-link');
  assert.doesNotMatch(read('./platformRuntimeCompatibility.js'), /\bsales\s*:/);
});

test('legacy root menu containers are not duplicated in platform navigation', () => {
  const child = { id: 'child', routePath: '/apps/sample/list' };
  assert.deepEqual(getLegacyVisibleMenus([{ id: 'root', appCode: 'sample', children: [child] }], 'sample'), [child]);
  assert.deepEqual(getLegacyVisibleMenus([{ id: 'other', appCode: 'other', children: [] }], 'sample'), []);
});

test('legacy owner settings availability remains in the compatibility boundary', () => {
  assert.equal(canActivateLegacyApp({ appCode: 'settings', appAvailable: false, userRole: 'owner' }), true);
  assert.equal(canActivateLegacyApp({ appCode: 'settings', appAvailable: false, userRole: 'member' }), false);
});

test('platform owns top bar, navigation, content, mobile navigation and shell boundaries', () => {
  assert.match(platformShellSource, /<PlatformTopBar/);
  assert.match(platformShellSource, /<AppSidebar/);
  assert.match(platformShellSource, /<PlatformContent/);
  assert.match(platformShellSource, /<MobileAppNavigation/);
  assert.match(platformShellSource, /policy\.topBar/);
  assert.match(mobileNavigationSource, /role="dialog"/);
});

test('platform route boundary recovers lazy chunk failures and keeps a visible retry', () => {
  assert.match(platformShellSource, /componentDidCatch\(error, errorInfo\)/);
  assert.match(platformShellSource, /dynamically imported module\|loading chunk\|failed to fetch\|module script/i);
  assert.match(platformShellSource, /businesshub:chunk-retry:/);
  assert.match(platformShellSource, /window\.location\.reload\(\)/);
  assert.match(platformShellSource, /إعادة المحاولة/);
  assert.match(platformShellSource, /<ShellRouteContent pathname=\{location\.pathname\}>/);
  assert.match(platformShellSource, /\[PlatformShell\] Route rendering failed\./);
  assert.match(platformShellSource, /import\.meta\.env\.DEV/);
});

test('platform implementation does not import features and contains no app-code exceptions', () => {
  const platformFiles = [
    '../../platform/shell/PlatformShell.jsx',
    '../../platform/shell/shellPolicy.js',
    '../../platform/navigation/navigationResolver.js',
    '../../platform/routing/breadcrumbResolver.js',
  ].map(read).join('\n');
  assert.doesNotMatch(platformFiles, /@\/features|\.\.\/\.\.\/features/);
  assert.doesNotMatch(platformFiles, /appCode\s*[!=]==?\s*['"]/);
});

test('primary and deep-link routes remain registered inside the runtime shell boundary', () => {
  for (const routeContract of [
    /path=\{ROUTES\.sales\}/,
    /path=":saleId"/,
    /path="\/apps\/paperwork"/,
    /path="requests\/:requestId"/,
    /path="\/apps\/accounting"/,
    /path="\/app\/receivables"/,
    /path="\/apps\/accountant"/,
    /path="\/app\/pos\/:posId\/session\/:sessionId\/sell"/,
    /path="\/apps\/:appCode"/,
  ]) assert.match(routerSource, routeContract);
});
