import { memo, useEffect, useRef, useState } from 'react';
import { Bell, BellRing, ChevronDown, Loader2, Menu } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, AvatarFallback } from '@/core/ui/avatar';
import { Button } from '@/core/ui/button';
import { useI18n } from '@/core/i18n/useI18n';
import { requestAndSaveOneSignalSubscription } from '@/core/notifications/onesignal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/core/ui/dropdown-menu';
import { ROUTES } from '@/core/config/routes.config';
import { uiExperiments } from '@/core/config/app.config';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function AppTopbarComponent({ onMenuClick }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { locale, t, toggleLocale } = useI18n();
  const { user, signOut } = useAuth();
  const { tenant, tenantUser } = useWorkspace();
  const [isEnablingPush, setIsEnablingPush] = useState(false);
  const [pushToast, setPushToast] = useState(null);
  const pushToastTimeoutRef = useRef(null);
  const isLauncherMode = uiExperiments.homeLauncherNavigation;
  const isLauncherHome = isLauncherMode && location.pathname === ROUTES.dashboard;
  const showTopbarActions = !isLauncherMode || location.pathname === ROUTES.dashboard;

  const initials = user?.fullName
    ?.split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2);

  const handleSignOut = async () => {
    await signOut();
    navigate(ROUTES.landing);
  };

  useEffect(() => {
    return () => {
      if (pushToastTimeoutRef.current) {
        window.clearTimeout(pushToastTimeoutRef.current);
      }
    };
  }, []);

  const showPushToast = (message, type = 'success') => {
    if (pushToastTimeoutRef.current) {
      window.clearTimeout(pushToastTimeoutRef.current);
    }

    setPushToast({ message, type });
    pushToastTimeoutRef.current = window.setTimeout(() => {
      setPushToast(null);
      pushToastTimeoutRef.current = null;
    }, 4500);
  };

  const handleEnablePushNotifications = async () => {
    if (isEnablingPush) {
      return;
    }

    setIsEnablingPush(true);

    try {
      const result = await requestAndSaveOneSignalSubscription({
        tenantId: tenant?.id ?? tenantUser?.tenantId,
        tenantUserId: tenantUser?.id,
      });

      if (result.status === 'denied') {
        showPushToast('تم رفض إذن الإشعارات من المتصفح. يمكنك تفعيله من إعدادات Chrome.', 'error');
        return;
      }

      showPushToast('تم تفعيل الإشعارات وحفظ اشتراك هذا الجهاز.');
    } catch (error) {
      showPushToast(error?.message || 'تعذر تفعيل الإشعارات الآن.', 'error');
    } finally {
      setIsEnablingPush(false);
    }
  };

  return (
    <header className={`sticky top-0 z-30 ${isLauncherHome ? 'bg-transparent px-6 py-3 text-slate-500 sm:px-10 lg:px-16' : ''}`}>
      {pushToast ? (
        <div
          role="status"
          className={`fixed left-4 top-4 z-[60] max-w-sm rounded-xl border px-4 py-3 text-sm font-semibold shadow-soft ${
            pushToast.type === 'error' ? 'border-red-100 bg-red-50 text-red-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'
          }`}
        >
          {pushToast.message}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3 px-1 py-1 sm:px-0">
        <div className="flex items-center gap-2">
          {isLauncherMode ? null : (
            <Button
              variant="secondary"
              size="icon"
              className="h-9 w-9 rounded-full border border-transparent bg-transparent shadow-none lg:hidden"
              onClick={onMenuClick}
            >
              <Menu className="h-4 w-4" />
            </Button>
          )}
        </div>

        {showTopbarActions ? (
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              className={`h-9 min-w-0 rounded-full border border-transparent bg-transparent px-3 text-xs shadow-none ${isLauncherHome ? 'text-slate-500 hover:bg-white/60' : ''}`}
              onClick={toggleLocale}
            >
              {locale === 'ar' ? t('common.actions.switchToEnglish') : t('common.actions.switchToArabic')}
            </Button>

            <Button variant="secondary" size="icon" className={`h-9 w-9 rounded-full border border-transparent bg-transparent shadow-none ${isLauncherHome ? 'text-slate-500 hover:bg-white/60' : ''}`}>
              <Bell className="h-4 w-4" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className={`flex items-center gap-2 rounded-full border border-transparent bg-transparent px-2 py-1.5 outline-none transition ${isLauncherHome ? 'hover:bg-white/60' : 'hover:bg-white/60'}`}>
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{initials || 'BH'}</AvatarFallback>
                  </Avatar>
                  <div className="hidden text-right md:block">
                    <div className={`text-sm font-semibold ${isLauncherHome ? 'text-slate-600' : 'text-slate-900'}`}>{user?.fullName}</div>
                    <div className={`text-xs ${isLauncherHome ? 'text-slate-400' : 'text-muted-foreground'}`}>{t(`common.roles.${tenantUser?.role || 'member'}`)}</div>
                  </div>
                  <ChevronDown className={`hidden h-4 w-4 md:block ${isLauncherHome ? 'text-slate-400' : 'text-slate-500'}`} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem asChild>
                  <Link to={ROUTES.settings}>{t('topbar.workspaceSettings')}</Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={isEnablingPush}
                  onSelect={(event) => {
                    event.preventDefault();
                    handleEnablePushNotifications();
                  }}
                  className="gap-2 disabled:pointer-events-none disabled:opacity-60"
                >
                  <span>تفعيل الإشعارات</span>
                  {isEnablingPush ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut}>{t('common.actions.signOut')}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </div>
    </header>
  );
}

export const AppTopbar = memo(AppTopbarComponent);
