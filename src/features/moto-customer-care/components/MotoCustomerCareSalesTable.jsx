import { ArrowLeft, FileSearch } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/core/ui/empty-state';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { buttonVariants } from '@/core/ui/button';
import { MotoCustomerCareStatusBadge } from '@/features/moto-customer-care/components/MotoCustomerCareStatusBadge';
import { MOTO_CUSTOMER_CARE_ROUTES } from '@/features/moto-customer-care/routes/motoCustomerCareRoutes';

function formatDate(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(date);
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ج.م`;
}

function MoneyText({ value, className = '' }) {
  return (
    <span className={`block whitespace-nowrap font-mono tabular-nums ${className}`} dir="ltr">
      {formatMoney(value)}
    </span>
  );
}

function DetailsLink({ saleId }) {
  return (
    <Link
      to={MOTO_CUSTOMER_CARE_ROUTES.saleDetails(saleId)}
      className={`${buttonVariants({ variant: 'secondary', size: 'sm' })} h-9 rounded-lg px-3 shadow-none`}
    >
      <span>التفاصيل</span>
      <ArrowLeft className="h-4 w-4" />
    </Link>
  );
}

export function MotoCustomerCareSalesTable({ sales, isLoading, error, emptyTitle, emptyDescription }) {
  if (isLoading) {
    return <LoadingSpinner title="جاري تحميل عمليات المتابعة" description="يتم جلب مبيعات showroom مع بيانات العملاء." />;
  }

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>;
  }

  if (!sales.length) {
    return (
      <EmptyState
        icon={FileSearch}
        title={emptyTitle}
        description={emptyDescription}
        actionLabel="العودة لمتابعة المبيعات"
        onAction={() => window.history.back()}
      />
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
        <table className="w-full min-w-[860px] text-right text-sm">
          <thead className="bg-slate-50 text-xs font-bold text-slate-500">
            <tr>
              <th className="min-w-44 px-4 py-3">العميل</th>
              <th className="w-36 px-4 py-3">الهاتف</th>
              <th className="w-32 px-4 py-3">تاريخ البيع</th>
              <th className="w-32 px-4 py-3">الحالة</th>
              <th className="w-32 px-4 py-3">الإجمالي</th>
              <th className="w-32 px-4 py-3">المدفوع</th>
              <th className="w-32 px-4 py-3">المتبقي</th>
              <th className="w-28 px-4 py-3">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sales.map((sale) => (
              <tr key={sale.id} className="align-middle transition hover:bg-slate-50/70">
                <td className="px-4 py-3 font-bold leading-6 text-slate-800">{sale.customer?.name || 'عميل غير محدد'}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600" dir="ltr">{sale.customer?.phone || '--'}</td>
                <td className="px-4 py-3 text-slate-600">{formatDate(sale.saleDate)}</td>
                <td className="px-4 py-3"><MotoCustomerCareStatusBadge status={sale.status} /></td>
                <td className="px-4 py-3"><MoneyText value={sale.totalAmount} className="font-bold text-slate-800" /></td>
                <td className="px-4 py-3"><MoneyText value={sale.paidAmount} className="font-bold text-emerald-700" /></td>
                <td className="px-4 py-3"><MoneyText value={sale.remainingAmount} className="font-bold text-red-700" /></td>
                <td className="px-4 py-3">
                  <DetailsLink saleId={sale.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 md:hidden">
        {sales.map((sale) => (
          <div key={sale.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-slate-900">{sale.customer?.name || 'عميل غير محدد'}</p>
                <p className="text-xs text-slate-500">{sale.customer?.phone || '--'}</p>
              </div>
              <MotoCustomerCareStatusBadge status={sale.status} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-slate-500">تاريخ البيع</p>
                <p className="font-medium text-slate-800">{formatDate(sale.saleDate)}</p>
              </div>
              <div>
                <p className="text-slate-500">المتبقي</p>
                <MoneyText value={sale.remainingAmount} className="font-bold text-red-700" />
              </div>
              <div>
                <p className="text-slate-500">الإجمالي</p>
                <MoneyText value={sale.totalAmount} className="font-medium text-slate-800" />
              </div>
              <div>
                <p className="text-slate-500">المدفوع</p>
                <MoneyText value={sale.paidAmount} className="font-medium text-emerald-700" />
              </div>
            </div>
            <div className="mt-4">
              <DetailsLink saleId={sale.id} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
