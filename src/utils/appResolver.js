import { ROUTES } from '@/core/config/routes.config';

const APP_CODE_ALIASES = {
  accountant: 'accountant_app',
};

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
  '/photos': 'photos',
  '/photos/all': 'photos',
  '/photos/unlinked': 'photos',
  '/photos/settings': 'photos',
};

export function normalizeAppCode(value) {
  const normalizedCode = String(value ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  return APP_CODE_ALIASES[normalizedCode] ?? normalizedCode;
}

export function getAppCodeFromPathname(pathname = '') {
  const normalizedPathname = pathname.split('?')[0].replace(/\/+$/, '') || '/';
  const appMatch = normalizedPathname.match(/^\/apps?\/([^/]+)/);

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
  if (normalizedAppCode === 'accounting') {
    return '/apps/accounting';
  }
  if (normalizedAppCode === 'accountant_app') {
    return '/apps/accountant';
  }
  if (normalizedAppCode === 'old_cashbox') {
    return '/apps/old-cashbox';
  }
  if (normalizedAppCode === 'photos') {
    return '/photos';
  }
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
