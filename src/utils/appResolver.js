import { ROUTES } from '@/core/config/routes.config';

export const LEGACY_ROUTE_APP_CODES = {
  [ROUTES.dashboard]: 'dashboard',
  [ROUTES.partners]: 'partners',
  [ROUTES.products]: 'products',
  [ROUTES.inventory]: 'inventory',
  [ROUTES.adminPos]: 'pos',
  [ROUTES.invoices]: 'sales',
  [ROUTES.payments]: 'accounting',
  [ROUTES.contracts]: 'contracts',
  [ROUTES.settings]: 'settings',
  [ROUTES.team]: 'team',
};

export function normalizeAppCode(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

export function getAppCodeFromPathname(pathname = '') {
  const normalizedPathname = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const appMatch = normalizedPathname.match(/^\/app\/([^/]+)/);

  if (appMatch?.[1]) {
    return normalizeAppCode(appMatch[1]);
  }

  if (normalizedPathname === ROUTES.admin || normalizedPathname === '/admin/dashboard') {
    return 'dashboard';
  }

  return LEGACY_ROUTE_APP_CODES[normalizedPathname] ?? '';
}

export function getAppBasePath(appCode) {
  const normalizedAppCode = normalizeAppCode(appCode);
  return normalizedAppCode ? `/app/${normalizedAppCode}` : ROUTES.dashboard;
}

export function resolveCurrentApp(apps = [], appCode = '') {
  const normalizedAppCode = normalizeAppCode(appCode);
  return apps.find((app) => normalizeAppCode(app.code) === normalizedAppCode) ?? null;
}

export function resolveAppMenus(menus = [], appCode = '') {
  const normalizedAppCode = normalizeAppCode(appCode);
  return (menus ?? []).filter((menu) => normalizeAppCode(menu.appCode) === normalizedAppCode);
}
