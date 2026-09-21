import { PAPERWORK_ROUTES } from './paperworkRoutes.js';

const PAPERWORK_PATH_PREFIX = `${PAPERWORK_ROUTES.root}/`;

export function getPaperworkLocationPath(location) {
  return `${location?.pathname || PAPERWORK_ROUTES.root}${location?.search || ''}`;
}

export function getPaperworkScrollContainer() {
  if (typeof document === 'undefined') return null;
  return document.querySelector('main.overflow-y-auto');
}

export function getPaperworkScrollTop() {
  return getPaperworkScrollContainer()?.scrollTop || 0;
}

export function isSafePaperworkReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return false;
  try {
    const url = new URL(value, 'https://paperwork.local');
    return url.origin === 'https://paperwork.local'
      && (url.pathname === PAPERWORK_ROUTES.root || url.pathname.startsWith(PAPERWORK_PATH_PREFIX));
  } catch {
    return false;
  }
}

export function createPaperworkNavigationState(location, options = {}) {
  return {
    paperworkReturnTo: getPaperworkLocationPath(location),
    paperworkReturnLabel: typeof options.returnLabel === 'string' ? options.returnLabel : '',
    paperworkScrollTop: options.scrollTop ?? getPaperworkScrollTop(),
  };
}

export function resolvePaperworkReturnContext(location, fallback, fallbackLabel) {
  const state = location?.state || {};
  const returnTo = isSafePaperworkReturnTo(state.paperworkReturnTo)
    ? state.paperworkReturnTo
    : fallback;
  return {
    returnTo,
    returnLabel: returnTo === fallback || typeof state.paperworkReturnLabel !== 'string'
      ? fallbackLabel
      : state.paperworkReturnLabel,
    scrollTop: Number.isFinite(state.paperworkScrollTop) ? state.paperworkScrollTop : 0,
  };
}
