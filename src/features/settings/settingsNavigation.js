const SETTINGS_ROOT_CODE = 'settings.root';
const OWNER_ONLY_CODES = new Set(['settings.branches', 'settings.permissions']);

const sectionKeysByCode = Object.freeze({
  'settings.general': 'general',
  'settings.branches': 'branches',
  'settings.accounting': 'accounting',
  'settings.pos': 'pos',
  'settings.team': 'team',
  'settings.permissions': 'permissions',
});

function normalizePath(value = '') {
  return String(value).split('#')[0].split('?')[0].replace(/\/+$/, '') || '/';
}

function menuChildren(settingsMenus = []) {
  if (settingsMenus.length === 1 && settingsMenus[0]?.code === SETTINGS_ROOT_CODE) {
    return settingsMenus[0].children ?? [];
  }

  const root = settingsMenus.find((menu) => menu.code === SETTINGS_ROOT_CODE);
  return root?.children?.length ? root.children : settingsMenus.filter((menu) => menu.code !== SETTINGS_ROOT_CODE);
}

export function getSettingsNavigationItems(settingsMenus = [], { isOwner = false } = {}) {
  return menuChildren(settingsMenus)
    .filter((menu) => sectionKeysByCode[menu.code] && menu.active !== false)
    .filter((menu) => isOwner || !OWNER_ONLY_CODES.has(menu.code))
    .sort((first, second) => (
      Number(first.sortOrder ?? first.sequence ?? 10) - Number(second.sortOrder ?? second.sequence ?? 10)
      || String(first.name ?? '').localeCompare(String(second.name ?? ''), 'ar')
    ));
}

export function getSettingsSectionKey(menu) {
  return sectionKeysByCode[menu?.code] ?? null;
}

export function resolveActiveSettingsMenu(items, { pathname = '', search = '' } = {}) {
  const currentPath = normalizePath(pathname);
  const params = new URLSearchParams(search);
  const requestedSection = params.get('section');

  if (currentPath === '/app/settings') {
    const requestedCode = requestedSection === 'payments'
      ? 'settings.accounting'
      : requestedSection
        ? `settings.${requestedSection}`
        : 'settings.general';
    return items.find((menu) => menu.code === requestedCode)
      ?? items.find((menu) => menu.code === 'settings.general')
      ?? null;
  }

  return items
    .filter((menu) => normalizePath(menu.href ?? menu.routePath) === currentPath)
    .sort((first, second) => String(second.href ?? '').length - String(first.href ?? '').length)[0]
    ?? null;
}

export function getSettingsMenuHref(menu) {
  return menu?.href || menu?.routePath || '';
}
