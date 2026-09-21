import { matchRouteMetadata, normalizeRouteMetadata } from './routeMetadata.js';

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function createRouteManifest(routes = []) {
  const ids = new Set();
  const normalizedRoutes = routes.map((route) => {
    const normalized = normalizeRouteMetadata(route);
    invariant(!ids.has(normalized.id), `Duplicate route metadata id: ${normalized.id}`);
    ids.add(normalized.id);
    return normalized;
  });
  return Object.freeze({
    routes: Object.freeze(normalizedRoutes),
    getById: (id) => normalizedRoutes.find((route) => route.id === id) ?? null,
    resolve(pathname) {
      return normalizedRoutes
        .map((route) => matchRouteMetadata(route, pathname))
        .filter(Boolean)
        .sort((left, right) => right.route._specificity - left.route._specificity)[0] ?? null;
    },
  });
}

export const EMPTY_ROUTE_MANIFEST = createRouteManifest();
