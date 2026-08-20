export { PERMISSIONS, PERMISSION_CODES } from '@/core/authorization/permissions';
export { canAccessInstalledApp, filterAccessibleInstalledApps, getAppAccessPermission } from '@/core/authorization/appAccess';
export { authorizationApi } from '@/core/authorization/authorization.api';
export { createAuthorizationSnapshot } from '@/core/authorization/authorization.service';
export { AuthorizationProvider } from '@/core/authorization/AuthorizationProvider';
export { useAuthorization } from '@/core/authorization/useAuthorization';
export {
  EMPTY_RESOURCE_SCOPE,
  normalizeResourceScope,
  createResourceScopeSnapshot,
} from '@/core/authorization/scopes/scope.service';
