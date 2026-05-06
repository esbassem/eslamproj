import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { appsService } from '@/services/apps.service';
import { resolveCurrentApp } from '@/utils/appResolver';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const { tenant, ready } = useWorkspace();
  const tenantId = tenant?.id ?? null;
  const [apps, setApps] = useState([]);
  const [activeApp, setActiveAppState] = useState(null);
  const [activeMenus, setActiveMenus] = useState([]);
  const [appsStatus, setAppsStatus] = useState('idle');
  const [menusStatus, setMenusStatus] = useState('idle');
  const [appsError, setAppsError] = useState(null);
  const [menusError, setMenusError] = useState(null);
  const appsLoadRunRef = useRef(0);
  const menusLoadRunRef = useRef(0);

  useEffect(() => {
    let mounted = true;

    if (!ready) {
      setAppsStatus('idle');
      return undefined;
    }

    const runId = ++appsLoadRunRef.current;
    setAppsStatus('loading');
    setAppsError(null);

    appsService
      .getApps({ tenantId })
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
  }, [ready, tenantId]);

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
      setMenusStatus('loading');
      setMenusError(null);

      try {
        const menus = await appsService.getAppMenus(appCode, { tenantId });

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
    [tenantId],
  );

  const uninstallApp = useCallback(
    async (app) => {
      if (!tenantId || !app?.id) {
        throw new Error('تعذر تحديد التطبيق المطلوب إزالته.');
      }

      const result = await appsService.uninstallAppByModuleId({ tenantId, moduleId: app.id });
      setApps((currentApps) => currentApps.filter((item) => item.id !== app.id));

      if (activeApp?.id === app.id) {
        setActiveAppState(null);
        setActiveMenus([]);
      }

      return result;
    },
    [activeApp?.id, tenantId],
  );

  const installApp = useCallback(
    async (app) => {
      if (!tenantId || !app?.id) {
        throw new Error('تعذر تحديد التطبيق المطلوب تثبيته.');
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
    [tenantId],
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
      setActiveApp,
      loadAppMenus,
      installApp,
      uninstallApp,
    }),
    [activeApp, activeMenus, apps, appsError, appsStatus, installApp, loadAppMenus, menusError, menusStatus, setActiveApp, uninstallApp],
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
