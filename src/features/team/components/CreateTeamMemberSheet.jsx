import { useEffect, useState } from 'react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetDismissButton,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { useI18n } from '@/core/i18n/useI18n';
import { TEAM_ROLE_OPTIONS } from '@/features/team/api/team.api';

const initialFormState = {
  fullName: '',
  email: '',
  password: '',
  role: 'staff',
  phone: '',
};

export function CreateTeamMemberSheet({ open, onOpenChange, onSubmit, isSubmitting }) {
  const { t } = useI18n();
  const [formState, setFormState] = useState(initialFormState);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) {
      setFormState(initialFormState);
      setFormError('');
    }
  }, [open]);

  const handleChange = (field) => (event) => {
    setFormState((current) => ({ ...current, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    console.log('[Team] submit clicked', {
      fullName: formState.fullName,
      email: formState.email,
      role: formState.role,
      phone: formState.phone,
      passwordLength: formState.password.trim().length,
    });

    if (!formState.fullName.trim() || !formState.email.trim() || !formState.password.trim() || !formState.role) {
      console.log('[Team] submit stopped by validation: required fields');
      setFormError(t('team.form.validation.required'));
      return;
    }

    if (formState.password.trim().length < 8) {
      console.log('[Team] submit stopped by validation: password too short');
      setFormError(t('team.form.validation.passwordLength'));
      return;
    }

    setFormError('');
    console.log('[Team] validation passed, calling onSubmit');
    const result = await onSubmit({
      fullName: formState.fullName,
      email: formState.email,
      password: formState.password,
      role: formState.role,
      phone: formState.phone,
    });

    console.log('[Team] onSubmit result', result);

    if (result?.ok) {
      setFormState(initialFormState);
    } else if (result?.error) {
      setFormError(result.error);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>{t('team.form.title')}</SheetTitle>
          <SheetDescription>{t('team.form.description')}</SheetDescription>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="team-full-name">{t('team.form.fullName')}</Label>
              <Input
                id="team-full-name"
                value={formState.fullName}
                onChange={handleChange('fullName')}
                placeholder={t('team.form.fullNamePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-email">{t('team.form.email')}</Label>
              <Input
                id="team-email"
                type="email"
                dir="ltr"
                className="ltr-content"
                value={formState.email}
                onChange={handleChange('email')}
                placeholder={t('common.placeholders.companyEmail')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-password">{t('team.form.password')}</Label>
              <Input
                id="team-password"
                type="password"
                dir="ltr"
                className="ltr-content"
                value={formState.password}
                onChange={handleChange('password')}
                placeholder={t('team.form.passwordPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-role">{t('team.form.role')}</Label>
              <select
                id="team-role"
                value={formState.role}
                onChange={handleChange('role')}
                className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
              >
                {TEAM_ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>
                    {t(`team.roles.${role}`)}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="team-phone">{t('team.form.phone')}</Label>
              <Input
                id="team-phone"
                dir="ltr"
                className="ltr-content"
                value={formState.phone}
                onChange={handleChange('phone')}
                placeholder={t('team.form.phonePlaceholder')}
              />
            </div>

            {formError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            ) : null}
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('team.form.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('team.form.submitting') : t('team.form.submit')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
