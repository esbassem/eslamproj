import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AuthFormShell } from '@/features/auth/components/AuthFormShell';
import { Button } from '@/core/ui/button';
import { useI18n } from '@/core/i18n/useI18n';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { ROUTES } from '@/core/config/routes.config';
import { authService } from '@/features/auth/api/auth.api';

export function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setIsSubmitting(true);
      setSubmitError('');
      setSuccessMessage('');
      await authService.resetPassword(email, window.location.origin);
      setSuccessMessage(t('auth.messages.forgotSuccess'));
    } catch (error) {
      setSubmitError(error.message || t('auth.messages.forgotError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthFormShell
      title={t('auth.forgotTitle')}
      description={t('auth.forgotDescription')}
      footer={
        <p className="text-sm text-muted-foreground">
          {t('auth.forgotRemembered')}{' '}
          <Link className="font-semibold text-slate-900" to={ROUTES.landing}>
            {t('common.actions.backToLogin')}
          </Link>
        </p>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="recoveryEmail">{t('common.labels.email')}</Label>
          <Input
            id="recoveryEmail"
            type="email"
            dir="ltr"
            className="ltr-content"
            placeholder={t('common.placeholders.companyEmail')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        {submitError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {submitError}
          </div>
        ) : null}
        {successMessage ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}
        <Button className="w-full" type="submit" disabled={isSubmitting}>
          {isSubmitting ? t('auth.forgotSubmitting') : t('auth.forgotSubmit')}
        </Button>
      </form>
    </AuthFormShell>
  );
}

