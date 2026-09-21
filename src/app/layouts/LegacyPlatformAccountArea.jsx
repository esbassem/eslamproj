import { useState } from 'react';
import { Languages, UserRound } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { LOCALE_META } from '@/core/i18n/config';
import { useI18n } from '@/core/i18n/useI18n';
import { requestAndSaveOneSignalSubscription } from '@/core/notifications/onesignal';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/core/ui/dropdown-menu';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function LegacyPlatformGlobalActions() {
  const { locale, toggleLocale } = useI18n();
  const languageLabel = LOCALE_META[locale]?.label ?? locale;
  return (
    <button
      type="button"
      onClick={toggleLocale}
      aria-label={`تغيير اللغة، اللغة الحالية ${languageLabel}`}
      title={languageLabel}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2"
    >
      <Languages className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
    </button>
  );
}

export function LegacyPlatformAccountArea() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { tenant, tenantUser } = useWorkspace();
  const [pushState, setPushState] = useState('idle');
  const displayName = user?.fullName?.trim() || 'الحساب';
  const handleSignOut = async () => {
    await signOut();
    navigate(ROUTES.landing);
  };
  const enablePushNotifications = async () => {
    if (pushState === 'loading') return;
    setPushState('loading');
    try {
      const result = await requestAndSaveOneSignalSubscription({ tenantId: tenant?.id ?? tenantUser?.tenantId, tenantUserId: tenantUser?.id });
      setPushState(result.status === 'subscribed' ? 'ready' : 'idle');
    } catch {
      setPushState('error');
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`قائمة الحساب: ${displayName}`}
          title={displayName}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2"
        >
          <UserRound className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56 rounded-xl border-slate-200 shadow-lg">
        {tenantUser?.role ? <p className="px-3 py-1.5 text-start text-[11px] font-medium text-slate-400">{tenantUser.role}</p> : null}
        <DropdownMenuItem asChild className="justify-start text-start font-medium">
          <Link to={ROUTES.settings}>إعدادات مساحة العمل</Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pushState === 'loading'}
          onSelect={(event) => {
            event.preventDefault();
            enablePushNotifications();
          }}
          className="justify-start text-start font-medium"
        >
          {pushState === 'loading' ? 'جاري تفعيل الإشعارات...' : pushState === 'ready' ? 'الإشعارات مفعلة' : pushState === 'error' ? 'تعذر تفعيل الإشعارات' : 'تفعيل الإشعارات'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleSignOut} className="justify-start text-start font-medium text-red-700 focus:bg-red-50 focus:text-red-800">
          تسجيل الخروج
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
