import { Banknote } from 'lucide-react';
import { cn } from '@/core/utils/cn';

const money = (value, currency) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency}`;

function CompactPaymentSummary({ sale }) {
  const total = Math.max(Number(sale.payment.totalAmount ?? sale.totalAmount) || 0, 0);
  const settled = Math.min(Math.max(Number(sale.payment.settledAmount) || 0, 0), total);
  const outstanding = Math.max(Number(sale.payment.outstandingAmount) || 0, 0);
  const percentage = total > 0 ? Math.min(Math.round((settled / total) * 100), 100) : 0;
  const currency = sale.payment.currencyCode || sale.currencyCode;

  return (
    <section className="flex min-h-56 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white" aria-labelledby="sale-paid-summary">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-300 bg-slate-50 px-4 py-3">
        <h2 id="sale-paid-summary" className="text-[13px] font-bold text-slate-950">المدفوع</h2>
        <span className="text-[10px] font-semibold tabular-nums text-slate-400">{percentage.toLocaleString('ar-EG')}٪ من الإجمالي</span>
      </header>

      <div className="flex flex-1 flex-col px-4 py-4">
        <p className="text-[10px] font-medium text-slate-500">إجمالي ما تم دفعه</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-emerald-700 tabular-nums">{money(settled, currency)}</p>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-red-100" aria-label={`نسبة المدفوع ${percentage.toLocaleString('ar-EG')}٪`} role="img">
          <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${percentage}%` }} />
        </div>

        <dl className="mt-4 divide-y divide-slate-200 text-xs">
          <div className="flex items-center justify-between gap-3 py-2">
            <dt className="font-medium text-slate-500">إجمالي الفاتورة</dt>
            <dd className="font-bold tabular-nums text-slate-900">{money(total, currency)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2">
            <dt className={cn('font-medium', outstanding > 0 ? 'text-red-600' : 'text-slate-500')}>المتبقي</dt>
            <dd className={cn('font-bold tabular-nums', outstanding > 0 ? 'text-red-700' : 'text-slate-900')}>{money(outstanding, currency)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export function SalePaymentSummary({ sale, compact = false }) {
  if (compact) return <CompactPaymentSummary sale={sale} />;
  if (sale.commercialStatus === 'draft') return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Banknote className="h-5 w-5 text-slate-500" /><h2 className="font-black">الملخص المالي</h2></div><p className="mt-3 text-sm text-slate-600">لم يتم تأكيد البيع بعد؛ لا يوجد استحقاق مالي أو تحصيل لهذه المسودة.</p><p className="mt-3 text-xl font-black">{money(sale.totalAmount, sale.currencyCode)}</p></section>;
  if (sale.commercialStatus === 'cancelled') return <section className="rounded-2xl border border-red-100 bg-white p-5"><div className="flex items-center gap-2"><Banknote className="h-5 w-5 text-red-600" /><h2 className="font-black">الملخص المالي</h2></div><p className="mt-3 text-sm text-slate-600">تم عكس الأثر المالي للبيع مع الاحتفاظ بالإجمالي الأصلي وسجل التأكيد.</p><p className="mt-3 text-xl font-black">{money(sale.totalAmount, sale.currencyCode)}</p></section>;
  const items = [['الإجمالي', sale.payment.totalAmount], ['تمت تسويته', sale.payment.settledAmount], ['المتبقي', sale.payment.outstandingAmount]];
  return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center gap-2"><Banknote className="h-5 w-5 text-emerald-600" /><h2 className="font-black">ملخص التسوية</h2></div><div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">{items.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className={`mt-1 text-lg font-black ${label === 'المتبقي' ? 'text-slate-950' : ''}`}>{money(value, sale.payment.currencyCode)}</p></div>)}</div></section>;
}
