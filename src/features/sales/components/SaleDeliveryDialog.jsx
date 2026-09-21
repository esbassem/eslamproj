import { CheckCircle2, CircleAlert, LoaderCircle, PackageCheck, RefreshCw } from 'lucide-react';
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
import { useSaleDelivery } from '@/features/sales/hooks/useSaleDelivery';
import { getSaleDeliveryReasonMessage } from '@/features/sales/services/salesDelivery.model';

const formattedQuantity = (value) => Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 4 });

function SummaryItem({ label, value }) {
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="mt-1 truncate font-black text-slate-950">{value || '—'}</dd></div>;
}

function findTrackingDetails(sale, saleLineId, trackingUnitId) {
  return sale?.lines?.find((line) => line.id === saleLineId)?.inventory?.trackingUnits
    ?.find((unit) => unit.id === trackingUnitId) ?? null;
}

function SerializedLine({ line, sale, selection, setTrackingUnit }) {
  const units = line.trackingUnits.filter((unit) => unit.deliverable);
  return (
    <article className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><h3 className="truncate font-black text-slate-950">{line.productName}</h3><p className="mt-1 text-xs text-slate-500">اختر القطع التي سيتم تسليمها الآن.</p></div>
        <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-black text-violet-700">متبقٍ {formattedQuantity(line.remainingQuantity)}</span>
      </div>
      <div className="mt-3 space-y-2">
        {units.map((unit) => {
          const details = findTrackingDetails(sale, line.saleLineId, unit.id);
          const chassis = details?.chassisNumber || unit.trackingNumber;
          return (
            <label key={unit.id} className="flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border border-violet-100 bg-white p-3">
              <input
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0 accent-violet-600"
                checked={selection.trackingUnits?.[`${line.saleLineId}:${unit.id}`] === true}
                onChange={(event) => setTrackingUnit(line.saleLineId, unit.id, event.target.checked)}
              />
              <span className="min-w-0 text-sm">
                <span className="block font-black">شاسيه: <span dir="ltr">{chassis || '—'}</span></span>
                {details?.engineNumber ? <span className="mt-0.5 block text-slate-600">موتور: <span dir="ltr">{details.engineNumber}</span></span> : null}
                {details?.attributes?.length ? <span className="mt-1 block text-xs text-violet-800">{details.attributes.map((item) => `${item.name}: ${item.value}`).join('، ')}</span> : null}
              </span>
            </label>
          );
        })}
        {!units.length ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">لا توجد قطع متسلسلة قابلة للتسليم في هذا البند.</p> : null}
      </div>
    </article>
  );
}

function QuantityLine({ line, selection, setQuantity }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="truncate font-black text-slate-950">{line.productName}</h3>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <SummaryItem label="المطلوب" value={formattedQuantity(line.orderedQuantity)} />
        <SummaryItem label="تم تسليمه" value={formattedQuantity(line.deliveredQuantity)} />
        <SummaryItem label="المتبقي" value={formattedQuantity(line.remainingQuantity)} />
      </dl>
      <label className="mt-4 block text-sm font-black text-slate-700">
        كمية هذه العملية
        <input
          type="number"
          inputMode="decimal"
          min="0"
          max={line.remainingQuantity}
          step="0.0001"
          value={selection.quantities?.[line.saleLineId] ?? ''}
          onChange={(event) => setQuantity(line.saleLineId, event.target.value)}
          className="mt-2 h-12 w-full rounded-xl border border-slate-300 px-3 text-base font-black outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
        />
      </label>
    </article>
  );
}

