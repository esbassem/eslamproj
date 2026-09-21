import { Building2, CalendarDays, UserRound } from 'lucide-react';
import { SaleStatusBadge } from '@/features/sales/components/SaleStatusBadge';
import { cn } from '@/core/utils/cn';

const money = (value, currency) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency}`;

export function SaleHeader({ sale, embedded = false }) {
  const totalAmount = Math.max(Number(sale.totalAmount) || 0, 0);
  const settledAmount = Math.min(Math.max(Number(sale.payment.settledAmount) || 0, 0), totalAmount);
  const outstandingAmount = Math.max(Number(sale.payment.outstandingAmount) || 0, 0);
  const hasOutstandingBalance = outstandingAmount > 0;
  const paidPercentage = totalAmount > 0 ? Math.min(Math.round((settledAmount / totalAmount) * 100), 100) : 0;

  return (
    <section className={cn(
      embedded ? 'py-3' : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm',
    )}>
      {embedded ? (
        <div className="grid gap-5 md:grid-cols-[minmax(0,4fr)_minmax(0,6fr)] md:items-center">
          <div className="min-w-0 md:py-1">
            <div className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3.5">
              <span
                className="grid h-14 w-14 place-items-center self-center rounded-full bg-slate-100 text-slate-500"
                aria-hidden="true"
              >
                <UserRound className="h-7 w-7 stroke-[1.8]" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold leading-6 text-slate-950" title={sale.customer.name || undefined}>
                  {sale.customer.name || 'عميل غير محدد'}
                </p>
                <p className="mt-0.5 truncate text-xs leading-5 text-slate-500" title={sale.customer.phone || undefined}>
                  {sale.customer.phone ? <bdi dir="ltr">{sale.customer.phone}</bdi> : 'رقم الهاتف غير مسجل'}
                </p>
                <p className="truncate text-xs leading-5 text-slate-600" title={sale.customer.address || undefined}>
                  {sale.customer.address || 'العنوان غير مسجل'}
                </p>
              </div>
              <dl className="col-start-2 mt-3 grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-1.5">
                <dt className="text-[10px] font-medium text-slate-400">الفرع</dt>
                <dd className="truncate text-xs font-semibold text-slate-700" title={sale.branch.name || undefined}>
                  {sale.branch.name || 'غير محدد'}
                </dd>
                <dt className="text-[10px] font-medium text-slate-400">البائع</dt>
                <dd className="truncate text-xs font-semibold text-slate-700">غير محدد</dd>
              </dl>
            </div>
          </div>

          <div className="pt-2 md:ps-5 md:pt-0">
            <div className="flex items-center justify-center gap-4">
              <div
                className="relative h-32 w-32 shrink-0"
                role="img"
                aria-label={`تم سداد ${paidPercentage}% من إجمالي الفاتورة`}
              >
                <svg className="h-full w-full -rotate-90" viewBox="0 0 112 112" aria-hidden="true">
                  <circle
                    className={cn('fill-none', hasOutstandingBalance ? 'stroke-red-400' : 'stroke-slate-100')}
                    cx="56"
                    cy="56"
                    r="45"
                    strokeWidth="9"
                  />
                  <circle
                    className="fill-none stroke-emerald-500 transition-[stroke-dasharray] duration-500"
                    cx="56"
                    cy="56"
                    r="45"
                    pathLength="100"
                    strokeDasharray={`${paidPercentage} ${100 - paidPercentage}`}
                    strokeLinecap="round"
                    strokeWidth="9"
                  />
                </svg>
                <div className="absolute inset-3 grid place-content-center text-center">
                  <span className="text-[10px] font-medium text-slate-500">إجمالي الفاتورة</span>
                  <bdi dir="ltr" className="mt-0.5 text-sm font-black tabular-nums text-slate-950">
                    {Number(totalAmount).toLocaleString('ar-EG', { maximumFractionDigits: 2 })}
                  </bdi>
                  <span className="text-[10px] font-semibold text-slate-500">{sale.currencyCode}</span>
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium text-slate-500">حالة الدفع</p>
                <dl className="mt-2 space-y-1.5 text-xs">
                  <div className="grid grid-cols-[3.5rem_auto] items-center justify-start gap-x-2">
                    <dt className="flex items-center gap-1.5 text-slate-500"><span className="h-2 w-2 rounded-full bg-emerald-500" />المدفوع</dt>
                    <dd className="font-bold tabular-nums text-slate-800">{money(settledAmount, sale.currencyCode)}</dd>
                  </div>
                  <div className="grid grid-cols-[3.5rem_auto] items-center justify-start gap-x-2">
                    <dt className={cn('flex items-center gap-1.5', hasOutstandingBalance ? 'text-red-600' : 'text-slate-500')}>
                      <span className={cn('h-2 w-2 rounded-full', hasOutstandingBalance ? 'bg-red-500' : 'bg-slate-200')} />
                      المتبقي
                    </dt>
                    <dd className={cn('font-bold tabular-nums', hasOutstandingBalance ? 'text-red-700' : 'text-slate-800')}>
                      {money(outstandingAmount, sale.currencyCode)}
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-bold text-slate-500">رقم البيع</p>
              <h2 className="mt-1 text-2xl font-black text-slate-950" dir={sale.saleNumber ? 'ltr' : 'rtl'}>
                {sale.saleNumber || 'مسودة'}
              </h2>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600">
                <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{sale.effectiveSaleDate}</span>
                <span className="flex items-center gap-1.5"><UserRound className="h-4 w-4" />{sale.customer.name}</span>
                <span className="flex items-center gap-1.5"><Building2 className="h-4 w-4" />{sale.branch.name}</span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                أنشأه: {sale.createdBy.name || 'غير محدد'}
                {sale.confirmedAt ? ` · تم التأكيد ${new Date(sale.confirmedAt).toLocaleString('ar-EG')}` : ''}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-950 p-4 text-white lg:min-w-56">
              <p className="text-xs font-bold text-slate-300">إجمالي البيع</p>
              <p className="mt-1 text-2xl font-black">{money(sale.totalAmount, sale.currencyCode)}</p>
              <p className="mt-1 text-xs text-slate-400">العملة: {sale.currencyCode}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
            <div><p className="mb-2 text-xs font-bold text-slate-500">الحالة التجارية</p><SaleStatusBadge status={sale.commercialStatus} /></div>
            <div><p className="mb-2 text-xs font-bold text-slate-500">حالة الدفع</p><SaleStatusBadge status={sale.payment.status} /></div>
            <div><p className="mb-2 text-xs font-bold text-slate-500">حالة التنفيذ</p><SaleStatusBadge status={sale.fulfillment.status} /></div>
          </div>
        </>
      )}
    </section>
  );
}
