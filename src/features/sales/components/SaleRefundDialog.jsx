import { BanknoteArrowDown, CheckCircle2, LoaderCircle } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetDismissButton, SheetFooter, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { useSaleRefund } from '@/features/sales/hooks/useSaleReturn';

const money = (value, currency) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency}`;

export function SaleRefundDialog({ open, onOpenChange, tenantId, saleId, saleReturn, onRefunded }) {
  const state = useSaleRefund({ open, tenantId, saleId, saleReturnId: saleReturn?.id, onRefunded });
  const close = (next) => { if (!state.submitting) onOpenChange?.(next); };
  return <Sheet open={open} onOpenChange={close}><SheetContent side="bottom" dir="rtl" className="mx-auto max-h-[94vh] w-full max-w-xl overflow-x-hidden" aria-describedby="sale-refund-description">
    <SheetDismissButton aria-label="إغلاق نافذة رد المبلغ" disabled={state.submitting} />
    <SheetHeader className="pl-16"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><BanknoteArrowDown className="h-5 w-5" /></span><div><SheetTitle>رد المبلغ</SheetTitle><SheetDescription id="sale-refund-description">Money‑Out مستقل يستهلك فقط رصيد المرتجع القابل للرد.</SheetDescription></div></div></SheetHeader>
    {!state.options && !state.error ? <SheetBody><div role="status" className="flex min-h-48 items-center justify-center gap-2 font-bold text-slate-600"><LoaderCircle className="h-6 w-6 animate-spin" />جاري تحميل خيارات الرد...</div></SheetBody> : null}
    {state.result ? <><SheetBody><div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><CheckCircle2 className="h-8 w-8" /><h3 className="mt-2 text-lg font-black">تم رد المبلغ</h3><p className="mt-1 text-sm">{state.result.refundNumber} · {money(state.result.amount, state.credit?.currencyCode)}</p></div></SheetBody><SheetFooter><Button type="button" onClick={() => close(false)}>إغلاق</Button></SheetFooter></> : null}
    {state.options && !state.result ? <form className="contents" onSubmit={state.submit}><SheetBody className="space-y-4">
      <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs font-bold text-slate-500">المرتجع</p><p className="mt-1 font-black">{saleReturn?.returnNumber}</p><p className="mt-2 text-sm">الرصيد القابل للرد: <strong>{money(state.credit?.refundableAmount, state.credit?.currencyCode)}</strong></p></div>
      <label className="block text-sm font-black">المبلغ<input type="number" inputMode="decimal" min="0.01" step="0.01" max={state.credit?.refundableAmount} value={state.amount} onChange={(event) => state.setAmount(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3" /></label>
      <label className="block text-sm font-black">طريقة رد المبلغ<select value={state.methodId} onChange={(event) => state.chooseMethod(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="">اختر الطريقة</option>{state.methods.map((method) => <option key={method.id} value={method.id}>{method.name}</option>)}</select></label>
      {state.method ? <label className="block text-sm font-black">المورد المالي<select value={state.destinationId} onChange={(event) => state.setDestinationId(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="">اختر المورد</option>{state.method.destinations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
      <label className="block text-sm font-black">المرجع{state.method?.requiresReference ? ' *' : ''}<input value={state.reference} onChange={(event) => state.setReference(event.target.value)} className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3" /></label>
      <label className="block text-sm font-black">سبب رد المبلغ<textarea rows={2} maxLength={1000} value={state.reason} onChange={(event) => state.setReason(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal" /></label>
      <label className="block text-sm font-black">ملاحظات<textarea rows={2} value={state.notes} onChange={(event) => state.setNotes(event.target.value)} className="mt-2 w-full rounded-xl border border-slate-300 p-3 font-normal" /></label>
      {state.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900">{state.error.message}</p> : null}
    </SheetBody><SheetFooter className="flex-wrap"><Button type="button" variant="secondary" onClick={() => close(false)} disabled={state.submitting}>رجوع</Button><Button type="submit" disabled={Boolean(state.issue) || state.submitting}>{state.submitting ? <><LoaderCircle className="h-4 w-4 animate-spin" />جاري رد المبلغ...</> : 'تأكيد رد المبلغ'}</Button></SheetFooter></form> : null}
    {state.error && !state.options ? <SheetBody><p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 font-bold text-red-900">{state.error.message}</p><Button type="button" variant="secondary" className="mt-3" onClick={state.retry}>إعادة المحاولة</Button></SheetBody> : null}
  </SheetContent></Sheet>;
}
