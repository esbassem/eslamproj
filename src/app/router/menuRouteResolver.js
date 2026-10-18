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

  const direct = MENU_COMPONENTS[normalizedRoute] ?? MENU_COMPONENTS[alternateRoute];
  if (direct) return direct;

  return Object.entries(MENU_COMPONENTS).find(([pattern]) => {
    if (!pattern.includes('/:')) return false;
    const expression = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/]+');
    return new RegExp(`^${expression}$`).test(normalizedRoute);
  })?.[1] ?? null;
}
