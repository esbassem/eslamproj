import { MENU_COMPONENTS } from '@/app/router/menuRegistry';

export function normalizeMenuRoute(route = '') {
  const withoutHash = String(route).split('#')[0];
  const withoutSearch = withoutHash.split('?')[0];
  const normalizedRoute = withoutSearch.replace(/\/+$/, '') || '/';
  return normalizedRoute;
}

export function resolveMenuComponent(route) {
  const normalizedRoute = normalizeMenuRoute(route);
  return MENU_COMPONENTS[normalizedRoute] ?? null;
}
