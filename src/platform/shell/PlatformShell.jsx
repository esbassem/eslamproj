import { Component, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { resolveBreadcrumbs } from '../routing/breadcrumbResolver.js';
import { resolveContextualBack } from '../routing/contextualBackResolver.js';
import { resolveNavigationItems } from '../navigation/navigationResolver.js';
import { resolveShellPolicy } from './shellPolicy.js';
import { AppSidebar } from '../navigation/AppSidebar';
import { MobileAppNavigation } from '../navigation/MobileAppNavigation';
import { PlatformContent } from './PlatformContent';
import { PlatformShellProvider } from './PlatformShellContext';
import { PlatformTopBar } from './PlatformTopBar';

class ShellErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, errorInfo) {
    console.error('[PlatformShell] Route rendering failed.', error, errorInfo);
    const chunkFailure = /dynamically imported module|loading chunk|failed to fetch|module script/i.test(String(error?.message));
    if (!chunkFailure || typeof window === 'undefined') return;
    try {
      const retryKey = `businesshub:chunk-retry:${window.location.pathname}`;
      if (!window.sessionStorage.getItem(retryKey)) {
        window.sessionStorage.setItem(retryKey, '1');
        window.location.reload();
      }
    } catch {
      // The visible retry action remains available when browser storage is unavailable.
    }
  }
  componentDidUpdate(previousProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    const diagnosticMessage = import.meta.env.DEV ? String(this.state.error?.message || this.state.error) : '';
    return this.props.fallback?.(this.state.error) ?? (
      <div role="alert" className="flex min-h-64 flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="font-bold text-slate-800">تعذر فتح الصفحة.</p>
        {diagnosticMessage ? (
          <p className="max-w-2xl rounded-lg bg-slate-100 px-3 py-2 font-mono text-xs font-semibold text-red-700" dir="ltr">
            {diagnosticMessage}
          </p>
        ) : null}
        <button type="button" onClick={() => window.location.reload()} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400">
          إعادة المحاولة
        </button>
      </div>
    );
  }
}

function ShellRouteContent({ pathname, children }) {
  useEffect(() => {
    try { window.sessionStorage.removeItem(`businesshub:chunk-retry:${pathname}`); } catch { /* Browser storage is optional. */ }
  }, [pathname]);
  return children;
}

export function PlatformShell({
  appRegistration,
  routeMetadata,
  routeContext = {},
  legacyNavigationItems = [],
  loadingFallback = null,
  errorFallback,
  globalActions,
  accountArea,
  children,
}) {
  const location = useLocation();
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);
  const [publishedRouteContext, setPublishedRouteContext] = useState({ pathname: '', value: {} });
  const publishRouteContext = useCallback((value = {}) => {
    setPublishedRouteContext({ pathname: location.pathname, value });
  }, [location.pathname]);
  const effectiveRouteContext = useMemo(() => ({
    ...routeContext,
    ...(publishedRouteContext.pathname === location.pathname ? publishedRouteContext.value : {}),
  }), [location.pathname, publishedRouteContext, routeContext]);
  const policy = resolveShellPolicy({ appRegistration, routeMetadata });
  const navigationItems = resolveNavigationItems({ appRegistration, legacyItems: legacyNavigationItems });
  const breadcrumbs = resolveBreadcrumbs({ routeMetadata, appRegistration, context: effectiveRouteContext });
  const contextualBack = resolveContextualBack({ breadcrumbs, pathname: location.pathname });
  const contextValue = useMemo(() => ({ app: appRegistration ?? null, route: routeMetadata ?? null, routeContext: effectiveRouteContext, publishRouteContext, policy, breadcrumbs }), [appRegistration, breadcrumbs, effectiveRouteContext, policy, publishRouteContext, routeMetadata]);
  const showNavigation = policy.navigation === 'sidebar';
  const content = children ?? <Outlet />;

  return (
    <PlatformShellProvider value={contextValue}>
      <div
        className="flex h-screen min-h-0 flex-col bg-white text-slate-950"
        data-shell-variant={policy.variant}
        style={appRegistration?.color ? { '--app-primary-color': appRegistration.color } : undefined}
      >
        {policy.topBar ? (
          <PlatformTopBar
            app={appRegistration}
            breadcrumbs={policy.breadcrumbs ? breadcrumbs : []}
            contextualBack={contextualBack}
            globalActions={globalActions}
            accountArea={accountArea}
            showDivider={policy.topBarDivider}
            showAppIdentity={policy.appIdentity}
            navigationTrigger={showNavigation ? <button type="button" onClick={() => setMobileNavigationOpen(true)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold">القائمة</button> : null}
          />
        ) : null}
        <div className="flex min-h-0 flex-1">
          {showNavigation ? <AppSidebar app={appRegistration} items={navigationItems} pathname={location.pathname} /> : null}
          <PlatformContent contentWidth={policy.contentWidth} variant={policy.variant} scrollKey={location.pathname}>
            <ShellErrorBoundary resetKey={location.pathname} fallback={errorFallback}>
              <Suspense fallback={loadingFallback}>
                <ShellRouteContent pathname={location.pathname}>{content}</ShellRouteContent>
              </Suspense>
            </ShellErrorBoundary>
          </PlatformContent>
        </div>
        {showNavigation ? <MobileAppNavigation open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen} app={appRegistration} items={navigationItems} pathname={location.pathname} /> : null}
      </div>
    </PlatformShellProvider>
  );
}
