import { Outlet } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { Logo } from '@/core/ui/logo';

export function AuthLayout() {
  const { t } = useI18n();

  return (
    <div className="grid min-h-screen lg:grid-cols-[0.9fr_1.1fr]">
      <div className="flex min-h-screen items-center justify-center p-6 sm:p-10">
        <Outlet />
      </div>
      <div className="hidden border-l border-white/60 bg-slate-100/70 p-10 lg:flex lg:flex-col">
        <Logo />
        <div className="mt-auto space-y-6">
          <div className="space-y-3">
            <div className="inline-flex rounded-full border border-border bg-white px-4 py-2 text-xs font-medium text-slate-600">
              {t('layout.authBadge')}
            </div>
            <h1 className="max-w-xl text-4xl font-semibold leading-tight text-slate-950">
              {t('layout.authTitle')}
            </h1>
            <p className="max-w-lg text-base leading-8 text-muted-foreground">
              {t('layout.authDescription')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

