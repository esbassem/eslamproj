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

const initialFormState = {
  name: '',
  code: '',
};

export function CreatePosLocationSheet({ open, onOpenChange, onSubmit, isSubmitting }) {
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

    if (!formState.name.trim()) {
      setFormError(t('pos.form.validation.required'));
      return;
    }

    setFormError('');
    const result = await onSubmit(formState);

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
          <SheetTitle>{t('pos.form.title')}</SheetTitle>
          <SheetDescription>{t('pos.form.description')}</SheetDescription>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="pos-name">{t('pos.form.name')}</Label>
              <Input id="pos-name" value={formState.name} onChange={handleChange('name')} placeholder={t('pos.form.namePlaceholder')} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pos-code">{t('pos.form.code')}</Label>
              <Input id="pos-code" dir="ltr" className="ltr-content" value={formState.code} onChange={handleChange('code')} placeholder={t('pos.form.codePlaceholder')} />
            </div>

            {formError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            ) : null}
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('pos.form.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('pos.form.submitting') : t('pos.form.submit')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
