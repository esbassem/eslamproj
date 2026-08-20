import { normalizeAuthorizationAppCode } from './appCode.js';

export function getAppAccessPermission(appCode) {
  const code = normalizeAuthorizationAppCode(appCode);
  return code && code !== 'team' ? `${code}.access` : '';
}

export function canAccessInstalledApp(app, authorization = {}) {
  if (!app?.isInstalled) return false;
  if (authorization.ownerOverride === true) return true;
  const permission = getAppAccessPermission(app.code);
  return Boolean(permission && authorization.permissions?.has(permission));
}

export function filterAccessibleInstalledApps(apps, authorization) {
  return (apps || []).filter((app) => canAccessInstalledApp(app, authorization));
}
