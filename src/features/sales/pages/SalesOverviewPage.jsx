import { AlertCircle, Building2, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { SaleDetailsSideSheet } from '@/features/sales/components/SaleDetailsSideSheet';
import { useSalesBranchReports } from '@/features/sales/hooks/useSalesBranchReports';
import { useSalesList } from '@/features/sales/hooks/useSalesList';
import { SALES_ROUTES } from '@/features/sales/routes/salesRoutes';
import { createSaleSideSheetLocation, createSaleSideSheetState } from '@/features/sales/routes/salesSideSheetNavigation';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function monthValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function formatShortDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short' })
    .format(new Date(`${value}T00:00:00`));
}

function formatMoney(value, currencyCode, maximumFractionDigits = 2, showCurrency = true) {
  try {
    return new Intl.NumberFormat('ar-EG', {
      ...(showCurrency ? {
        style: 'currency',
        currency: currencyCode || 'EGP',
        currencyDisplay: 'narrowSymbol',
      } : {}),
      maximumFractionDigits,
    }).format(Number(value) || 0);
  } catch {
    const formattedValue = Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits });
    return showCurrency ? `${formattedValue} ${currencyCode || ''}`.trim() : formattedValue;
  }
}

function CurrencyValues({ values = [], maximumFractionDigits = 2, showCurrency = true }) {
  if (!values.length) return <span>0</span>;
  return values.map((item) => (
    <span key={item.currencyCode} className="block whitespace-nowrap tabular-nums">{formatMoney(item.amount, item.currencyCode, maximumFractionDigits, showCurrency)}</span>
  ));
}

function sumCurrencyValues(groups = []) {
  const totals = new Map();
  groups.flat().forEach((item) => {
    const currencyCode = item?.currencyCode || 'EGP';
    totals.set(currencyCode, (totals.get(currencyCode) || 0) + (Number(item?.amount) || 0));
  });
  return Array.from(totals, ([currencyCode, amount]) => ({ currencyCode, amount }));
}

function OutstandingProgress({ totalAmount, outstandingAmount }) {
  const total = Math.max(Number(totalAmount) || 0, 0);
  const outstanding = Math.max(Math.min(Number(outstandingAmount) || 0, total), 0);
  const percentage = total > 0 ? Math.round((outstanding / total) * 100) : 0;

  return (
    <span
      className="relative grid h-7 w-7 shrink-0 place-items-center"
      role="img"
      aria-label={`المتبقي ${percentage.toLocaleString('ar-EG')}٪ من إجمالي الفاتورة`}
    >
      <svg viewBox="0 0 28 28" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle
          cx="14"
          cy="14"
          r="10.5"
          fill="none"
          stroke="rgb(34 197 94)"
          strokeWidth="2.5"
        />
        <circle
          cx="14"
          cy="14"
          r="10.5"
          fill="none"
          pathLength="100"
          stroke="rgb(220 38 38)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${percentage} 100`}
        />
      </svg>
    </span>
  );
}

function OverviewLoading() {
  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="جاري تحميل تقارير الفروع" role="status">
      {Array.from({ length: 1 }, (_, index) => (
        <div key={index} className="h-32 animate-pulse rounded-lg border border-slate-200 bg-slate-50" />
      ))}
    </section>
  );
}

