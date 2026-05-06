import { useEffect, useMemo, useState } from 'react';
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

export function CloseSessionSheet({ session, open, onOpenChange, onSubmit, isSubmitting }) {
  const { t } = useI18n();
  const [closingBalance, setClosingBalance] = useState('');
  const [formError, setFormError] = useState('');
  const openingBalance = Number(session?.openingBalance ?? 0);
  const numericClosingBalance = Number(closingBalance);
  const difference = useMemo(() => {
    if (!Number.isFinite(numericClosingBalance)) {
      return 0;
    }

    return numericClosingBalance - openingBalance;
  }, [numericClosingBalance, openingBalance]);

  useEffect(() => {
    if (open) {
      setClosingBalance(String(session?.closingBalance ?? session?.openingBalance ?? 0));
      setFormError('');
    }
  }, [open, session?.closingBalance, session?.openingBalance]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!Number.isFinite(numericClosingBalance) || numericClosingBalance < 0) {
      setFormError(t('pos.sessionForm.validation.closingBalance'));
      return;
    }

    setFormError('');
    const result = await onSubmit({
      closingBalance: numericClosingBalance,
    });

    if (result?.error) {
      setFormError(result.error);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-3xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>{t('pos.sessionForm.closeTitle')}</SheetTitle>
          <SheetDescription>{t('pos.sessionForm.closeDescription')}</SheetDescription>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm font-medium text-muted-foreground">{t('pos.sessionForm.openingBalance')}</div>
              <div className="mt-1 text-2xl font-extrabold text-slate-950">{openingBalance.toLocaleString()} EGP</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pos-closing-balance">{t('pos.sessionForm.closingBalance')}</Label>
              <Input
                id="pos-closing-balance"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                dir="ltr"
                className="ltr-content text-right"
                value={closingBalance}
                onChange={(event) => setClosingBalance(event.target.value)}
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="text-sm font-medium text-muted-foreground">{t('pos.sessionForm.difference')}</div>
              <div className={`mt-1 text-xl font-extrabold ${difference < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                {difference.toLocaleString()} EGP
              </div>
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
              {isSubmitting ? t('pos.sessionForm.closing') : t('pos.actions.confirmClose')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
