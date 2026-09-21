import { useEffect, useMemo, useRef } from 'react';
import { Banknote, CheckCircle2, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/core/ui/button';
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
import { useSettlementWorkspace } from '../hooks/useSettlementWorkspace';
import { getSettlementReasonMessage } from '../services/settlement.model';
import { MoneyPaymentFields } from './MoneyPaymentFields';

const MECHANISM_RENDERERS = Object.freeze({
  money_payment: MoneyPaymentFields,
});

const MECHANISM_LABELS = Object.freeze({
  money_payment: 'تحصيل مالي',
});

export function formatSettlementMoney(value, currencyCode = 'EGP') {
  const numericValue = Number(value || 0);
  return `${numericValue.toLocaleString('ar-EG', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${currencyCode || ''}`.trim();
}

function SummaryItem({ label, value, accent = false }) {
  return (
    <div className="min-w-0 rounded-xl bg-white px-3 py-3 ring-1 ring-slate-200">
      <dt className="text-xs font-bold text-slate-500">{label}</dt>
      <dd className={`mt-1 truncate font-mono text-base font-black ${accent ? 'text-emerald-700' : 'text-slate-950'}`}>{value}</dd>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-center text-slate-600" role="status">
      <LoaderCircle className="h-7 w-7 animate-spin" />
      <p className="text-sm font-bold">جاري تحميل الرصيد وخيارات التحصيل...</p>
    </div>
  );
}

export function SettlementDialog({ open, onOpenChange, targetType, targetId, onSettled, onTargetRefresh }) {
  const amountInputRef = useRef(null);
  const workspace = useSettlementWorkspace({ open, targetType, targetId, onSettled, onTargetRefresh });
  const {
    status,
    options,
    form,
    selectedMechanism,
    selectedPaymentMethod,
    error,
    notice,
    result,
    submitting,
    setField,
    submit,
    retryOptions,
    startAnother,
  } = workspace;
  const MechanismRenderer = MECHANISM_RENDERERS[form.mechanism] ?? null;
  const supportedMechanisms = useMemo(
    () => (options?.settlementMechanisms ?? []).filter((item) => MECHANISM_RENDERERS[item.code]),
    [options?.settlementMechanisms],
  );
  const amount = Number(form.amount || 0);
  const remainingAfter = Math.max(Number(options?.outstandingAmount || 0) - (Number.isFinite(amount) ? amount : 0), 0);

  useEffect(() => {
    if (open && status === 'ready' && !result) amountInputRef.current?.focus();
  }, [open, result, status]);

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && submitting) return;
    if (!nextOpen && result) startAnother();
    onOpenChange?.(nextOpen);
  };

  const cannotSettleMessage = options?.reasonCodes?.map(getSettlementReasonMessage)[0];

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="left"
        dir="rtl"
        className="w-full max-w-none sm:max-w-xl"
        aria-describedby="settlement-dialog-description"
        onEscapeKeyDown={(event) => { if (submitting) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (submitting) event.preventDefault(); }}
      >
        <SheetDismissButton aria-label="إغلاق نافذة التحصيل" disabled={submitting} />
        <SheetHeader className="pr-6">
          <div className="flex min-w-0 items-center gap-3 pl-10">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <Banknote className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <SheetTitle>تحصيل مستحق</SheetTitle>
              <SheetDescription id="settlement-dialog-description" className="truncate">
                {options?.party?.name || 'سيتم تحميل بيانات العميل والمستند من النظام المالي.'}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {status === 'loading' && !options ? <SheetBody><LoadingState /></SheetBody> : null}

        {status === 'error' && !options ? (
          <SheetBody>
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center text-red-900">
              <CircleAlert className="mx-auto h-7 w-7" aria-hidden="true" />
              <p className="mt-3 font-black">{error?.message || 'تعذر تحميل بيانات التحصيل.'}</p>
              <Button type="button" variant="secondary" className="mt-4" onClick={retryOptions}>
                <RefreshCw className="h-4 w-4" /> إعادة المحاولة
              </Button>
            </div>
          </SheetBody>
        ) : null}

        {options && result ? (
          <>
            <SheetBody className="space-y-5">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950" role="status">
                <CheckCircle2 className="h-8 w-8" aria-hidden="true" />
                <h3 className="mt-3 text-lg font-black">تم التحصيل بنجاح</h3>
                <p className="mt-1 text-sm">
                  تم تحصيل {formatSettlementMoney(result.amount, result.currencyCode)}
                  {result.paymentNumber ? <> — رقم العملية <b dir="ltr">{result.paymentNumber}</b></> : null}
                </p>
                {result.idempotentReplay ? <p className="mt-2 text-xs font-bold">تم تأكيد نتيجة المحاولة السابقة دون إنشاء عملية مكررة.</p> : null}
              </div>
              <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                <SummaryItem label="المستحق قبل العملية" value={formatSettlementMoney(result.outstandingBefore, result.currencyCode)} />
                <SummaryItem label="المتبقي بعد العملية" value={formatSettlementMoney(result.outstandingAfter, result.currencyCode)} accent />
              </dl>
              {notice ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{notice}</p> : null}
            </SheetBody>
            <SheetFooter className="flex-wrap">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>إغلاق</Button>
              {options.canSettle && Number(options.outstandingAmount || 0) > 0 ? (
                <Button type="button" onClick={startAnother}>تحصيل دفعة أخرى</Button>
              ) : null}
            </SheetFooter>
          </>
        ) : null}

        {options && !result ? (
          <form className="contents" onSubmit={submit} noValidate>
            <SheetBody className="space-y-5 overflow-x-hidden">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-500">العميل</p>
                    <p className="mt-1 truncate font-black text-slate-950">{options.party.name || '—'}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-500">المستند</p>
                    <p className="mt-1 truncate font-black text-slate-950" dir="ltr">{options.target.reference || options.target.id}</p>
                  </div>
                </div>
                <div className="mt-3 flex min-w-0 items-center justify-between gap-3 border-t border-slate-200 pt-3">
                  <span className="text-sm font-bold text-slate-600">الرصيد المستحق الحالي</span>
                  <strong className="shrink-0 font-mono text-lg text-slate-950">{formatSettlementMoney(options.outstandingAmount, options.currencyCode)}</strong>
                </div>
              </div>

              {supportedMechanisms.length > 1 ? (
                <label className="block text-sm font-bold text-slate-800">
                  <span>نوع التسوية</span>
                  <select
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:ring-4 focus:ring-slate-100"
                    value={form.mechanism}
                    onChange={(event) => setField('mechanism', event.target.value)}
                    disabled={submitting}
                  >
                    {supportedMechanisms.map((mechanism) => (
                      <option key={mechanism.code} value={mechanism.code}>{MECHANISM_LABELS[mechanism.code] || mechanism.code}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              {options.canSettle && MechanismRenderer ? (
                <MechanismRenderer
                  form={form}
                  mechanism={selectedMechanism}
                  selectedPaymentMethod={selectedPaymentMethod}
                  outstandingAmount={options.outstandingAmount}
                  currencyCode={options.currencyCode}
                  disabled={submitting || status === 'refreshing'}
                  onFieldChange={setField}
                  formatMoney={formatSettlementMoney}
                  amountInputRef={amountInputRef}
                />
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-900">
                  {cannotSettleMessage || 'لا توجد آلية تحصيل مدعومة ومتاحة لهذا المستند.'}
                </div>
              )}

              {options.canSettle && MechanismRenderer ? (
                <dl className="grid min-w-0 grid-cols-1 gap-3 rounded-2xl bg-slate-100 p-3 sm:grid-cols-3">
                  <SummaryItem label="المستحق الحالي" value={formatSettlementMoney(options.outstandingAmount, options.currencyCode)} />
                  <SummaryItem label="سيتم تحصيل" value={formatSettlementMoney(amount, options.currencyCode)} />
                  <SummaryItem label="المتبقي" value={formatSettlementMoney(remainingAfter, options.currencyCode)} accent />
                </dl>
              ) : null}

              {status === 'refreshing' ? <p role="status" className="text-center text-xs font-bold text-slate-500">جاري تحديث الخيارات...</p> : null}
              {error ? (
                <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900">
                  <p>{error.message}</p>
                </div>
              ) : null}
              {notice ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{notice}</p> : null}
            </SheetBody>
            <SheetFooter className="flex-wrap">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)} disabled={submitting}>إلغاء</Button>
              <Button
                type="submit"
                disabled={submitting || status === 'refreshing' || !options.canSettle || !MechanismRenderer}
                aria-busy={submitting}
              >
                {submitting ? <><LoaderCircle className="h-4 w-4 animate-spin" /> جاري التحصيل...</> : 'تأكيد التحصيل'}
              </Button>
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
