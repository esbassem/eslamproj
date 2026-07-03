import { MENU_COMPONENTS } from '@/app/router/menuRegistry';

export function normalizeMenuRoute(route = '') {
  const withoutHash = String(route).split('#')[0];
  const withoutSearch = withoutHash.split('?')[0];
  const normalizedRoute = withoutSearch.replace(/\/+$/, '') || '/';
  return normalizedRoute;
}

export function resolveMenuComponent(route) {
  const normalizedRoute = normalizeMenuRoute(route);
  const alternateRoute = normalizedRoute.startsWith('/apps/')
    ? normalizedRoute.replace(/^\/apps\//, '/app/')
    : normalizedRoute.startsWith('/app/')
      ? normalizedRoute.replace(/^\/app\//, '/apps/')
      : '';

  return MENU_COMPONENTS[normalizedRoute] ?? MENU_COMPONENTS[alternateRoute] ?? null;
}
