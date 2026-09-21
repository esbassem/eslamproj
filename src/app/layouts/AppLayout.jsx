import { Suspense, useEffect } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { AppRouteErrorBoundary } from '@/app/router/AppRouteErrorBoundary';
import { AppContentFallback } from '@/core/ui/app-content-fallback';
import { PageTransition } from '@/core/ui/page-transition';
import { useAppContext } from '@/contexts/AppContext';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { getAppCodeFromPathname, resolveCurrentApp } from '@/utils/appResolver';
import { markAppContentReady, markAppShellVisible } from '@/app/router/navigationPerformance';

function AccessDeniedAppPage() {
  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center px-4" dir="rtl">
      <div className="max-w-lg rounded-xl border border-amber-200 bg-amber-50 px-6 py-5 text-center shadow-sm">
        <h1 className="text-lg font-black text-amber-950">ليس لديك صلاحية لفتح هذا التطبيق</h1>
        <p className="mt-2 text-sm font-semibold leading-6 text-amber-800">هذا التطبيق غير متاح لحسابك الحالي. تواصل مع مالك الشركة لإضافة الصلاحية المناسبة.</p>
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
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Temporary compatibility boundary for pages still hosted by the legacy AppLayout route nodes.
 * PlatformRuntimeLayout owns the outer shell; this host preserves access and transition behavior
 * until each feature is adopted by the platform page contracts.
 */
export function LegacyAppHost() {
  const location = useLocation();
  const outlet = useOutlet();
  const { apps, appsStatus, activeApp } = useAppContext();
  const { tenantUser } = useWorkspace();
  const currentAppCode = getAppCodeFromPathname(location.pathname);
  const currentAllowedApp = resolveCurrentApp(apps, currentAppCode);
  const canOpenOwnerSettings = currentAppCode === 'settings' && tenantUser?.role === 'owner';
  const isCheckingAppAccess = appsStatus === 'idle' || appsStatus === 'loading';
  const isAccessDenied = Boolean(currentAppCode)
    && currentAppCode !== 'dashboard'
    && !canOpenOwnerSettings
    && appsStatus === 'ready'
    && !currentAllowedApp;
  const appColor = currentAllowedApp?.iconColor || activeApp?.iconColor || '#0f172a';

  useEffect(() => {
    const hasNavigationMeasurement = markAppShellVisible();
    try { sessionStorage.removeItem(`businesshub:chunk-retry:${location.pathname}`); } catch { /* optional */ }
    if (!hasNavigationMeasurement) return undefined;
    const frame = window.requestAnimationFrame(() => markAppContentReady());
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname, outlet]);

  return (
    <div className="flex min-h-full w-full flex-col" style={{ '--app-primary-color': appColor, '--primary': getColorHsl(appColor) }}>
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
  );
}

export function AppLayout() {
  return <LegacyAppHost />;
}
