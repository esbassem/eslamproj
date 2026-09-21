import { Ban, CheckCircle2, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
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
import { useSaleCancellation } from '@/features/sales/hooks/useSaleCancellation';

const money = (value, currency) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency}`;
const quantity = (value) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 4 });

function SummaryItem({ label, value }) {
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="mt-1 truncate font-black text-slate-950">{value || '—'}</dd></div>;
}

export function SaleCancellationDialog({ open, onOpenChange, tenantId, sale, initialEligibility, onCancelled, onVersionConflict, onTargetRefresh }) {
  const cancellation = useSaleCancellation({
    open,
    tenantId,
    sale,
    initialEligibility,
    onCancelled,
    onVersionConflict,
    onTargetRefresh,
  });
  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && cancellation.submitting) return;
    onOpenChange?.(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="bottom" dir="rtl" className="mx-auto max-h-[94vh] w-full max-w-xl overflow-x-hidden" aria-describedby="sale-cancellation-description" onEscapeKeyDown={(event) => { if (cancellation.submitting) event.preventDefault(); }} onPointerDownOutside={(event) => { if (cancellation.submitting) event.preventDefault(); }}>
        <SheetDismissButton aria-label="إغلاق نافذة إلغاء البيع" disabled={cancellation.submitting} />
        <SheetHeader className="pl-16">
          <div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-700"><Ban className="h-5 w-5" /></span><div className="min-w-0"><SheetTitle>إلغاء البيع</SheetTitle><SheetDescription id="sale-cancellation-description">سيتم إلغاء البيع وتحرير البضاعة المحجوزة وعكس الأثر المالي.</SheetDescription></div></div>
        </SheetHeader>

        {cancellation.status === 'loading' && !cancellation.eligibility ? <SheetBody><div role="status" className="flex min-h-56 flex-col items-center justify-center gap-3 text-slate-600"><LoaderCircle className="h-7 w-7 animate-spin" /><p className="text-sm font-bold">جاري التحقق من إمكانية الإلغاء...</p></div></SheetBody> : null}
        {cancellation.status === 'error' && !cancellation.eligibility ? <SheetBody><div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center text-red-900"><CircleAlert className="mx-auto h-7 w-7" /><p className="mt-3 font-black">{cancellation.error?.message || 'تعذر تحميل جاهزية الإلغاء.'}</p><Button type="button" variant="secondary" className="mt-4" onClick={cancellation.retryEligibility}><RefreshCw className="h-4 w-4" />إعادة المحاولة</Button></div></SheetBody> : null}

        {cancellation.result ? <><SheetBody><div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><CheckCircle2 className="h-8 w-8" /><h3 className="mt-3 text-lg font-black">تم إلغاء البيع بنجاح</h3><p className="mt-1 text-sm">تم تحرير الحجز وعكس الأثر المالي مع الاحتفاظ بسجل البيع الأصلي.</p></div></SheetBody><SheetFooter><Button type="button" onClick={() => handleOpenChange(false)}>إغلاق</Button></SheetFooter></> : null}

        {cancellation.eligibility && !cancellation.result ? <form className="contents" onSubmit={cancellation.submit} noValidate><SheetBody className="space-y-4 overflow-x-hidden">
          <dl className="grid min-w-0 grid-cols-2 gap-3"><SummaryItem label="رقم البيع" value={sale?.saleNumber} /><SummaryItem label="العميل" value={sale?.customer?.name} /><SummaryItem label="الإجمالي الأصلي" value={money(sale?.totalAmount, sale?.currencyCode)} /><SummaryItem label="المتبقي المالي" value={money(sale?.payment?.outstandingAmount, sale?.payment?.currencyCode)} /><SummaryItem label="تم تسليمه" value={quantity(sale?.fulfillment?.deliveredQuantity)} /><SummaryItem label="محجوز حاليًا" value={quantity(sale?.fulfillment?.reservedQuantity)} /></dl>
          {!cancellation.eligibility.canCancel ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">{cancellation.eligibility.reasonMessage}</p> : null}
          <label className="block text-sm font-black text-slate-700">سبب الإلغاء<textarea value={cancellation.reason} onChange={(event) => cancellation.setReason(event.target.value)} maxLength={1000} rows={4} disabled={cancellation.submitting || !cancellation.eligibility.canCancel} className="mt-2 w-full resize-y rounded-xl border border-slate-300 p-3 text-base font-normal outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" placeholder="اكتب سببًا واضحًا للإلغاء" /></label>
          {cancellation.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900">{cancellation.error.message}</p> : null}
        </SheetBody><SheetFooter className="flex-wrap"><Button type="button" variant="secondary" onClick={() => handleOpenChange(false)} disabled={cancellation.submitting}>رجوع</Button><Button type="submit" className="bg-red-700 hover:bg-red-800" disabled={!cancellation.canSubmit || cancellation.submitting} aria-busy={cancellation.submitting}>{cancellation.submitting ? <><LoaderCircle className="h-4 w-4 animate-spin" />جاري الإلغاء...</> : 'تأكيد الإلغاء'}</Button></SheetFooter></form> : null}
      </SheetContent>
    </Sheet>
  );
}
