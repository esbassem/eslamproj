import { Suspense, useCallback, useEffect, useState } from 'react';
import { ArrowRight, Menu } from 'lucide-react';
import { Link, useLocation, useOutlet } from 'react-router-dom';
import { uiExperiments } from '@/core/config/app.config';
import { ROUTES } from '@/core/config/routes.config';
import { AppContentFallback } from '@/core/ui/app-content-fallback';
import { PageTransition } from '@/core/ui/page-transition';
import { useAppContext } from '@/contexts/AppContext';
import { AppSidebar } from '@/features/workspace/components/AppSidebar';
import { AppTopbar } from '@/features/workspace/components/AppTopbar';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { getAppCodeFromPathname, resolveCurrentApp } from '@/utils/appResolver';
import { AppRouteErrorBoundary } from '@/app/router/AppRouteErrorBoundary';
import { markAppContentReady, markAppShellVisible } from '@/app/router/navigationPerformance';

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
    setIsSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const hasNavigationMeasurement = markAppShellVisible();
    try {
      sessionStorage.removeItem(`businesshub:chunk-retry:${location.pathname}`);
    } catch {
      // Session storage is optional and must not affect rendering.
    }
    if (!hasNavigationMeasurement) return undefined;
    const frame = window.requestAnimationFrame(() => {
      markAppContentReady();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, outlet]);

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
  const shouldShowTopbar = !isFullBleedApp && isLauncherHome;
  const shouldShowSidebar = showSidebar && !isFullBleedApp;

  const rootStyle = {
    '--app-primary-color': appColor,
    '--primary': appColorHSL,
  };

  return (
    <div
      className={`transition-colors duration-150 ease-out ${isFullBleedApp ? 'min-h-screen bg-transparent' : isLauncherHome ? 'min-h-screen bg-[radial-gradient(circle_at_50%_36%,#ffffff_0%,#f7f7f8_42%,#eceef1_100%)]' : 'h-screen overflow-hidden bg-[#f8fafc]'}`}
      style={rootStyle}
    >
      <style>{`
        @keyframes platformAppSidebarIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes platformAppContentIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .platform-app-sidebar-in {
          animation: platformAppSidebarIn 0.24s ease both;
        }
        .platform-app-content-in {
          animation: platformAppContentIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) 0.04s both;
        }
        @media (prefers-reduced-motion: reduce) {
          .platform-app-sidebar-in, .platform-app-content-in { animation: none !important; }
        }
      `}</style>
      {shouldShowTopbar ? <AppTopbar onMenuClick={handleOpenSidebar} /> : null}
      {shouldShowSidebar ? (
        <header
          className="fixed inset-x-0 top-0 z-30 border-b border-slate-200/90 bg-white/92 pt-[env(safe-area-inset-top)] shadow-[0_4px_18px_rgba(15,23,42,0.05)] backdrop-blur-xl lg:hidden"
          dir="rtl"
        >
          <div className="grid h-14 grid-cols-[2.5rem_minmax(0,1fr)_2.5rem] items-center gap-3 px-4 sm:px-6">
            <Link
              to={ROUTES.dashboard}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition duration-100 hover:bg-slate-100 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200"
              aria-label="العودة للوحة التحكم"
            >
              <ArrowRight className="h-5 w-5" />
            </Link>
            <div className="min-w-0 text-center">
              <p className="truncate text-sm font-black text-slate-950">{activeApp?.name || 'التطبيق'}</p>
              <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">مساحة التطبيق</p>
            </div>
            <button
              type="button"
              onClick={handleOpenSidebar}
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition duration-100 hover:bg-slate-100 active:scale-95 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200"
              aria-label="فتح قائمة التطبيق"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </header>
      ) : null}
      <div className={`${isFullBleedApp ? 'min-h-screen' : isLauncherHome ? 'min-h-0' : 'h-full min-h-0'} ${shouldShowSidebar ? 'grid gap-0 lg:grid-cols-[28rem_minmax(0,1fr)] xl:grid-cols-[30rem_minmax(0,1fr)]' : 'block'}`}>
        {shouldShowSidebar ? (
          <div className={shouldAnimateAppOpen ? 'platform-app-sidebar-in' : ''}>
            <AppSidebar />
          </div>
        ) : null}
        <div className={`relative min-w-0 transition-colors duration-150 ease-out ${shouldAnimateAppOpen && !isFullBleedApp ? 'platform-app-content-in' : ''} ${isFullBleedApp ? 'min-h-screen' : isLauncherHome ? 'min-h-0' : 'h-full min-h-0 overflow-hidden'}`}>
          <main className={`relative overflow-x-clip ${isFullBleedApp || isLauncherHome ? 'py-0' : 'h-full overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-[calc(env(safe-area-inset-top)+4.5rem)] sm:px-6 sm:pb-[calc(env(safe-area-inset-bottom)+1.5rem)] lg:px-8 lg:py-7 xl:px-10'}`}>
            <div className={`flex min-h-full w-full flex-col bg-transparent ${isFullBleedApp ? 'max-w-none gap-0' : isLauncherHome ? 'mx-auto max-w-none gap-6' : 'max-w-none gap-6'}`}>
              <AppRouteErrorBoundary resetKey={location.pathname}>
              <PageTransition pathname={location.pathname}>
                {isCheckingAppAccess && currentAppCode !== 'dashboard' ? (
                  <AppContentFallback pathname={location.pathname} />
                ) : isAccessDenied ? (
                  <AccessDeniedAppPage />
                ) : (
                  <Suspense fallback={<AppContentFallback pathname={location.pathname} />}>{outlet}</Suspense>
                )}
              </PageTransition>
              </AppRouteErrorBoundary>
            </div>
          </main>
        </div>
        {shouldShowSidebar ? <AppSidebar mobile open={isSidebarOpen} onOpenChange={setIsSidebarOpen} /> : null}
      </div>
    </div>
  );
}
