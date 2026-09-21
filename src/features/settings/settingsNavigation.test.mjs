import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getSettingsNavigationItems,
  getSettingsSectionKey,
  resolveActiveSettingsMenu,
} from './settingsNavigation.js';

const expected = [
  ['settings.general', '/app/settings', 10],
  ['settings.financial_setup', '/app/settings/financial', 15],
  ['settings.branches', '/app/settings/branches', 30],
  ['settings.pos', '/app/settings?section=pos', 40],
  ['settings.team', '/app/settings/team', 50],
  ['settings.permissions', '/app/settings/permissions', 60],
];

function menuRows() {
  const root = { id: 'root', moduleId: 'settings-module', moduleTechnicalName: 'settings', parentId: null, code: 'settings.root', name: 'Settings', routePath: '/app/settings', sequence: 10, active: true };
  return [root, ...expected.map(([code, routePath, sequence]) => ({
    id: code,
    moduleId: 'settings-module',
    moduleTechnicalName: 'settings',
    parentId: root.id,
    code,
    name: code,
    routePath,
    sequence,
    active: true,
  }))];
}

function settingsTree(role = 'owner') {
  const rows = menuRows();
  const root = { ...rows[0], href: rows[0].routePath, sortOrder: rows[0].sequence, children: [] };
  root.children = rows.slice(1)
    .filter((menu) => role === 'owner' || !['settings.branches', 'settings.permissions'].includes(menu.code))
    .map((menu) => ({ ...menu, href: menu.routePath, sortOrder: menu.sequence, children: [] }));
  return [root];
}

test('Settings navigation is derived from canonical menu data in sequence order', () => {
  const items = getSettingsNavigationItems(settingsTree(), { isOwner: true });
  assert.deepEqual(items.map((item) => item.code), expected.map(([code]) => code));
  assert.deepEqual(items.map(getSettingsSectionKey), ['general', 'financial_setup', 'branches', 'pos', 'team', 'permissions']);
});

test('canonical Settings routes resolve General, Financial Setup, POS, Branches, Team, and Permissions', () => {
  const items = getSettingsNavigationItems(settingsTree(), { isOwner: true });
  const cases = [
    ['/app/settings', '', 'settings.general'],
    ['/app/settings/financial', '', 'settings.financial_setup'],
    ['/app/settings/financial/money-destinations', '', 'settings.financial_setup'],
    ['/app/settings/financial/payment-methods', '', 'settings.financial_setup'],
    ['/app/settings', '?section=accounting&tab=journals', 'settings.general'],
    ['/app/settings', '?section=payments', 'settings.general'],
    ['/app/settings', '?section=pos', 'settings.pos'],
    ['/app/settings/branches', '', 'settings.branches'],
    ['/app/settings/team', '', 'settings.team'],
    ['/app/settings/permissions', '', 'settings.permissions'],
  ];
  for (const [pathname, search, code] of cases) {
    assert.equal(resolveActiveSettingsMenu(items, { pathname, search })?.code, code);
  }
});

test('non-owners cannot see Owner-only Settings menu rows in either menu layer', () => {
  const tree = settingsTree('staff');
  const items = getSettingsNavigationItems(tree, { isOwner: false });
  assert.equal(items.some((item) => item.code === 'settings.branches'), false);
  assert.equal(items.some((item) => item.code === 'settings.permissions'), false);
  const service = readFileSync(new URL('../../services/apps.service.js', import.meta.url), 'utf8');
  assert.match(service, /menu\.code !== 'settings\.branches'/);
  assert.match(service, /menu\.code !== 'settings\.permissions'/);
});

test('unknown or missing routes fall back safely without adding a local menu definition', () => {
  const items = getSettingsNavigationItems(settingsTree(), { isOwner: true });
  assert.equal(resolveActiveSettingsMenu(items, { pathname: '/app/settings', search: '?section=unknown' })?.code, 'settings.general');
  assert.equal(resolveActiveSettingsMenu(items, { pathname: '/app/settings/not-registered' }), null);
});

