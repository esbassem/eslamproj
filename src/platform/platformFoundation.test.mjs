import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { adaptLegacyAppContext } from './access/platformAccessAdapter.js';
import { adaptLegacyInstalledApp } from './navigation/legacyNavigationAdapter.js';
import { createNavigationRegistry, validateAppRegistration } from './navigation/navigationRegistry.js';
import { resolveNavigationMode } from './navigation/navigationResolver.js';
import { resolveBreadcrumbs } from './routing/breadcrumbResolver.js';
import { createRouteManifest } from './routing/routeManifest.js';
import { resolveShellPolicy } from './shell/shellPolicy.js';

const sampleApp = { code: 'sample', name: 'تطبيق تجريبي', href: '/apps/sample', navigation: { mode: 'sidebar', items: [] }, shell: { contentWidth: 'wide', variant: 'standard' } };

test('app manifest validates and rejects duplicate or unsupported registrations', () => {
  assert.equal(validateAppRegistration(sampleApp), true);
  assert.equal(createNavigationRegistry([sampleApp]).get('sample').shell.contentWidth, 'wide');
  assert.throws(() => createNavigationRegistry([sampleApp, sampleApp]), /Duplicate app registration/);
  assert.throws(() => validateAppRegistration({ ...sampleApp, navigation: { mode: 'drawer' } }), /Unsupported navigation mode/);
});

test('navigation and shell policy resolve route overrides before app defaults', () => {
  const routeMetadata = { shell: { navigation: 'none', contentWidth: 'compact', variant: 'wide' } };
  assert.equal(resolveNavigationMode({ appRegistration: sampleApp }), 'sidebar');
  assert.deepEqual(resolveShellPolicy({ appRegistration: sampleApp, routeMetadata }), { navigation: 'none', contentWidth: 'compact', variant: 'wide', topBar: true, topBarDivider: true, appIdentity: true, breadcrumbs: true });
});

test('route metadata resolves static and dynamic routes without loading entity data', () => {
  const manifest = createRouteManifest([
    { id: 'sample.details', path: '/apps/sample/:entityId', appCode: 'sample', title: 'التفاصيل', breadcrumb: ({ currentLabel }) => currentLabel, shell: { navigation: 'sidebar' } },
    { id: 'sample.new', path: '/apps/sample/new', appCode: 'sample', title: 'جديد' },
  ]);
  const match = manifest.resolve('/apps/sample/abc-123');
  assert.equal(match.route.id, 'sample.details');
  assert.equal(match.params.entityId, 'abc-123');
  assert.equal(manifest.resolve('/apps/sample/new').route.id, 'sample.new');
  assert.equal(manifest.resolve('/apps/another/abc-123'), null);
});

test('breadcrumb resolver composes platform, app, section and dynamic current label', () => {
  const items = resolveBreadcrumbs({
    appRegistration: sampleApp,
    routeMetadata: { section: { label: 'السجلات', to: '/apps/sample/list' }, title: 'التفاصيل' },
    context: { currentLabel: 'سجل 42' },
  });
  assert.deepEqual(items.map((item) => item.label), ['الرئيسية', 'تطبيق تجريبي', 'السجلات', 'سجل 42']);
});

test('application landing route does not repeat a default overview label', () => {
  const items = resolveBreadcrumbs({
    appRegistration: sampleApp,
    routeMetadata: { path: '/apps/sample', title: 'نظرة عامة' },
  });
  assert.deepEqual(items.map((item) => item.label), ['الرئيسية', 'تطبيق تجريبي']);
});

test('application landing route still accepts explicitly published context', () => {
  const items = resolveBreadcrumbs({
    appRegistration: sampleApp,
    routeMetadata: { path: '/apps/sample', title: 'نظرة عامة' },
    context: { currentLabel: 'سياق حالي' },
  });
  assert.deepEqual(items.map((item) => item.label), ['الرئيسية', 'تطبيق تجريبي', 'سياق حالي']);
});

test('legacy adapters normalize current context data without importing legacy modules', () => {
  const legacyApp = adaptLegacyInstalledApp({ code: 'sample', name: 'قديم', href: '/apps/sample' }, { navigationMode: 'sidebar', menus: [{ code: 'sample.list', name: 'القائمة', routePath: '/apps/sample/list' }] });
  assert.equal(legacyApp.navigation.items[0].to, '/apps/sample/list');
  const access = adaptLegacyAppContext({ apps: [{ code: 'sample', active: true }, { code: 'off', active: false }], activeMenus: legacyApp.navigation.items, appsStatus: 'ready', menusStatus: 'ready' });
  assert.equal(access.isAppAvailable('sample'), true);
  assert.equal(access.isAppAvailable('off'), false);
  assert.equal(access.menus.length, 1);
});

function filesUnder(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const target = path.join(directory, entry);
    return statSync(target).isDirectory() ? filesUnder(target) : [target];
  });
}

test('platform implementation has no feature imports or hard-coded app exceptions', () => {
  const root = path.resolve('src/platform');
  const sources = filesUnder(root).filter((file) => /\.(js|jsx)$/.test(file) && !file.endsWith('.test.mjs')).map((file) => readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(sources, /from\s+['"]@\/features\//);
  assert.doesNotMatch(sources, /if\s*\([^)]*appCode\s*===\s*['"]/);
});

test('platform internal relative imports are acyclic', () => {
  const root = path.resolve('src/platform');
  const files = filesUnder(root).filter((file) => /\.(js|jsx)$/.test(file));
  const graph = new Map(files.map((file) => {
    const source = readFileSync(file, 'utf8');
    const imports = [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((match) => {
      const base = path.resolve(path.dirname(file), match[1]);
      return [base, `${base}.js`, `${base}.jsx`, path.join(base, 'index.js')].find((candidate) => files.includes(candidate));
    }).filter(Boolean);
    return [file, imports];
  }));
  const visiting = new Set();
  const visited = new Set();
  function visit(file) {
    if (visiting.has(file)) throw new Error(`Platform import cycle detected at ${path.relative(root, file)}`);
    if (visited.has(file)) return;
    visiting.add(file);
    graph.get(file)?.forEach(visit);
    visiting.delete(file);
    visited.add(file);
  }
  files.forEach(visit);
  assert.equal(visited.size, files.length);
});
