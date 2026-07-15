import { Suspense, useCallback, useEffect, useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { preloadAllProtectedRoutes } from '@/app/router/lazyRoutes';
import { uiExperiments } from '@/core/config/app.config';
import { AppContentFallback } from '@/core/ui/app-content-fallback';
import { PageTransition } from '@/core/ui/page-transition';
import { useAppContext } from '@/contexts/AppContext';
import { AppSidebar } from '@/features/workspace/components/AppSidebar';
import { AppTopbar } from '@/features/workspace/components/AppTopbar';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { getAppCodeFromPathname, resolveCurrentApp } from '@/utils/appResolver';

function AccessDeniedAppPage() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4" dir="rtl">
      <div className="max-w-lg rounded-xl border border-amber-200 bg-amber-50 px-6 py-5 text-center shadow-sm">
        <h1 className="text-lg font-black text-amber-950">ليس لديك صلاحية لفتح هذا التطبيق</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-amber-800">
          هذا التطبيق غير متاح لحسابك الحالي. تواصل مع مالك الشركة لإضافة الصلاحية المناسبة.
        </p>
      </div>
    </div>
  );
}

function getColorHsl(color) {
  const fallback = '#0f172a';
  const normalizedColor = /^#[0-9a-f]{6}$/i.test(String(color ?? '').trim()) ? color : fallback;
  const r = parseInt(normalizedColor.slice(1, 3), 16) / 255;
  const g = parseInt(normalizedColor.slice(3, 5), 16) / 255;
  const b = parseInt(normalizedColor.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }

    h /= 6;
  }

  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function AppLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();
  const outlet = useOutlet();
  const { apps, appsStatus, setActiveApp, loadAppMenus, activeApp } = useAppContext();
  const { tenantUser } = useWorkspace();
  const currentAppCode = getAppCodeFromPathname(location.pathname);
  const canOpenOwnerSettings = currentAppCode === 'settings' && tenantUser?.role === 'owner';
  const currentAllowedApp = resolveCurrentApp(apps, currentAppCode);
  const isCheckingAppAccess = appsStatus === 'idle' || appsStatus === 'loading';
  const isAccessDenied =
    Boolean(currentAppCode) &&
    currentAppCode !== 'dashboard' &&
    !canOpenOwnerSettings &&
    appsStatus === 'ready' &&
    !currentAllowedApp;
  const handleOpenSidebar = useCallback(() => setIsSidebarOpen(true), []);
  const appColor = activeApp?.iconColor || '#0f172a';
  const appColorHSL = getColorHsl(appColor);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'auto' });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    const preload = () => preloadAllProtectedRoutes();

    if ('requestIdleCallback' in window) {
      const idleId = window.requestIdleCallback(preload, { timeout: 1500 });
      return () => window.cancelIdleCallback(idleId);
    }

    const timeoutId = window.setTimeout(preload, 600);
    return () => window.clearTimeout(timeoutId);
  }, []);

  useEffect(() => {
    const appCode = currentAppCode;

    if (!appCode) {
      setActiveApp(null);
      return;
    }

    if (isCheckingAppAccess || isAccessDenied) {
      setActiveApp(null);
      return;
    }

    setActiveApp(appCode);
    loadAppMenus(appCode);
  }, [apps, currentAppCode, isAccessDenied, isCheckingAppAccess, loadAppMenus, setActiveApp]);

  const showSidebar = !uiExperiments.homeLauncherNavigation || (currentAppCode && currentAppCode !== 'dashboard');
  const isLauncherHome = uiExperiments.homeLauncherNavigation && currentAppCode === 'dashboard';
  const shouldAnimateAppOpen = uiExperiments.homeLauncherNavigation && currentAppCode && currentAppCode !== 'dashboard';
  const isFullBleedApp = currentAppCode === 'old_cashbox';
  const shouldShowTopbar = !isFullBleedApp;
  const shouldShowSidebar = showSidebar && !isFullBleedApp;

  const rootStyle = {
    '--app-primary-color': appColor,
    '--primary': appColorHSL,
  };

  return (
    <div
      className={`min-h-screen transition-colors duration-150 ease-out ${isFullBleedApp ? 'bg-transparent px-0 py-0' : isLauncherHome ? 'bg-[radial-gradient(circle_at_50%_36%,#ffffff_0%,#f7f7f8_42%,#eceef1_100%)] px-0 py-0' : 'bg-white px-9 py-1 lg:px-14 xl:px-20 2xl:px-28'}`}
      style={rootStyle}
    >
      <style>{`
        @keyframes appShellOpen {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes appSidebarOpen {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .app-shell-open {
          animation: appShellOpen 0.14s cubic-bezier(0.2, 0, 0, 1) both;
        }
        .app-sidebar-open {
          animation: appSidebarOpen 0.12s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
      `}</style>
      {shouldShowTopbar ? <AppTopbar onMenuClick={handleOpenSidebar} /> : null}
      <div className={`${isFullBleedApp ? 'min-h-screen pt-0' : isLauncherHome ? 'min-h-0 pt-0' : 'min-h-[calc(100vh-5rem)] pt-4'} gap-4 lg:gap-6 ${shouldShowSidebar ? 'grid app-shell-grid' : 'block'}`}>
        {shouldShowSidebar ? (
          <div className={shouldAnimateAppOpen ? 'app-sidebar-open' : ''}>
            <AppSidebar />
          </div>
        ) : null}
        <div className={`relative min-w-0 transition-colors duration-150 ease-out ${shouldAnimateAppOpen && !isFullBleedApp ? 'app-shell-open' : ''} ${isFullBleedApp ? 'min-h-screen' : isLauncherHome ? 'min-h-0' : 'min-h-[calc(100vh-4rem)]'}`}>
          <main className={`relative overflow-x-clip ${isFullBleedApp || isLauncherHome ? 'py-0' : 'py-1'} ${shouldShowSidebar ? 'pl-2 lg:pl-4' : ''}`}>
            <div className={`mx-auto flex min-h-full w-full flex-col bg-transparent ${isFullBleedApp ? 'max-w-none gap-0' : isLauncherHome ? 'max-w-none gap-6' : 'max-w-7xl gap-6'}`}>
              <PageTransition pathname={location.pathname}>
                {isCheckingAppAccess && currentAppCode !== 'dashboard' ? (
                  <AppContentFallback pathname={location.pathname} />
                ) : isAccessDenied ? (
                  <AccessDeniedAppPage />
                ) : (
                  <Suspense fallback={<AppContentFallback pathname={location.pathname} />}>{outlet}</Suspense>
                )}
              </PageTransition>
            </div>
          </main>
        </div>
        {shouldShowSidebar ? <AppSidebar mobile open={isSidebarOpen} onOpenChange={setIsSidebarOpen} /> : null}
      </div>
    </div>
  );
}
