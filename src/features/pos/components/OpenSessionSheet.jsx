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
  openingBalance: '0',
  note: '',
};

export function OpenSessionSheet({ config, open, onOpenChange, onSubmit, isSubmitting }) {
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

    const openingBalance = Number(formState.openingBalance);
    if (!Number.isFinite(openingBalance) || openingBalance < 0) {
      setFormError(t('pos.sessionForm.validation.openingBalance'));
      return;
    }

    setFormError('');
    const result = await onSubmit({
      openingBalance,
      note: formState.note,
    });

    if (result?.ok) {
      setFormState(initialFormState);
    } else if (result?.error) {
      setFormError(result.error);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-3xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>{t('pos.sessionForm.openTitle')}</SheetTitle>
          <SheetDescription>
            {config?.name ? t('pos.sessionForm.openDescription').replace('{name}', config.name) : t('pos.sessionForm.openDescriptionFallback')}
          </SheetDescription>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="pos-opening-balance">{t('pos.sessionForm.openingBalance')}</Label>
              <Input
                id="pos-opening-balance"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                dir="ltr"
                className="ltr-content text-right"
                value={formState.openingBalance}
                onChange={handleChange('openingBalance')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="pos-session-note">{t('pos.sessionForm.note')}</Label>
              <textarea
                id="pos-session-note"
                className="min-h-28 w-full rounded-xl border border-border bg-white px-4 py-3 text-sm text-slate-950 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                value={formState.note}
                onChange={handleChange('note')}
                placeholder={t('pos.sessionForm.notePlaceholder')}
              />
            </div>

            {formError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
            ) : null}
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              {t('pos.actions.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('pos.sessionForm.opening') : t('pos.actions.confirmOpen')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
