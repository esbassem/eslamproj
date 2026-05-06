import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { getDefaultAuthenticatedRoute } from '@/features/workspace/utils/routeHelpers';

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

