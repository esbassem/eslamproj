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
import { usePaymentMethods } from '@/features/finance/payments/hooks/usePaymentMethods';
import { usePayments } from '@/features/finance/payments/hooks/usePayments';

const formatMoney = (amount) => `${Number(amount || 0).toLocaleString()} EGP`;

export function PaymentSheet({
  open,
  onOpenChange,
  customer,
  invoice,
  total_amount = 0,
  paid_amount = 0,
  onConfirm,
}) {
  const { activeMethods, activeCashDestinations } = usePaymentMethods();
  const { rules, submitPayment, isSaving } = usePayments();
  const remainingAmount = Math.max(Number(total_amount) - Number(paid_amount), 0);
  const [amount, setAmount] = useState(String(remainingAmount));
  const [methodId, setMethodId] = useState('cash');
  const [cashDestinationId, setCashDestinationId] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState('');

  const availableMethods = useMemo(
    () => (activeMethods.length ? activeMethods : [{ id: 'cash', name: 'Cash', code: 'CASH', type: 'cash' }]),
    [activeMethods],
  );
  const availableCashDestinations = useMemo(
    () =>
      activeCashDestinations.length
        ? activeCashDestinations
        : [{ id: 'main-cashbox', name: 'Main Cashbox', active: true, default: true }],
    [activeCashDestinations],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    setAmount(String(remainingAmount));
    setMethodId(availableMethods[0]?.id || 'cash');
    setCashDestinationId(
      availableCashDestinations.find((destination) => destination.default)?.id || availableCashDestinations[0]?.id || '',
    );
    setNote('');
    setFormError('');
  }, [availableCashDestinations, availableMethods, open, remainingAmount]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setFormError('أدخل مبلغ دفع صحيح.');
      return;
    }

    if (!methodId) {
      setFormError('اختر وسيلة الدفع.');
      return;
    }

    if (rules?.require_cash_destination !== false && !cashDestinationId) {
      setFormError('اختر الخزنة.');
      return;
    }

    if (remainingAmount > 0 && numericAmount < remainingAmount && rules?.allow_partial_payments === false) {
      setFormError('الدفع الجزئي غير مسموح حاليًا.');
      return;
    }

    if (remainingAmount > 0 && numericAmount > remainingAmount && rules?.allow_overpayments === false) {
      setFormError('الدفع الزائد غير مسموح حاليًا.');
      return;
    }

    const payload = {
      customer,
      invoice,
      total_amount: Number(total_amount),
      paid_amount: Number(paid_amount),
      amount: numericAmount,
      payment_method_id: methodId,
      cash_destination_id: cashDestinationId,
      note: note.trim(),
    };

    const result = onConfirm ? await onConfirm(payload) : await submitPayment(payload);

    if (result?.error) {
      setFormError(result.error);
      return;
    }

    onOpenChange?.(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-3xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>تسجيل دفعة</SheetTitle>
          <SheetDescription>تحصيل مركزي قابل للاستخدام مع الفواتير ونقاط البيع وحساب العميل.</SheetDescription>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-6">
            <section className="grid gap-3 sm:grid-cols-3">
              <SummaryItem label="الإجمالي" value={formatMoney(total_amount)} />
              <SummaryItem label="المدفوع" value={formatMoney(paid_amount)} />
              <SummaryItem label="المتبقي" value={formatMoney(remainingAmount)} strong />
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="payment-amount">مبلغ الدفع</Label>
                <Input
                  id="payment-amount"
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

              <div className="space-y-2">
                <Label htmlFor="payment-method">وسيلة الدفع</Label>
                <select
                  id="payment-method"
                  className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm font-semibold text-slate-950 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                  value={methodId}
                  onChange={(event) => setMethodId(event.target.value)}
                >
                  {availableMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cash-destination">الخزنة</Label>
                <select
                  id="cash-destination"
                  className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm font-semibold text-slate-950 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                  value={cashDestinationId}
                  onChange={(event) => setCashDestinationId(event.target.value)}
                >
                  {availableCashDestinations.map((destination) => (
                    <option key={destination.id} value={destination.id}>
                      {destination.name}
                    </option>
                  ))}
                </select>
              </div>
            </section>

            <div className="space-y-2">
              <Label htmlFor="payment-note">ملاحظات</Label>
              <textarea
                id="payment-note"
                className="min-h-28 w-full resize-none rounded-xl border border-border bg-white px-4 py-3 text-right text-sm text-foreground outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                placeholder="اختياري"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </div>

            {formError ? <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange?.(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'جار التأكيد...' : 'تأكيد الدفع'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function SummaryItem({ label, value, strong }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className={strong ? 'mt-2 text-2xl font-extrabold text-emerald-700' : 'mt-2 text-xl font-bold text-slate-950'}>
        {value}
      </div>
    </div>
  );
}
