import { Link, useLocation } from 'react-router-dom';
import { cn } from '@/core/utils/cn';
import { createSaleSideSheetLocation, createSaleSideSheetState } from '@/features/sales/routes/salesSideSheetNavigation';
import {
  SALES_COMMERCIAL_LABELS,
  SALES_FULFILLMENT_LABELS,
  SALES_PAYMENT_LABELS,
} from '@/features/sales/services/sales.model';

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-EG', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`));
}

function formatMoney(value, currencyCode) {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency: currencyCode || 'EGP',
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

const badgeStyles = Object.freeze({
  draft: 'bg-slate-100 text-slate-700',
  confirmed: 'bg-blue-50 text-blue-700',
  cancelled: 'bg-red-50 text-red-700',
  unpaid: 'bg-red-50 text-red-700',
  partially_paid: 'bg-amber-50 text-amber-800',
  paid: 'bg-emerald-50 text-emerald-700',
  unreserved: 'bg-slate-100 text-slate-700',
  reserved: 'bg-violet-50 text-violet-700',
  partially_delivered: 'bg-amber-50 text-amber-800',
  delivered: 'bg-emerald-50 text-emerald-700',
  not_required: 'bg-slate-100 text-slate-600',
});

export function SalesStatusBadge({ status, labels }) {
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-black', badgeStyles[status] || badgeStyles.draft)}>
      {labels[status] || status}
    </span>
  );
}

function SaleMobileCard({ sale }) {
  const location = useLocation();
  return (
    <Link to={createSaleSideSheetLocation(location, sale.id)} state={createSaleSideSheetState(location.state)} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-100">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-black text-slate-950" dir="ltr">{sale.saleNumber || 'مسودة'}</p>
          {sale.isHistorical ? <span className="mt-1 inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-black text-sky-700">تاريخي</span> : null}
          <p className="mt-1 truncate text-sm font-bold text-slate-700">{sale.customer.name || 'عميل غير محدد'}</p>
        </div>
        <SalesStatusBadge status={sale.status} labels={SALES_COMMERCIAL_LABELS} />
      </div>
      <div className="mt-4 flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
        <div className="min-w-0 text-xs font-semibold text-slate-500">
          <p>{formatDate(sale.effectiveSaleDate)} · {sale.branch.name || '—'}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <SalesStatusBadge status={sale.payment.status} labels={SALES_PAYMENT_LABELS} />
            <SalesStatusBadge status={sale.fulfillment.status} labels={SALES_FULFILLMENT_LABELS} />
          </div>
        </div>
        <strong className="shrink-0 text-sm font-black text-slate-950">{formatMoney(sale.totalAmount, sale.currencyCode)}</strong>
      </div>
    </Link>
  );
}

function SalesDesktopTable({ items }) {
  const location = useLocation();
  return (
    <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 md:block">
      <table className="min-w-full border-collapse text-right text-sm">
        <thead className="bg-slate-50 text-xs font-black text-slate-600"><tr>{['رقم البيع', 'التاريخ', 'العميل', 'الفرع', 'الموظف', 'الإجمالي', 'الدفع', 'التسليم', 'الحالة'].map((heading) => <th key={heading} className="whitespace-nowrap px-4 py-3" scope="col">{heading}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.map((sale) => (
            <tr key={sale.id} className="group relative hover:bg-violet-50/30">
              <td className="px-4 py-3 font-mono font-black" dir="ltr"><Link className="block text-violet-700 after:absolute after:inset-0 focus-visible:outline-none focus-visible:underline" to={createSaleSideSheetLocation(location, sale.id)} state={createSaleSideSheetState(location.state)}>{sale.saleNumber || 'مسودة'}</Link>{sale.isHistorical ? <span className="mt-1 inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-black text-sky-700">تاريخي</span> : null}</td>
              <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(sale.effectiveSaleDate)}</td>
              <td className="max-w-48 truncate px-4 py-3 font-bold text-slate-900">{sale.customer.name || '—'}</td>
              <td className="max-w-36 truncate px-4 py-3 text-slate-600">{sale.branch.name || '—'}</td>
              <td className="max-w-36 truncate px-4 py-3 text-slate-600">{sale.createdBy.name || '—'}</td>
              <td className="whitespace-nowrap px-4 py-3 font-black text-slate-950">{formatMoney(sale.totalAmount, sale.currencyCode)}</td>
              <td className="px-4 py-3"><SalesStatusBadge status={sale.payment.status} labels={SALES_PAYMENT_LABELS} /></td>
              <td className="px-4 py-3"><SalesStatusBadge status={sale.fulfillment.status} labels={SALES_FULFILLMENT_LABELS} /></td>
              <td className="px-4 py-3"><SalesStatusBadge status={sale.status} labels={SALES_COMMERCIAL_LABELS} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SalesRecords({ items }) {
  return (
    <>
      <SalesDesktopTable items={items} />
      <div className="grid gap-3 md:hidden">{items.map((sale) => <SaleMobileCard key={sale.id} sale={sale} />)}</div>
    </>
  );
}

export function SalesRecordsPreview({ items }) {
  const location = useLocation();
  return (
    <div className="divide-y divide-slate-300/80" aria-label="أحدث سجلات المبيعات">
      {items.map((sale) => (
        <Link
          key={sale.id}
          to={createSaleSideSheetLocation(location, sale.id)}
          state={createSaleSideSheetState(location.state)}
          className="grid gap-2 px-2 py-3 transition-colors hover:bg-slate-50/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-200 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-slate-800">{sale.customer.name || 'عميل غير محدد'}</p>
            <p className="mt-1 truncate text-xs font-semibold text-slate-500">{formatDate(sale.effectiveSaleDate)} · {sale.branch.name || '—'}</p>
          </div>
          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <strong className="whitespace-nowrap text-sm font-black text-slate-950">{formatMoney(sale.totalAmount, sale.currencyCode)}</strong>
          </div>
        </Link>
      ))}
    </div>
  );
}
