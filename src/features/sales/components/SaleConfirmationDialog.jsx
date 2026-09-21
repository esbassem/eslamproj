import { AlertTriangle, CheckCircle2, LoaderCircle, PackageCheck } from 'lucide-react';
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
import { SaleReadiness } from '@/features/sales/components/SaleReadiness';

const money = (value, currency) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency}`;

function SummaryItem({ label, value }) {
  return <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-3"><dt className="text-xs font-bold text-slate-500">{label}</dt><dd className="mt-1 truncate font-black text-slate-950">{value || '—'}</dd></div>;
}

export function SaleConfirmationDialog({ open, onOpenChange, sale, readiness, confirmation }) {
  if (!sale) return null;
  const serials = sale.lines.flatMap((line) => line.inventory?.kind === 'serial' ? line.inventory.trackingUnits ?? [] : []);
  const handleOpenChange = (nextOpen) => {
    if (!nextOpen && confirmation.submitting) return;
    if (!nextOpen) confirmation.clearError();
    onOpenChange(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        dir="rtl"
        className="mx-auto max-h-[92vh] w-full max-w-2xl overflow-x-hidden"
        aria-describedby="sale-confirmation-description"
        onEscapeKeyDown={(event) => { if (confirmation.submitting) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (confirmation.submitting) event.preventDefault(); }}
      >
        <SheetDismissButton aria-label="إغلاق تأكيد البيع" disabled={confirmation.submitting} />
        <SheetHeader className="pl-16">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-700"><PackageCheck className="h-5 w-5" /></span>
            <div className="min-w-0"><SheetTitle>تأكيد البيع</SheetTitle><SheetDescription id="sale-confirmation-description">راجع الملخص قبل إنشاء الالتزام التجاري النهائي.</SheetDescription></div>
          </div>
        </SheetHeader>
        <form className="contents" onSubmit={(event) => { event.preventDefault(); void confirmation.submit(); }} noValidate>
          <SheetBody className="space-y-4 overflow-x-hidden">
            <dl className="grid min-w-0 grid-cols-2 gap-3">
              <SummaryItem label="العميل" value={sale.customer.name} />
              <SummaryItem label="الفرع" value={sale.branch.name} />
              <SummaryItem label="إجمالي البيع" value={money(sale.totalAmount, sale.currencyCode)} />
              <SummaryItem label="عدد البنود" value={sale.lines.length.toLocaleString('ar-EG')} />
            </dl>

            {serials.length ? <section className="rounded-xl border border-violet-100 bg-violet-50/60 p-4"><h3 className="text-sm font-black text-violet-950">القطع المتسلسلة المختارة</h3><ul className="mt-2 space-y-1 text-sm text-violet-900">{serials.map((unit) => <li key={unit.id} className="truncate"><CheckCircle2 className="ml-1 inline h-4 w-4" />شاسيه: <span dir="ltr">{unit.chassisNumber || unit.trackingNumber}</span>{unit.engineNumber ? <> · موتور: <span dir="ltr">{unit.engineNumber}</span></> : null}</li>)}</ul></section> : null}

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold leading-6 text-amber-950"><AlertTriangle className="ml-1 inline h-5 w-5" />بعد التأكيد يصبح البيع نهائيًا تجاريًا، ويتم حجز المخزون وإنشاء الاستحقاق المالي. لا يعني التأكيد أن البيع تم تحصيله أو تسليمه.</div>

            {!readiness?.ready ? <SaleReadiness readiness={readiness} /> : null}
            {confirmation.payloadIssue ? <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">{confirmation.payloadIssue}</p> : null}
            {confirmation.error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-900">{confirmation.error.message}</p> : null}
          </SheetBody>
          <SheetFooter className="flex-wrap">
            <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)} disabled={confirmation.submitting}>رجوع</Button>
            <Button type="submit" disabled={!confirmation.canSubmit || confirmation.submitting} aria-busy={confirmation.submitting}>
              {confirmation.submitting ? <><LoaderCircle className="h-4 w-4 animate-spin" />جاري تأكيد البيع...</> : 'تأكيد البيع'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
