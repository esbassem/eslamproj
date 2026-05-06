import { useEffect } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { Logo } from '@/core/ui/logo';
import { ROUTES } from '@/core/config/routes.config';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { getDefaultAuthenticatedRoute } from '@/features/workspace/utils/routeHelpers';

export function CheckingSessionPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const { isCheckingSession, isAuthenticated } = useAuth();
  const { hasTenant, isLoadingWorkspace, tenantUser } = useWorkspace();

  useEffect(() => {
    if (isCheckingSession || (isAuthenticated && isLoadingWorkspace)) {
      return;
    }

    const requestedLocation = location.state?.from;
    const targetPath = requestedLocation?.pathname;
    const targetUrl = requestedLocation
      ? `${requestedLocation.pathname || ''}${requestedLocation.search || ''}${requestedLocation.hash || ''}`
      : null;
    const shouldRestoreTarget =
      isAuthenticated &&
      targetPath &&
      targetPath !== ROUTES.checkingSession &&
      targetPath !== ROUTES.login &&
      targetPath !== ROUTES.signup &&
      targetPath !== ROUTES.forgotPassword;

    navigate(shouldRestoreTarget ? targetUrl : isAuthenticated ? getDefaultAuthenticatedRoute(hasTenant, tenantUser?.role) : ROUTES.landing, {
      replace: true,
    });
  }, [hasTenant, isAuthenticated, isCheckingSession, isLoadingWorkspace, location.state, navigate, tenantUser?.role]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6">
      <Logo />
      <div className="flex items-center gap-3 rounded-full border border-border bg-white px-5 py-3 text-sm text-slate-600 shadow-soft">
        <LoaderCircle className="h-4 w-4 animate-spin" />
        {t('common.status.checkingSession')}
      </div>
    </div>
  );
}