test('top-level labels, icons, and order are not hardcoded by SettingsSectionNav', () => {
  const source = readFileSync(new URL('./components/SettingsSectionNav.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /const sections\s*=/);
  for (const label of ['عام', 'الفروع', 'نقاط البيع', 'المستخدمون والفريق', 'الأدوار والصلاحيات']) {
    assert.doesNotMatch(source, new RegExp(`title: '${label}'`));
  }
  assert.match(source, /resolveModuleIcon\(menu\.icon\)/);
  assert.match(source, /items\.map/);
});

test('legacy accounting tabs are absent from Settings navigation', () => {
  const source = readFileSync(new URL('./components/SettingsSectionNav.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /accountingTabs|activeAccountingTab|onAccountingTabChange/);
});

test('all canonical Settings menu routes retain a frontend route/component destination', () => {
  const registry = readFileSync(new URL('../../app/router/menuRegistry.js', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../../core/config/routes.config.js', import.meta.url), 'utf8');
  assert.match(registry, /'\/app\/settings', '\/app\/settings\/financial', '\/app\/settings\/financial\/money-destinations', '\/app\/settings\/financial\/payment-methods', '\/app\/settings\/branches', '\/app\/settings\/team', '\/app\/settings\/permissions'/);
  assert.match(routes, /settings: '\/app\/settings'/);
  assert.match(routes, /settingsFinancial: '\/app\/settings\/financial'/);
  assert.match(routes, /settingsMoneyDestinations: '\/app\/settings\/financial\/money-destinations'/);
  assert.match(routes, /settingsPaymentMethods: '\/app\/settings\/financial\/payment-methods'/);
  assert.match(routes, /settingsBranches: '\/app\/settings\/branches'/);
  assert.match(routes, /settingsTeam: '\/app\/settings\/team'/);
  assert.match(routes, /settingsPermissions: '\/app\/settings\/permissions'/);
});

test('Money Destinations is a canonical child of Financial Setup', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20260903123000_add_money_destinations_settings_menu.sql', import.meta.url), 'utf8');
  assert.match(sql, /code = 'settings\.financial_setup'/);
  assert.match(sql, /'settings\.money_destinations', '\/app\/settings\/financial\/money-destinations'/);
  assert.match(sql, /parent_id = v_financial_setup_id/);
  const nav = readFileSync(new URL('./components/SettingsSectionNav.jsx', import.meta.url), 'utf8');
  assert.match(nav, /menu\.children\.map/);
  assert.match(nav, /onMenuSelect\?\.\(child\)/);
  assert.doesNotMatch(nav, /settings\.money_destinations/);
});

test('a menu parent keeps its own route and expands children with a separate control', () => {
  const nav = readFileSync(new URL('../workspace/components/SidebarNav.jsx', import.meta.url), 'utf8');
  assert.match(nav, /if \(hasChildren\)[\s\S]*?<NavLink[\s\S]*?to=\{item\.href\}/);
  assert.match(nav, /<button[\s\S]*?onClick=\{onToggle\}[\s\S]*?aria-expanded=\{isExpanded\}/);
  assert.match(nav, /containsActiveHref\(item, activeHref\)/);
  assert.match(nav, /if \(isBranchActive\) setIsExpanded\(true\)/);
  const expandButton = nav.match(/<button\s+type="button"\s+onClick=\{onToggle\}[\s\S]*?<\/button>/)?.[0];
  assert.ok(expandButton);
  assert.doesNotMatch(expandButton, /\{content\}/);
});

test('Financial Setup is registered by canonical menu data without a local navigation entry', () => {
  const navigation = readFileSync(new URL('./settingsNavigation.js', import.meta.url), 'utf8');
  const page = readFileSync(new URL('./pages/SettingsPage.jsx', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../../../supabase/migrations/20260903121000_add_financial_setup_settings_menu.sql', import.meta.url), 'utf8');
  assert.equal(getSettingsNavigationItems(settingsTree(), { isOwner: true }).some((item) => item.code === 'settings.financial_setup'), true);
  assert.doesNotMatch(page, /navigationItems\s*=\s*\[/);
  assert.match(navigation, /'settings\.financial_setup': 'financial_setup'/);
  assert.match(migration, /'settings\.financial_setup', '\/app\/settings\/financial', 'WalletCards', 15, true/);
  assert.match(migration, /parent_id = v_settings_root_id/);
});

test('forward migration defines one canonical child per current Settings section', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20260903120000_unify_settings_navigation.sql', import.meta.url), 'utf8');
  assert.match(sql, /technical_name = 'settings'/);
  assert.match(sql, /code = 'settings\.root'/);
  for (const [code, route, sequence] of expected.filter(([code]) => code !== 'settings.financial_setup')) {
    assert.match(sql, new RegExp(`\\('${code.replaceAll('.', '\\.')}', '${route.replaceAll('?', '\\?')}', ${sequence}\\)`));
  }
  assert.match(sql, /having count\(\*\) <> 1/);
  assert.match(sql, /parent_id = v_settings_root_id/);
});
