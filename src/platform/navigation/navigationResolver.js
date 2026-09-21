import { NAVIGATION_MODES } from './navigationRegistry.js';

function cleanPath(value = '') {
  const path = String(value).split('#')[0].split('?')[0].replace(/\/+$/, '');
  return path || '/';
}

function pathMatches(pathname, item) {
  if (typeof item?.match === 'function') return Boolean(item.match(pathname));
  const target = cleanPath(item?.to ?? item?.href ?? '');
  return item?.end ? pathname === target : pathname === target || pathname.startsWith(`${target}/`);
}

export function resolveNavigationMode({ routeMetadata, appRegistration } = {}) {
  const routeMode = routeMetadata?.shell?.navigation;
  const appMode = appRegistration?.navigation?.mode;
  const mode = routeMode ?? appMode ?? 'none';
  return NAVIGATION_MODES.includes(mode) ? mode : 'none';
}

export function resolveNavigationItems({ appRegistration, legacyItems = [] } = {}) {
  const declaredItems = appRegistration?.navigation?.items;
  return Array.isArray(declaredItems) && declaredItems.length ? declaredItems : legacyItems;
}

export function resolveActiveNavigationItem(items = [], pathname = '/') {
  const currentPath = cleanPath(pathname);
  return [...items]
    .filter((item) => pathMatches(currentPath, item))
    .sort((left, right) => cleanPath(right.to ?? right.href).length - cleanPath(left.to ?? left.href).length)[0] ?? null;
}
