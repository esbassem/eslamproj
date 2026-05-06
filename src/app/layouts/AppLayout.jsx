import { Suspense, useCallback, useEffect, useState } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { preloadAllProtectedRoutes } from '@/app/router/lazyRoutes';
import { uiExperiments } from '@/core/config/app.config';
import { AppContentFallback } from '@/core/ui/app-content-fallback';
import { PageTransition } from '@/core/ui/page-transition';
import { useAppContext } from '@/contexts/AppContext';
import { AppSidebar } from '@/features/workspace/components/AppSidebar';
import { AppTopbar } from '@/features/workspace/components/AppTopbar';
import { getAppCodeFromPathname } from '@/utils/appResolver';

export function AppLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();
  const outlet = useOutlet();
  const { apps, setActiveApp, loadAppMenus, activeApp } = useAppContext();
  const currentAppCode = getAppCodeFromPathname(location.pathname);
  const handleOpenSidebar = useCallback(() => setIsSidebarOpen(true), []);
  const appColor = activeApp?.iconColor || '#0f172a';
  
  // Parse hex color to HSL for CSS variables
  const hexToHSL = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
      h = s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  };

  const appColorHSL = hexToHSL(appColor);

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

    setActiveApp(appCode);
    loadAppMenus(appCode);
  }, [apps, currentAppCode, loadAppMenus, setActiveApp]);

  const showSidebar = !uiExperiments.homeLauncherNavigation || (currentAppCode && currentAppCode !== 'dashboard');
  const isLauncherHome = uiExperiments.homeLauncherNavigation && currentAppCode === 'dashboard';
  const shouldAnimateAppOpen = uiExperiments.homeLauncherNavigation && currentAppCode && currentAppCode !== 'dashboard';

  const rootStyle = {
    '--app-primary-color': appColor,
    '--primary': appColorHSL,
  };

  return (
    <div 
      className={`min-h-screen transition-colors duration-150 ease-out ${isLauncherHome ? 'bg-[radial-gradient(circle_at_50%_36%,#ffffff_0%,#f7f7f8_42%,#eceef1_100%)] px-0 py-0' : 'bg-background px-9 py-1 lg:px-14 xl:px-20 2xl:px-28'}`}
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
      <AppTopbar onMenuClick={handleOpenSidebar} />
      <div className={`${isLauncherHome ? 'min-h-0 pt-0' : 'min-h-[calc(100vh-5rem)] pt-4'} gap-4 lg:gap-6 ${showSidebar ? 'grid app-shell-grid' : 'block'}`}>
        {showSidebar ? (
          <div className={shouldAnimateAppOpen ? 'app-sidebar-open' : ''}>
            <AppSidebar />
          </div>
        ) : null}
        <div className={`relative min-w-0 overflow-hidden transition-colors duration-150 ease-out ${shouldAnimateAppOpen ? 'app-shell-open' : ''} ${isLauncherHome ? 'min-h-0' : 'min-h-[calc(100vh-4rem)]'} ${showSidebar ? 'rounded-2xl border border-slate-200 bg-white shadow-[0_4px_28px_-4px_rgba(15,23,42,0.10),0_1px_6px_-1px_rgba(15,23,42,0.06)] ring-1 ring-slate-900/[0.04]' : ''}`}>
          <main className={`relative overflow-x-clip ${isLauncherHome ? 'py-0' : 'py-1'} ${showSidebar ? 'pl-6 lg:pl-10' : ''}`}>
            <div className={`mx-auto flex min-h-full w-full flex-col gap-6 bg-transparent ${isLauncherHome ? 'max-w-none' : 'max-w-7xl'}`}>
              <PageTransition pathname={location.pathname}>
                <Suspense fallback={<AppContentFallback pathname={location.pathname} />}>{outlet}</Suspense>
              </PageTransition>
            </div>
          </main>
        </div>
        {showSidebar ? <AppSidebar mobile open={isSidebarOpen} onOpenChange={setIsSidebarOpen} /> : null}
      </div>
    </div>
  );
}
