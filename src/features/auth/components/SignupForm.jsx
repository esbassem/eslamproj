import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { ROUTES } from '@/core/config/routes.config';
import { useI18n } from '@/core/i18n/useI18n';
import { useAuth } from '@/features/auth/hooks/useAuth';

export function SignupForm({ className = '', compact = false, footerOverride = null }) {
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
    <form className={`space-y-5 ${className}`.trim()} onSubmit={handleSubmit}>
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
      {footerOverride ??
        (compact ? (
          <p className="text-center text-sm text-slate-500">{t('auth.existingAccount')}</p>
        ) : null)}
    </form>
  );
}
