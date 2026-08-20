import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authorizationApi } from '@/core/authorization/authorization.api';
import { createAuthorizationSnapshot } from '@/core/authorization/authorization.service';
import {
  beginAuthorizationLoad,
  completeAuthorizationLoad,
  failAuthorizationLoad,
  INITIAL_AUTHORIZATION_STATE,
} from '@/core/authorization/authorization.state';
import { createResourceScopeSnapshot } from '@/core/authorization/scopes/scope.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export const AuthorizationContext = createContext(null);

export function AuthorizationProvider({ children }) {
  const { tenant, tenantUser, ready } = useWorkspace();
  const tenantId = tenant?.id ?? null;
  const tenantUserId = tenantUser?.id ?? null;
  const ownerOverride = tenantUser?.role === 'owner';
  const [authorizationState, setAuthorizationState] = useState(INITIAL_AUTHORIZATION_STATE);
  const loadRunRef = useRef(0);
  const cacheKey = tenantId && tenantUserId ? `${tenantId}:${tenantUserId}` : null;

  const refresh = useCallback(async (options = {}) => {
    const runId = ++loadRunRef.current;
    const canLoad = Boolean(ready && tenantId && tenantUserId);
    setAuthorizationState(beginAuthorizationLoad(canLoad));

    if (!canLoad) {
      authorizationApi.clearCache();
      return { permissionCodes: [], resourceScope: null };
    }

    try {
      const result = await authorizationApi.getCurrentAuthorization({
        cacheKey,
        force: options.force === true,
      });

      if (loadRunRef.current === runId) {
        setAuthorizationState(completeAuthorizationLoad(result.permissionCodes, result.resourceScope));
      }

      return result;
    } catch (nextError) {
      if (loadRunRef.current === runId) {
        setAuthorizationState(failAuthorizationLoad(nextError));
      }

      throw nextError;
    }
  }, [cacheKey, ready, tenantId, tenantUserId]);

  useEffect(() => {
    refresh({ force: false }).catch(() => {});
  }, [refresh]);

  const { permissionCodes, resourceScope, status, error } = authorizationState;
  const snapshot = useMemo(
    () => createAuthorizationSnapshot(permissionCodes, { ownerOverride }),
    [ownerOverride, permissionCodes],
  );
  const scopeSnapshot = useMemo(() => createResourceScopeSnapshot(resourceScope), [resourceScope]);

  const value = useMemo(
    () => ({
      ...snapshot,
      ...scopeSnapshot,
      permissionCodes,
      status,
      error,
      isLoading: status === 'loading',
      isReady: status === 'ready',
      refresh: () => refresh({ force: true }),
    }),
    [error, permissionCodes, refresh, scopeSnapshot, snapshot, status],
  );

  return <AuthorizationContext.Provider value={value}>{children}</AuthorizationContext.Provider>;
}