export function SalesOverviewPage() {
  const location = useLocation();
  const { tenant } = useWorkspace();
  const { can } = useAuthorization();
  const [search, setSearch] = useState('');
  const selectedMonth = useMemo(() => monthValue(new Date()), []);
  const query = useSalesBranchReports({ tenantId: tenant?.id, month: selectedMonth });
  const reports = query.data;
  const outstandingTotals = useMemo(
    () => sumCurrencyValues(reports.map((report) => report.allTimeOutstandingByCurrency)),
    [reports],
  );
  const salesQuery = useSalesList({
    tenantId: tenant?.id,
    filters: { search, status: 'confirmed', branchId: '', paymentStatus: 'outstanding', fulfillmentStatus: '', dateFrom: '', dateTo: '' },
    page: 1,
    pageSize: 100,
  });
  const submitSearch = (event) => {
    event.preventDefault();
  };

  return (
    <div className="lg:h-[calc(100dvh-8rem)] lg:overflow-hidden" dir="rtl">
      <main className="mx-auto w-full max-w-[1120px] lg:grid lg:h-full lg:grid-cols-[minmax(0,640px)_350px] lg:items-start lg:justify-between lg:gap-6 lg:pt-2">
        <div className="min-w-0">
          <header className="mb-16">
            <h1 className="text-xl font-black tracking-tight text-slate-950">المبيعات</h1>
          </header>
          <div className="flex flex-wrap items-center gap-2.5" aria-label="أدوات عرض المبيعات">
            <form onSubmit={submitSearch} className="w-[240px] max-w-full sm:w-[270px]">
            <label className="group relative block">
              <span className="sr-only">البحث في المبيعات</span>
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-[var(--app-primary-color)]" aria-hidden="true" />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="البحث في جميع المبيعات"
                className="h-8 w-full rounded-lg border border-slate-300 bg-white pr-8 pl-3 text-xs font-semibold text-slate-800 outline-none transition-colors placeholder:text-slate-500 focus:border-[var(--app-primary-color)]"
              />
            </label>
            </form>
            {can('sales.create') ? (
              <Link
                to={SALES_ROUTES.create}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-white shadow-sm transition-[filter,transform] hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ backgroundColor: 'var(--app-primary-color)' }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                بيع جديد
              </Link>
            ) : null}
          </div>
          <section className="mt-3" aria-label="تقارير المبيعات حسب الفرع">
            {query.status === 'loading' ? <OverviewLoading /> : null}
            {query.status === 'error' ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-8 text-center" role="alert">
                <AlertCircle className="mx-auto h-7 w-7 text-red-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-bold text-red-700">{query.error}</p>
                <button type="button" onClick={query.retry} className="mt-4 h-8 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-700">إعادة المحاولة</button>
              </div>
            ) : null}
            {query.status === 'ready' && reports.length ? (
                <div className="grid grid-cols-2 gap-2">
                  {reports.map((report) => (
                  <Link
                    key={report.branch.id}
                    to={SALES_ROUTES.branch(report.branch.id)}
                    className="min-h-[152px] min-w-0 rounded-md border border-slate-300 bg-white px-5 py-5 text-right transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  >
                    <h3 className="truncate text-sm font-bold text-slate-900">{report.branch.name || 'فرع بدون اسم'}</h3>

                    <section className="mt-6" aria-label="الشهر الحالي">
                      <h4 className="text-[11px] font-semibold text-slate-600">الشهر الحالي</h4>
                      <div className="mt-3 flex min-w-0 items-baseline gap-8">
                        <p className="flex shrink-0 items-baseline gap-1.5">
                          <strong className="text-2xl font-extrabold leading-none tracking-tight text-slate-950">{report.confirmedSalesCount.toLocaleString('ar-EG')}</strong>
                          <span className="text-[9px] font-medium text-slate-400">عدد الفواتير</span>
                        </p>
                        <div className="flex min-w-0 items-baseline gap-1.5">
                          <strong className="min-w-0 text-base font-bold leading-none tracking-tight text-slate-900"><CurrencyValues values={report.salesValueByCurrency} maximumFractionDigits={0} showCurrency={false} /></strong>
                          <span className="whitespace-nowrap text-[9px] font-medium text-slate-400">إجمالي الإيراد</span>
                        </div>
                      </div>
                    </section>

                  </Link>
                  ))}
                </div>
            ) : null}
            {query.status === 'ready' && !reports.length ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-5 py-10 text-center">
                <Building2 className="mx-auto h-8 w-8 text-slate-400" aria-hidden="true" />
                <p className="mt-3 text-sm font-black text-slate-700">لا توجد فروع متاحة ضمن نطاق عملك.</p>
              </div>
            ) : null}
          </section>
        </div>

        <section aria-label="ملخص المبيعات الجانبي" className="min-w-0 lg:-translate-x-12 lg:pt-[88px]">
          <div className="px-1">
            <section aria-label="المبالغ المستحقة">
              <header className="pb-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-700">المبالغ المستحقة</h2>
                    <p className="mt-1 text-[10px] font-medium text-slate-400">الفواتير التي ما زال عليها رصيد</p>
                  </div>
                  <strong className="shrink-0 text-xl font-semibold tracking-tight text-slate-950">
                    {query.status === 'ready' ? <CurrencyValues values={outstandingTotals} maximumFractionDigits={0} showCurrency={false} /> : '—'}
                  </strong>
                </div>
              </header>
              <div className="sales-invoice-scrollbar divide-y divide-slate-200 lg:max-h-[calc(100dvh-18rem)] lg:overflow-y-auto lg:overscroll-contain">
                {salesQuery.status === 'loading' ? Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="flex items-center gap-3 py-3 first:pt-0">
                    <span className="h-4 w-4 animate-pulse rounded-full bg-slate-200" />
                    <span className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
                  </div>
                )) : null}
                {salesQuery.status === 'ready' ? salesQuery.data.items.map((sale) => (
                  <Link key={sale.id} to={createSaleSideSheetLocation(location, sale.id)} state={createSaleSideSheetState(location.state)} className="block rounded-md py-3 transition-colors duration-150 first:pt-0 hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300">
                    <span className="flex items-center gap-3">
                      <OutstandingProgress totalAmount={sale.totalAmount} outstandingAmount={sale.payment.outstandingAmount} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-slate-800">{sale.customer.name || 'عميل غير محدد'}</span>
                        <span className="mt-1 block truncate text-[10px] font-medium text-slate-400">
                          {formatShortDate(sale.effectiveSaleDate)} · {sale.productSummary || 'منتج غير محدد'}
                        </span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        <span
                          className="inline-flex items-baseline gap-1 whitespace-nowrap"
                          dir="ltr"
                          aria-label={`المتبقي ${formatMoney(sale.payment.outstandingAmount, sale.currencyCode, 0, false)} من ${formatMoney(sale.totalAmount, sale.currencyCode, 0, false)}`}
                        >
                          <strong className="text-sm font-bold tracking-tight text-red-600">
                            {formatMoney(sale.payment.outstandingAmount, sale.currencyCode, 0, false)}
                          </strong>
                          <span className="text-[10px] font-medium text-slate-300" aria-hidden="true">/</span>
                          <span className="text-[10px] font-semibold text-slate-500" aria-hidden="true">
                            {formatMoney(sale.totalAmount, sale.currencyCode, 0, false)}
                          </span>
                        </span>
                      </span>
                    </span>
                  </Link>
                )) : null}
                {salesQuery.status === 'ready' && !salesQuery.data.items.length ? <p className="py-6 text-center text-xs font-semibold text-slate-500">لا توجد مبالغ مستحقة.</p> : null}
                {salesQuery.status === 'error' ? <p className="py-6 text-center text-xs font-semibold text-red-600">تعذر تحميل الفواتير غير المسددة.</p> : null}
              </div>
            </section>

          </div>
          </section>
      </main>
      <SaleDetailsSideSheet />
    </div>
  );
}
