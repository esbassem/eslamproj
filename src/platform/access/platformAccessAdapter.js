function normalizeCode(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
}

export function createPlatformAccessSnapshot({ apps = [], menus = [], appsStatus = 'idle', menusStatus = 'idle' } = {}) {
  const visibleApps = apps.filter((app) => app?.active !== false);
  return Object.freeze({
    status: appsStatus,
    navigationStatus: menusStatus,
    apps: Object.freeze([...visibleApps]),
    menus: Object.freeze([...menus]),
    isAppAvailable(appCode) {
      const code = normalizeCode(appCode);
      return visibleApps.some((app) => normalizeCode(app.code) === code);
    },
    isNavigationItemVisible(navigationItem) {
      return navigationItem?.active !== false && navigationItem?.visible !== false;
    },
  });
}

export function adaptLegacyAppContext(appContext = {}) {
  return createPlatformAccessSnapshot({
    apps: appContext.apps,
    menus: appContext.activeMenus,
    appsStatus: appContext.appsStatus,
    menusStatus: appContext.menusStatus,
  });
}
