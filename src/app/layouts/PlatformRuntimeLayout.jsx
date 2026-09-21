import { useEffect, useMemo } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { useAppContext } from '@/contexts/AppContext';
import { PlatformShell } from '@/platform';
import { adaptLegacyInstalledApp, adaptLegacyNavigationItems } from '@/platform/navigation/legacyNavigationAdapter';
import { adaptLegacyAppContext } from '@/platform/access/platformAccessAdapter';
import { getAppCodeFromPathname, resolveCurrentApp } from '@/utils/appResolver';
import { AppContentFallback } from '@/core/ui/app-content-fallback';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { LegacyPlatformAccountArea, LegacyPlatformGlobalActions } from './LegacyPlatformAccountArea';
import { adaptLegacyRouteMetadata, canActivateLegacyApp, getLegacyVisibleMenus, resolveLegacyRuntimePolicy } from './platformRuntimeCompatibility';
import { OFFICIAL_APP_REGISTRY, OFFICIAL_ROUTE_MANIFEST } from '@/app/platform/platformRegistrations';

export function PlatformRuntimeLayout() {
  const location = useLocation();
  const outlet = useOutlet();
  const appContext = useAppContext();
  const { tenantUser } = useWorkspace();
  const { apps, activeApp, activeMenus, appsStatus, setActiveApp, loadAppMenus } = appContext;
  const appCode = getAppCodeFromPathname(location.pathname) || 'dashboard';
  const installedApp = resolveCurrentApp(apps, appCode) ?? (activeApp?.code === appCode ? activeApp : null);
  const access = useMemo(() => adaptLegacyAppContext(appContext), [appContext]);
  const appAvailable = access.isAppAvailable(appCode);
  const canActivateApp = canActivateLegacyApp({ appCode, appAvailable, userRole: tenantUser?.role });
  const officialRegistration = OFFICIAL_APP_REGISTRY.get(appCode);
  const officialRouteMatch = OFFICIAL_ROUTE_MANIFEST.resolve(location.pathname);
  const policy = officialRegistration ? null : resolveLegacyRuntimePolicy(appCode, location.pathname);
  const visibleMenus = getLegacyVisibleMenus(activeMenus, appCode);
  const legacyNavigationItems = adaptLegacyNavigationItems(visibleMenus);
  const appRegistration = officialRegistration
    ? { ...officialRegistration, color: installedApp?.iconColor ?? officialRegistration.color, icon: installedApp?.icon ?? officialRegistration.icon }
    : adaptLegacyInstalledApp(installedApp ?? {
      code: appCode,
      name: appCode === 'dashboard' ? 'Business Hub' : appCode,
      href: location.pathname,
    }, { ...policy, menus: visibleMenus });
  const routeMetadata = officialRouteMatch?.route
    ?? adaptLegacyRouteMetadata(location.pathname, appCode, policy ?? resolveLegacyRuntimePolicy(appCode, location.pathname));

  useEffect(() => {
    if (appCode === 'dashboard') {
      setActiveApp(null);
      return;
    }
    if (appsStatus !== 'ready' || !canActivateApp) return;
    setActiveApp(appCode);
    if (!officialRegistration || officialRegistration.navigation.mode === 'sidebar') loadAppMenus(appCode);
  }, [appCode, appsStatus, canActivateApp, loadAppMenus, officialRegistration, setActiveApp]);

  return (
    <PlatformShell
      appRegistration={appRegistration}
      routeMetadata={routeMetadata}
      legacyNavigationItems={legacyNavigationItems}
      loadingFallback={<AppContentFallback pathname={location.pathname} />}
      globalActions={<LegacyPlatformGlobalActions />}
      accountArea={<LegacyPlatformAccountArea />}
    >
      {outlet}
    </PlatformShell>
  );
}
