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

export function PaymentSheet({ open, onOpenChange, total, paymentMethods, onSubmit, isSubmitting }) {
  const { t } = useI18n();
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [amount, setAmount] = useState(String(total || 0));
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (open) {
      setPaymentMethodId(paymentMethods[0]?.id ?? '');
      setAmount(String(total || 0));
      setFormError('');
    }
  }, [open, paymentMethods, total]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const numericAmount = Number(amount);
    if (!paymentMethodId) {
      setFormError(t('pos.sell.payment.validation.method'));
      return;
    }

    if (!Number.isFinite(numericAmount) || numericAmount < total) {
      setFormError(t('pos.sell.payment.validation.amount'));
      return;
    }

    const result = await onSubmit({ paymentMethodId, amount: numericAmount });

    if (result?.error) {
      setFormError(result.error);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-3xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>{t('pos.sell.payment.title')}</SheetTitle>
          <SheetDescription>{t('pos.sell.payment.description')}</SheetDescription>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm font-medium text-muted-foreground">{t('pos.sell.total')}</div>
              <div className="mt-1 text-3xl font-extrabold text-slate-950">{Number(total).toLocaleString()} EGP</div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pos-payment-method">{t('pos.sell.payment.method')}</Label>
              <select
                id="pos-payment-method"
                className="h-12 w-full rounded-xl border border-border bg-white px-4 text-sm font-semibold text-slate-950 outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200"
                value={paymentMethodId}
                onChange={(event) => setPaymentMethodId(event.target.value)}
              >
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name || method.code}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pos-payment-amount">{t('pos.sell.payment.amount')}</Label>
              <Input
                id="pos-payment-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                dir="ltr"
                className="ltr-content text-right"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
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
              {isSubmitting ? t('pos.sell.payment.submitting') : t('pos.sell.payment.confirm')}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
