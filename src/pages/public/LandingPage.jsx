import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useI18n } from '@/core/i18n/useI18n';
import { Logo } from '@/core/ui/logo';
import { fallbackAppNavigation } from '@/core/config/navigation.config';
import { LoginForm } from '@/features/auth/components/LoginForm';
import { SignupForm } from '@/features/auth/components/SignupForm';

export function LandingPage() {
  const { t } = useI18n();
  const [isSignupMode, setIsSignupMode] = useState(false);

  const appIconColors = ['#2563EB', '#0EA5E9', '#14B8A6', '#22C55E', '#F59E0B', '#F97316', '#A855F7', '#EC4899'];

  useEffect(() => {
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (!viewportMeta) return undefined;

    const previousViewport = viewportMeta.getAttribute('content') || 'width=device-width, initial-scale=1.0';
    viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');

    const preventPinchZoom = (event) => {
      if (event.touches?.length > 1) {
        event.preventDefault();
      }
    };
    const preventGestureZoom = (event) => {
      event.preventDefault();
    };

    document.addEventListener('touchmove', preventPinchZoom, { passive: false });
    document.addEventListener('gesturestart', preventGestureZoom, { passive: false });
    document.addEventListener('gesturechange', preventGestureZoom, { passive: false });

    return () => {
      viewportMeta.setAttribute('content', previousViewport);
      document.removeEventListener('touchmove', preventPinchZoom);
      document.removeEventListener('gesturestart', preventGestureZoom);
      document.removeEventListener('gesturechange', preventGestureZoom);
    };
  }, []);

  return (
    <div className="h-[100dvh] max-h-[100dvh] overflow-hidden bg-[#36A1D2] lg:h-screen lg:max-h-none lg:overflow-hidden" dir="rtl">
      <div className="mx-auto grid h-full max-h-full min-h-0 w-full max-w-[1440px] gap-8 overflow-hidden px-0 py-0 sm:px-8 sm:py-6 lg:grid-cols-[1.12fr_0.88fr] lg:px-14">
        <motion.section
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
          className="relative order-2 hidden flex-col justify-between p-6 text-white sm:flex sm:p-8 lg:order-1 lg:p-12"
        >
          <div className="mx-auto w-full max-w-2xl space-y-8">
            <Logo />

            <div className="space-y-4">
              <h1 className="text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-[2.45rem]">منصة تطبيقات أعمال متكاملة</h1>
              <p className="max-w-xl text-base leading-8 text-white/90">منصة مصممة خصيصًا لمساعدة المشاريع والمتاجر على إدارة البيع، المخزون، الحسابات، والعمل اليومي من مكان واحد.</p>
            </div>

            <div className="grid grid-cols-4 gap-3 sm:grid-cols-5">
              {fallbackAppNavigation.map((app, index) => {
                const Icon = app.icon;
                const iconColor = appIconColors[index % appIconColors.length];
                const appTitle = t(app.titleKey);

                return (
                  <div key={`${app.href}-${app.titleKey}`} className="flex flex-col items-center gap-2 rounded-xl bg-white px-3 py-3 text-center ring-1 ring-slate-200/70">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl text-white" style={{ backgroundColor: iconColor }}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="line-clamp-1 text-[11px] font-semibold text-slate-700">{appTitle}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="mx-auto mt-8 w-full max-w-2xl border-t border-white/30 pt-4 text-xs text-white/80">{t('landing.footerPrimary')}</p>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.32, ease: 'easeOut', delay: 0.05 }}
          className="order-1 flex h-full max-h-full min-h-0 items-stretch justify-center overflow-hidden sm:items-center lg:order-2"
        >
          <div className="relative flex h-full max-h-full min-h-0 w-full max-w-none flex-col justify-center overflow-hidden border-0 bg-[#f4f6f9] p-6 shadow-none sm:h-auto sm:max-w-[380px] sm:rounded-[28px] sm:border sm:border-white/30 sm:p-6 sm:shadow-[0_28px_70px_rgba(8,35,58,0.35)]">
            <div className="absolute inset-x-6 top-[calc(env(safe-area-inset-top)+12px)] sm:hidden">
              <div className="flex items-center justify-start gap-4">
                <Logo className="[&>div:first-child]:h-11 [&>div:first-child]:w-11 [&>div:first-child]:rounded-2xl" />
              </div>
            </div>

            <div className="mb-5 hidden h-1.5 w-20 rounded-full bg-slate-900/15 sm:block" />

            <div className="space-y-2 text-right">
              <h2 className="text-3xl font-extrabold tracking-tight text-slate-900">ابدأ الآن</h2>
              <p className="text-sm text-slate-600">{isSignupMode ? 'أنشئ حسابك الجديد من هنا.' : 'سجّل دخولك مباشرة من هنا.'}</p>
            </div>

            <div className="mt-6">
              {isSignupMode ? (
                <SignupForm
                  compact
                  footerOverride={
                    <p className="border-t border-slate-200 pt-4 text-center text-sm text-slate-600">
                      لديك حساب بالفعل؟{' '}
                      <button
                        type="button"
                        className="font-semibold text-slate-900 hover:text-slate-700"
                        onClick={() => setIsSignupMode(false)}
                      >
                        تسجيل الدخول
                      </button>
                    </p>
                  }
                />
              ) : (
                <LoginForm
                  compact
                  footerOverride={
                    <p className="border-t border-slate-200 pt-4 text-center text-sm text-slate-600">
                      ليس لديك حساب؟{' '}
                      <button
                        type="button"
                        className="font-semibold text-slate-900 hover:text-slate-700"
                        onClick={() => setIsSignupMode(true)}
                      >
                        تسجيل جديد
                      </button>
                    </p>
                  }
                />
              )}
            </div>
          </div>
        </motion.section>
      </div>
    </div>
  );
}
