import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';

function Select({ className = '', ...props }) {
  return (
    <select
      className={`mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    />
  );
}

function Field({ label, required = false, children }) {
  return (
    <Label className="block text-sm font-bold text-slate-800">
      <span>{label}{required ? <span className="text-red-600"> *</span> : null}</span>
      {children}
    </Label>
  );
}

export function MoneyPaymentFields({
  form,
  mechanism,
  selectedPaymentMethod,
  outstandingAmount,
  currencyCode,
  disabled,
  onFieldChange,
  formatMoney,
  amountInputRef,
}) {
  const paymentMethods = mechanism?.paymentMethods ?? [];
  const destinations = selectedPaymentMethod?.moneyDestinations ?? [];

  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="مبلغ التحصيل">
          <Input
            ref={amountInputRef}
            className="mt-2 text-left font-mono font-bold"
            dir="ltr"
            type="number"
            min="0.01"
            max={outstandingAmount || undefined}
            step="0.01"
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => onFieldChange('amount', event.target.value)}
            disabled={disabled}
            aria-describedby="settlement-amount-help"
          />
          <small id="settlement-amount-help" className="mt-1.5 block text-xs text-slate-500">
            الحد الأقصى: {formatMoney(outstandingAmount, currencyCode)} — يمكن تحصيل مبلغ جزئي.
          </small>
        </Field>

        <Field label="طريقة الدفع">
          <Select
            value={form.paymentMethodId}
            onChange={(event) => onFieldChange('paymentMethodId', event.target.value)}
            disabled={disabled || !paymentMethods.length}
          >
            <option value="">اختر طريقة الدفع</option>
            {paymentMethods.map((method) => (
              <option key={method.id} value={method.id}>{method.name}</option>
            ))}
          </Select>
        </Field>
      </div>

      {selectedPaymentMethod?.requiresMoneyDestination ? (
        <Field label="مكان التحصيل" required>
          <Select
            value={form.moneyDestinationId}
            onChange={(event) => onFieldChange('moneyDestinationId', event.target.value)}
            disabled={disabled || !destinations.length}
          >
            <option value="">اختر مكان التحصيل</option>
            {destinations.map((destination) => (
              <option key={destination.id} value={destination.id}>{destination.name}</option>
            ))}
          </Select>
        </Field>
      ) : null}

      <div className="grid min-w-0 gap-4 sm:grid-cols-2">
        <Field label="رقم المرجع" required={selectedPaymentMethod?.requiresReference}>
          <Input
            className="mt-2"
            value={form.referenceNumber}
            onChange={(event) => onFieldChange('referenceNumber', event.target.value)}
            disabled={disabled}
            maxLength={500}
            placeholder="رقم إيصال أو مرجع اختياري"
          />
        </Field>
        <Field label="ملاحظات">
          <textarea
            className="mt-2 min-h-24 w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
            value={form.notes}
            onChange={(event) => onFieldChange('notes', event.target.value)}
            disabled={disabled}
            maxLength={4000}
            rows={3}
            placeholder="ملاحظة اختيارية عن التحصيل"
          />
        </Field>
      </div>
    </div>
  );
}
