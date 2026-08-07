import { preloadApp } from '@/app/router/appRouteRegistry';

const STORAGE_PREFIX = 'businesshub:app-usage:';
const MAX_RECORDS = 12;

function storageKey(scope) {
  return `${STORAGE_PREFIX}${scope || 'anonymous'}`;
}

function readUsage(scope) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(scope)) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECORDS) : [];
  } catch {
    return [];
  }
}

export function recordAppOpen(scope, appCode) {
  if (!appCode) return;
  try {
    const records = readUsage(scope);
    const current = records.find((item) => item.appCode === appCode);
    const next = [
      { appCode, lastOpenedAt: Date.now(), openCount: Number(current?.openCount || 0) + 1 },
      ...records.filter((item) => item.appCode !== appCode),
    ].slice(0, MAX_RECORDS);
    localStorage.setItem(storageKey(scope), JSON.stringify(next));
  } catch {
    // Storage can be disabled; navigation must remain unaffected.
  }
}

function shouldAvoidBackgroundPreload() {
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  return Boolean(connection?.saveData || ['slow-2g', '2g'].includes(connection?.effectiveType));
}

export function scheduleLikelyAppPreloads({ scope, allowedAppCodes = [], defaults = ['products', 'inventory'] }) {
  if (typeof window === 'undefined' || shouldAvoidBackgroundPreload()) return () => {};
  const allowed = new Set(allowedAppCodes);
  const recent = readUsage(scope)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || b.openCount - a.openCount)
    .map((item) => item.appCode);
  const targets = [...new Set([...recent, ...defaults])].filter((code) => allowed.has(code)).slice(0, 2);
  const run = () => targets.forEach((code) => preloadApp(code)?.catch(() => {}));

  if ('requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 1800 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 800);
  return () => window.clearTimeout(id);
}
