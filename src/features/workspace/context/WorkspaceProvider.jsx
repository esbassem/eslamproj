import { createContext, useEffect, useMemo, useRef, useState } from 'react';
import { messages } from '@/core/i18n/messages';
import { clearScopedStorage, storageKeys, writeStorage } from '@/core/lib/storage';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { modulesService } from '@/features/modules/modules.service';
import { workspaceService } from '@/features/workspace/api/workspace.api';

export const WorkspaceContext = createContext(null);

export function WorkspaceProvider({ children }) {
  const { user, isAuthenticated, isAuthReady } = useAuth();
  const userId = user?.id ?? null;
  const [tenant, setTenant] = useState(null);
  const [tenantUser, setTenantUser] = useState(null);
  const [installedModules, setInstalledModules] = useState([]);
  const [installedMenus, setInstalledMenus] = useState([]);
  const [modulesStatus, setModulesStatus] = useState('idle');
  const [modulesError, setModulesError] = useState(null);
  const [workspaceStatus, setWorkspaceStatus] = useState('idle');
  const [workspaceError, setWorkspaceError] = useState(null);
  const loadRunRef = useRef(0);
  const modulesLoadRunRef = useRef(0);

  useEffect(() => {
    let mounted = true;

    if (!isAuthReady) {
      setWorkspaceStatus('loading');
      return undefined;
    }

    if (!isAuthenticated || !userId) {
      setTenant(null);
      setTenantUser(null);
      setInstalledModules([]);
      setInstalledMenus([]);
      setModulesStatus('idle');
      setModulesError(null);
      setWorkspaceError(null);
      setWorkspaceStatus('ready');
      clearScopedStorage([storageKeys.tenant]);
      return undefined;
    }

    const runId = ++loadRunRef.current;
    setWorkspaceStatus('loading');
    setWorkspaceError(null);

    workspaceService
      .getTenantBootstrap(userId)
      .then((result) => {
        if (!mounted || loadRunRef.current !== runId) {
          return;
        }

        setTenant(result.tenant);
        setTenantUser(result.tenantUser);
        setWorkspaceStatus('ready');

        if (result.tenant) {
          writeStorage(storageKeys.tenant, result.tenant);
        } else {
          clearScopedStorage([storageKeys.tenant]);
        }
      })
      .catch((error) => {
        if (!mounted || loadRunRef.current !== runId) {
          return;
        }

        setTenant(null);
        setTenantUser(null);
        setInstalledModules([]);
        setInstalledMenus([]);
        setModulesStatus('idle');
        setModulesError(null);
        setWorkspaceStatus('ready');
        setWorkspaceError(error.message || messages.ar.errors.workspaceLoad);
        clearScopedStorage([storageKeys.tenant]);
      });

    return () => {
      mounted = false;
    };
  }, [isAuthenticated, isAuthReady, userId]);

  useEffect(() => {
    let mounted = true;

    if (!tenant?.id) {
      setInstalledModules([]);
      setInstalledMenus([]);
      setModulesStatus('idle');
      setModulesError(null);
      return undefined;
    }

    if (!tenantUser?.role) {
      setModulesStatus('idle');
      return undefined;
    }

    const runId = ++modulesLoadRunRef.current;
    setModulesStatus('loading');
    setModulesError(null);

    modulesService
      .loadInstalledModules(tenant.id, { userRole: tenantUser?.role })
      .then((result) => {
        if (!mounted || modulesLoadRunRef.current !== runId) {
          return;
        }

        setInstalledModules(result.modules);
        setInstalledMenus(result.menus);
        setModulesStatus('ready');
      })
      .catch((error) => {
        if (!mounted || modulesLoadRunRef.current !== runId) {
          return;
        }

        setInstalledModules([]);
        setInstalledMenus([]);
        setModulesStatus('error');
        setModulesError(error.message || 'تعذر تحميل الموديولات.');
      });

    return () => {
      mounted = false;
    };
  }, [tenant?.id, tenantUser?.role]);

  const value = useMemo(
    () => ({
      tenant,
      tenantUser,
      installedModules,
      installedMenus,
      modulesStatus,
      modulesError,
      loading: workspaceStatus === 'loading',
      ready: workspaceStatus === 'ready',
      hasTenant: Boolean(tenant && tenantUser),
      onboardingRequired: Boolean(user) && !tenantUser,
      workspaceStatus,
      workspaceError,
      isLoadingWorkspace: workspaceStatus === 'loading',
      isWorkspaceReady: workspaceStatus === 'ready',
      saveWorkspace: async (payload) => {
        if (!user) {
          throw new Error(messages.ar.errors.workspaceAuthMissing);
        }

        const result = await workspaceService.createTenantBootstrap({
          authUser: user,
          payload,
        });

        setTenant(result.tenant);
        setTenantUser(result.tenantUser);
        setInstalledModules([]);
        setInstalledMenus([]);
        setModulesStatus(result.tenant?.id ? 'loading' : 'idle');
        setModulesError(null);
        setWorkspaceError(null);
        setWorkspaceStatus('ready');
        writeStorage(storageKeys.tenant, result.tenant);
        return result.tenant;
      },
      clearWorkspace: () => {
        setTenant(null);
        setTenantUser(null);
        setInstalledModules([]);
        setInstalledMenus([]);
        setModulesStatus('idle');
        setModulesError(null);
        setWorkspaceError(null);
        setWorkspaceStatus('ready');
        clearScopedStorage([storageKeys.tenant]);
      },
    }),
    [installedMenus, installedModules, modulesError, modulesStatus, tenant, tenantUser, user, workspaceError, workspaceStatus],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
