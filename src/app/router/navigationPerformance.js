const MARKS = ['app-navigation-start', 'app-shell-visible', 'app-content-ready'];
const MEASURES = ['app-navigation-to-shell', 'app-navigation-to-content'];

export function markNavigationStart() {
  if (!import.meta.env.DEV) return;
  MARKS.forEach((name) => performance.clearMarks(name));
  MEASURES.forEach((name) => performance.clearMeasures(name));
  performance.mark('app-navigation-start');
}

export function markAppShellVisible() {
  if (!import.meta.env.DEV || !performance.getEntriesByName('app-navigation-start').length) return false;
  performance.clearMarks('app-shell-visible');
  performance.mark('app-shell-visible');
  performance.measure('app-navigation-to-shell', 'app-navigation-start', 'app-shell-visible');
  return true;
}

export function markAppContentReady() {
  if (!import.meta.env.DEV || !performance.getEntriesByName('app-navigation-start').length) return;
  performance.clearMarks('app-content-ready');
  performance.mark('app-content-ready');
  performance.measure('app-navigation-to-content', 'app-navigation-start', 'app-content-ready');
}
