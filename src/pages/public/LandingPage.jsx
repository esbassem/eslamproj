import { useState } from 'react';
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

  return (
    <div className="min-h-screen bg-[#36A1D2] lg:h-screen lg:overflow-hidden" dir="rtl">
      <div className="mx-auto grid min-h-screen w-full max-w-[1440px] gap-8 px-5 py-6 sm:px-8 lg:h-full lg:min-h-0 lg:grid-cols-[1.12fr_0.88fr] lg:px-14 lg:py-6">
        <motion.section
          initial={{ opacity: 0, x: -18 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.32, ease: 'easeOut' }}
          className="relative order-2 flex flex-col justify-between p-6 text-white sm:p-8 lg:order-1 lg:p-12"
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
          className="order-1 flex items-center justify-center lg:order-2"
        >
          <div className="w-full max-w-[380px] rounded-[28px] border border-white/30 bg-[#f4f6f9] p-5 shadow-[0_28px_70px_rgba(8,35,58,0.35)] sm:p-6">
            <div className="mb-5 h-1.5 w-20 rounded-full bg-slate-900/15" />

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

