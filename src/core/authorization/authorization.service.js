export function createAuthorizationSnapshot(permissionCodes = [], options = {}) {
  const permissions = new Set((permissionCodes ?? []).filter(Boolean));
  const ownerOverride = options.ownerOverride === true;
  const can = (permissionCode) => Boolean(permissionCode) && (ownerOverride || permissions.has(permissionCode));

  return Object.freeze({
    permissions,
    can,
    canAny: (permissionCodesToCheck = []) => permissionCodesToCheck.some(can),
    canAll: (permissionCodesToCheck = []) => permissionCodesToCheck.every(can),
  });
}
