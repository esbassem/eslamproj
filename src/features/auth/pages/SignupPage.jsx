import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AuthFormShell } from '@/features/auth/components/AuthFormShell';
import { Button } from '@/core/ui/button';
import { useI18n } from '@/core/i18n/useI18n';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { ROUTES } from '@/core/config/routes.config';
import { useAuth } from '@/features/auth/hooks/useAuth';

export function SignupPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { authError, clearAuthError, signUp } = useAuth();
  const [formState, setFormState] = useState({
    fullName: '',
    email: '',
    password: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setIsSubmitting(true);
      setSubmitError('');
      setSuccessMessage('');
      clearAuthError();
      const result = await signUp(formState);

      if (result.requiresEmailVerification) {
        setSuccessMessage(t('auth.messages.signupSuccess'));
        return;
      }

      navigate(ROUTES.checkingSession);
    } catch (error) {
      setSubmitError(error.message || t('auth.messages.signupError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthFormShell
      title={t('auth.signupTitle')}
      description={t('auth.signupDescription')}
      footer={
        <p className="text-sm text-muted-foreground">
          {t('auth.existingAccount')}{' '}
          <Link className="font-semibold text-slate-900" to={ROUTES.landing}>
            {t('common.actions.login')}
          </Link>
        </p>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="fullName">{t('common.labels.fullName')}</Label>
          <Input
            id="fullName"
            value={formState.fullName}
            onChange={(event) => setFormState((current) => ({ ...current, fullName: event.target.value }))}
            placeholder={t('common.placeholders.fullName')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="signupEmail">{t('common.labels.workEmail')}</Label>
          <Input
            id="signupEmail"
            type="email"
            dir="ltr"
            className="ltr-content"
            value={formState.email}
            onChange={(event) => setFormState((current) => ({ ...current, email: event.target.value }))}
            placeholder={t('common.placeholders.companyEmail')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="signupPassword">{t('common.labels.password')}</Label>
          <Input
            id="signupPassword"
            type="password"
            dir="ltr"
            className="ltr-content"
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
        {successMessage ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}
        <Button className="w-full" disabled={isSubmitting}>
          {isSubmitting ? t('auth.signupSubmitting') : t('auth.signupSubmit')}
        </Button>
      </form>
    </AuthFormShell>
  );
}

