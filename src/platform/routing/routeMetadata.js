import { CONTENT_WIDTHS, NAVIGATION_MODES, SHELL_VARIANTS } from '../navigation/navigationRegistry.js';

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

export function normalizePathname(value = '/') {
  const path = String(value).split('#')[0].split('?')[0].replace(/\/+$/, '');
  return path || '/';
}

function compilePath(path) {
  const keys = [];
  const source = normalizePathname(path)
    .split('/')
    .map((segment) => {
      if (!segment) return '';
      if (segment === '*') { keys.push('*'); return '(.*)'; }
      if (segment.startsWith(':')) { keys.push(segment.slice(1)); return '([^/]+)'; }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { keys, regex: new RegExp(`^${source}/?$`) };
}

export function validateRouteMetadata(route) {
  invariant(route && typeof route === 'object', 'Route metadata must be an object.');
  invariant(typeof route.id === 'string' && route.id.trim(), 'Route metadata requires an id.');
  invariant(typeof route.path === 'string' && route.path.startsWith('/'), `Route ${route.id} requires an absolute path.`);
  invariant(typeof route.appCode === 'string' && route.appCode.trim(), `Route ${route.id} requires an appCode.`);
  if (route.shell?.navigation !== undefined) invariant(NAVIGATION_MODES.includes(route.shell.navigation), `Unsupported route navigation mode: ${route.shell.navigation}`);
  if (route.shell?.contentWidth !== undefined) invariant(CONTENT_WIDTHS.includes(route.shell.contentWidth), `Unsupported route content width: ${route.shell.contentWidth}`);
  if (route.shell?.variant !== undefined) invariant(SHELL_VARIANTS.includes(route.shell.variant), `Unsupported route shell variant: ${route.shell.variant}`);
  if (route.shell?.topBar !== undefined) invariant(typeof route.shell.topBar === 'boolean', 'Route shell topBar policy must be boolean.');
  if (route.shell?.topBarDivider !== undefined) invariant(typeof route.shell.topBarDivider === 'boolean', 'Route shell topBar divider policy must be boolean.');
  if (route.shell?.appIdentity !== undefined) invariant(typeof route.shell.appIdentity === 'boolean', 'Route shell app identity policy must be boolean.');
  if (route.shell?.breadcrumbs !== undefined) invariant(typeof route.shell.breadcrumbs === 'boolean', 'Route shell breadcrumbs policy must be boolean.');
  return true;
}

export function normalizeRouteMetadata(route) {
  validateRouteMetadata(route);
  const compiled = compilePath(route.path);
  const specificity = normalizePathname(route.path).split('/').reduce((score, segment) => (
    score + (segment === '*' ? 0 : segment.startsWith(':') ? 1 : segment ? 3 : 0)
  ), 0);
  return Object.freeze({ ...route, shell: Object.freeze({ ...(route.shell ?? {}) }), _compiled: compiled, _specificity: specificity });
}

export function matchRouteMetadata(route, pathname) {
  const match = route._compiled.regex.exec(normalizePathname(pathname));
  if (!match) return null;
  const params = Object.fromEntries(route._compiled.keys.map((key, index) => [key, decodeURIComponent(match[index + 1] ?? '')]));
  return { route, params };
}