export function SaleDeliveryDialog({
  open,
  onOpenChange,
  tenantId,
  sale,
  onDelivered,
  onVersionConflict,
  onTargetRefresh,
}) {
  const delivery = useSaleDelivery({
    open,
    tenantId,
    saleId: sale?.id,
    onDelivered,
    onVersionConflict,
    onTargetRefresh,
  });
  const { eligibility, result } = delivery;

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && delivery.submitting) return;
    onOpenChange?.(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        dir="rtl"
        className="mx-auto max-h-[94vh] w-full max-w-2xl overflow-x-hidden"
        aria-describedby="sale-delivery-description"
        onEscapeKeyDown={(event) => { if (delivery.submitting) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (delivery.submitting) event.preventDefault(); }}
      >
        <SheetDismissButton aria-label="إغلاق نافذة التسليم" disabled={delivery.submitting} />
        <SheetHeader className="pl-16">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><PackageCheck className="h-5 w-5" /></span>
            <div className="min-w-0"><SheetTitle>تسليم البيع</SheetTitle><SheetDescription id="sale-delivery-description">اختر البنود التي سيتم تسليمها في هذه العملية.</SheetDescription></div>
          </div>
        </SheetHeader>

        {delivery.status === 'loading' && !eligibility ? <SheetBody><div role="status" className="flex min-h-64 flex-col items-center justify-center gap-3 text-slate-600"><LoaderCircle className="h-7 w-7 animate-spin" /><p className="text-sm font-bold">جاري تحميل جاهزية التسليم...</p></div></SheetBody> : null}

        {delivery.status === 'error' && !eligibility ? <SheetBody><div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center text-red-900"><CircleAlert className="mx-auto h-7 w-7" /><p className="mt-3 font-black">{delivery.error?.message || 'تعذر تحميل جاهزية التسليم.'}</p><Button type="button" variant="secondary" className="mt-4" onClick={delivery.retryEligibility}><RefreshCw className="h-4 w-4" />إعادة المحاولة</Button></div></SheetBody> : null}

        {eligibility && result ? <><SheetBody className="space-y-4"><div role="status" className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950"><CheckCircle2 className="h-8 w-8" /><h3 className="mt-3 text-lg font-black">تم تنفيذ التسليم بنجاح</h3><p className="mt-1 text-sm">الحالة الحالية: {result.fulfillmentStatus === 'delivered' ? 'تم التسليم بالكامل' : 'تم التسليم جزئيًا'}.</p>{result.idempotentReplay ? <p className="mt-2 text-xs font-bold">تم تأكيد نتيجة المحاولة السابقة دون إنشاء تسليم مكرر.</p> : null}</div><dl className="grid grid-cols-2 gap-3"><SummaryItem label="إجمالي المُسلّم" value={formattedQuantity(result.deliveredQuantity)} /><SummaryItem label="المتبقي" value={formattedQuantity(result.remainingQuantity)} /></dl>{delivery.notice ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{delivery.notice}</p> : null}</SheetBody><SheetFooter><Button type="button" onClick={() => handleOpenChange(false)}>إغلاق</Button></SheetFooter></> : null}

        {eligibility && !result ? (
          <form className="contents" onSubmit={delivery.submit} noValidate>
            <SheetBody className="space-y-4 overflow-x-hidden">
              <dl className="grid min-w-0 grid-cols-2 gap-3">
                <SummaryItem label="رقم البيع" value={eligibility.saleNumber || sale?.saleNumber} />
                <SummaryItem label="العميل" value={sale?.customer?.name} />
                <SummaryItem label="الفرع" value={sale?.branch?.name} />
                <SummaryItem label="موقع المخزون" value={eligibility.location?.name} />
              </dl>

              {!eligibility.eligible ? <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-950">{getSaleDeliveryReasonMessage(eligibility.blockingReasons[0])}</div> : null}

              {eligibility.deliverableLines.filter((line) => line.remainingQuantity > 0).map((line) => line.trackingRequirement === 'serial'
                ? <SerializedLine key={line.saleLineId} line={line} sale={sale} selection={delivery.selection} setTrackingUnit={delivery.setTrackingUnit} />
                : <QuantityLine key={line.saleLineId} line={line} selection={delivery.selection} setQuantity={delivery.setQuantity} />)}

              {delivery.status === 'refreshing' ? <p role="status" className="text-center text-xs font-bold text-slate-500">جاري تحديث جاهزية التسليم...</p> : null}
              {delivery.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900">{delivery.error.message}</p> : null}
              {delivery.notice ? <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">{delivery.notice}</p> : null}
            </SheetBody>
            <SheetFooter className="flex-wrap">
              <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)} disabled={delivery.submitting}>إلغاء</Button>
              <Button type="submit" disabled={!delivery.canSubmit || delivery.submitting || delivery.status === 'refreshing'} aria-busy={delivery.submitting}>
                {delivery.submitting ? <><LoaderCircle className="h-4 w-4 animate-spin" />جاري التسليم...</> : 'تأكيد التسليم'}
              </Button>
            </SheetFooter>
          </form>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
