import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { AppContentFallback } from '@/core/ui/app-content-fallback';
import { useAppContext } from '@/contexts/AppContext';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { getDefaultAuthenticatedRoute } from '@/features/workspace/utils/routeHelpers';
import { resolveCurrentApp } from '@/utils/appResolver';

function AppAccessDeniedPage() {
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

export function SessionGate() {
  const location = useLocation();
  const { isAuthenticated, isCheckingSession } = useAuth();
  const { isLoadingWorkspace } = useWorkspace();

  if (isCheckingSession || (isAuthenticated && isLoadingWorkspace)) {
    return <Navigate to={ROUTES.checkingSession} replace state={{ from: location }} />;
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  const location = useLocation();
  const { isAuthenticated, isCheckingSession } = useAuth();
  const { hasTenant, isLoadingWorkspace, tenantUser } = useWorkspace();

  if (isCheckingSession || (isAuthenticated && isLoadingWorkspace)) {
    return <Navigate to={ROUTES.checkingSession} replace state={{ from: location }} />;
  }

  if (isAuthenticated) {
    return <Navigate to={getDefaultAuthenticatedRoute(hasTenant, tenantUser?.role)} replace />;
  }

  return <Outlet />;
}

export function ProtectedRoute() {
  const location = useLocation();
  const { isAuthenticated, isCheckingSession } = useAuth();
  const { hasTenant, isLoadingWorkspace, tenantUser } = useWorkspace();

  if (isCheckingSession || (isAuthenticated && isLoadingWorkspace)) {
    return <Navigate to={ROUTES.checkingSession} replace state={{ from: location }} />;
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.landing} replace state={{ from: location }} />;
  }

  if (!hasTenant && location.pathname !== ROUTES.onboarding) {
    return <Navigate to={ROUTES.onboarding} replace />;
  }

  if (hasTenant && location.pathname === ROUTES.onboarding) {
    return <Navigate to={getDefaultAuthenticatedRoute(hasTenant, tenantUser?.role)} replace />;
  }

  return <Outlet />;
}

export function AppAccessRoute({ appCode, children }) {
  const location = useLocation();
  const { apps, appsStatus } = useAppContext();
  const { tenantUser } = useWorkspace();
  const allowedApp = resolveCurrentApp(apps, appCode);
  const isCheckingAppAccess = appsStatus === 'idle' || appsStatus === 'loading';
  const canOpenOwnerSettings = appCode === 'settings' && tenantUser?.role === 'owner';

  if (isCheckingAppAccess) {
    return <AppContentFallback pathname={location.pathname} />;
  }

  if (!canOpenOwnerSettings && !allowedApp) {
    return <AppAccessDeniedPage />;
  }

  return children;
}

