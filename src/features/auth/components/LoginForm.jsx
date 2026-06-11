import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { ROUTES } from '@/core/config/routes.config';
import { useI18n } from '@/core/i18n/useI18n';
import { useAuth } from '@/features/auth/hooks/useAuth';

export function LoginForm({ className = '', compact = false, footerOverride = null }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { authError, clearAuthError, signIn } = useAuth();
  const [formState, setFormState] = useState({
    email: '',
    password: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const getLoginEmail = (value) => {
    const emailOrUsername = value.trim();

    if (!emailOrUsername) {
      return '';
    }

    return emailOrUsername.includes('@') ? emailOrUsername : `${emailOrUsername}@eslam.com`;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setIsSubmitting(true);
      setSubmitError('');
      clearAuthError();
      await signIn({
        ...formState,
        email: getLoginEmail(formState.email).toLowerCase(),
      });
      navigate(ROUTES.checkingSession);
    } catch (error) {
      setSubmitError(error.message || t('auth.messages.loginError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className={`space-y-5 ${className}`.trim()} onSubmit={handleSubmit}>
      <div className="space-y-2">
        <Label htmlFor="email">{t('auth.loginIdentifierLabel')}</Label>
        <Input
          id="email"
          type="text"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          dir="ltr"
          className="ltr-content text-base sm:text-sm"
          value={formState.email}
          onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
          placeholder={t('auth.loginIdentifierPlaceholder')}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">{t('common.labels.password')}</Label>
          <Link className="text-sm font-medium text-slate-500" to={ROUTES.forgotPassword}>
            {t('auth.forgotPassword')}
          </Link>
        </div>
        <Input
          id="password"
          type="password"
          dir="ltr"
          className="ltr-content text-base sm:text-sm"
          value={formState.password}
          onChange={(event) => setFormState((current) => ({ ...current, password: event.target.value }))}
          placeholder={t('common.placeholders.password')}
        />
      </div>
      {submitError || authError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {submitError || authError}
        </div>
      ) : null}
      <Button
        className="h-12 w-full rounded-xl bg-[#1E2635] text-base font-semibold text-white shadow-none transition-colors hover:bg-[#141B28] focus-visible:ring-2 focus-visible:ring-[#1E2635]/35"
        disabled={isSubmitting}
      >
        {isSubmitting ? t('auth.loginSubmitting') : t('auth.loginSubmit')}
      </Button>
      {footerOverride ??
        (compact ? (
          <p className="text-center text-sm text-slate-500">
            {t('auth.noAccount')}{' '}
            <Link className="font-semibold text-slate-900" to={ROUTES.signup}>
              {t('auth.createAccount')}
            </Link>
          </p>
        ) : null)}
    </form>
  );
}
