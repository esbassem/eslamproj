import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { appsService, buildAppMenusFromWorkspace } from '@/services/apps.service';
import { resolveCurrentApp } from '@/utils/appResolver';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { useAuthorization } from '@/core/authorization/useAuthorization';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { tenant, tenantUser, ready, installedModules, installedMenus, modulesStatus } = useWorkspace();
  const { permissionCodes, status: authorizationStatus } = useAuthorization();
  const tenantId = tenant?.id ?? null;
  const userRole = tenantUser?.role ?? null;
  const canManageApps = userRole === 'owner';
  const [apps, setApps] = useState([]);
  const [activeApp, setActiveAppState] = useState(null);
  const [activeMenus, setActiveMenus] = useState([]);
  const [appsStatus, setAppsStatus] = useState('idle');
  const [menusStatus, setMenusStatus] = useState('idle');
  const [appsError, setAppsError] = useState(null);
  const [menusError, setMenusError] = useState(null);
  const appsLoadRunRef = useRef(0);
  const menusLoadRunRef = useRef(0);
  const menusByAppCode = useMemo(() => Object.fromEntries(
    apps.map((app) => [app.code, buildAppMenusFromWorkspace(app.code, apps, installedMenus, { userRole })]),
  ), [apps, installedMenus, userRole]);

  useEffect(() => {
    let mounted = true;

    if (!ready || authorizationStatus === 'loading' || (tenantId && !userRole)) {
      setAppsStatus('idle');
      return undefined;
    }

    const runId = ++appsLoadRunRef.current;
    setAppsStatus('loading');
    setAppsError(null);

    appsService
      .getApps({ tenantId, userRole, permissionCodes })
      .then((loadedApps) => {
        if (!mounted || appsLoadRunRef.current !== runId) {
          return;
        }

        setApps(loadedApps);
        setAppsStatus('ready');
      })
      .catch((error) => {
        if (!mounted || appsLoadRunRef.current !== runId) {
          return;
        }

        setApps([]);
        setAppsStatus('error');
        setAppsError(error);
      });

    return () => {
      mounted = false;
    };
  }, [authorizationStatus, permissionCodes, ready, tenantId, userRole]);

  const setActiveApp = useCallback(
    (appOrCode) => {
      const nextApp = typeof appOrCode === 'string' ? resolveCurrentApp(apps, appOrCode) : appOrCode;
      setActiveAppState(nextApp ?? null);
    },
    [apps],
  );

  const loadAppMenus = useCallback(
    async (appCode) => {
      const runId = ++menusLoadRunRef.current;
      setMenusError(null);

      if (modulesStatus === 'idle' || modulesStatus === 'loading') {
        setActiveMenus([]);
        setMenusStatus('loading');
        return [];
      }

      const workspaceHasApp = installedModules.some((module) => module.id === apps.find((app) => app.code === appCode)?.id);
      if (modulesStatus === 'ready' && workspaceHasApp) {
        const cachedMenus = menusByAppCode[appCode] ?? [];
        setActiveMenus(cachedMenus);
        setMenusStatus('ready');
        return cachedMenus;
      }

      setMenusStatus('loading');

      try {
        const menus = await appsService.getAppMenus(appCode, { tenantId, userRole, permissionCodes });

        if (menusLoadRunRef.current !== runId) {
          return menus;
        }

        setActiveMenus(menus);
        setMenusStatus('ready');
        return menus;
      } catch (error) {
        if (menusLoadRunRef.current !== runId) {
          return [];
        }

        setActiveMenus([]);
        setMenusStatus('error');
        setMenusError(error);
        return [];
      }
    },
    [apps, installedModules, menusByAppCode, modulesStatus, permissionCodes, tenantId, userRole],
  );

  const uninstallApp = useCallback(
    async (app) => {
      if (!tenantId || !app?.id) {
        throw new Error('تعذر تحديد التطبيق المطلوب إزالته.');
      }

      if (!canManageApps) {
        throw new Error('إدارة التطبيقات متاحة لمالك الشركة فقط.');
      }

      const result = await appsService.uninstallAppByModuleId({ tenantId, moduleId: app.id });
      setApps((currentApps) => currentApps.filter((item) => item.id !== app.id));

      if (activeApp?.id === app.id) {
        setActiveAppState(null);
        setActiveMenus([]);
      }

      return result;
    },
    [activeApp?.id, canManageApps, tenantId],
  );

  const installApp = useCallback(
    async (app) => {
      if (!tenantId || !app?.id) {
        throw new Error('تعذر تحديد التطبيق المطلوب تثبيته.');
      }

      if (!canManageApps) {
        throw new Error('تثبيت التطبيقات متاح لمالك الشركة فقط.');
      }

      const result = await appsService.installAppByModuleId({ tenantId, moduleId: app.id });
      setApps((currentApps) => {
        if (currentApps.some((item) => item.id === app.id)) {
          return currentApps;
        }

        return [...currentApps, { ...app, tenantState: undefined, isInstalled: undefined }].sort(
          (first, second) => first.sortOrder - second.sortOrder || first.name.localeCompare(second.name, 'ar'),
        );
      });

      return result;
    },
    [canManageApps, tenantId],
  );

  const value = useMemo(
    () => ({
      apps,
      activeApp,
      activeMenus,
      appsStatus,
      menusStatus,
      appsError,
      menusError,
      menusByAppCode,
      setActiveApp,
      loadAppMenus,
      installApp,
      uninstallApp,
    }),
    [activeApp, activeMenus, apps, appsError, appsStatus, installApp, loadAppMenus, menusByAppCode, menusError, menusStatus, setActiveApp, uninstallApp],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }

  return context;
}
