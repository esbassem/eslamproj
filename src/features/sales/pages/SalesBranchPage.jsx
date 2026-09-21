import { AlertCircle, ChevronDown, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { SaleDetailsSideSheet } from '@/features/sales/components/SaleDetailsSideSheet';
import { useSalesBranchReports } from '@/features/sales/hooks/useSalesBranchReports';
import { useSalesList } from '@/features/sales/hooks/useSalesList';
import { SALES_ROUTES } from '@/features/sales/routes/salesRoutes';
import { createSaleSideSheetLocation, createSaleSideSheetState } from '@/features/sales/routes/salesSideSheetNavigation';
import { SALES_PAYMENT_LABELS } from '@/features/sales/services/sales.model';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { useOptionalPlatformShell } from '@/platform';

function currentMonthValue() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
}

function monthOptions(count = 24) {
  const current = new Date();
  const options = [];
  for (let index = 0; index < count; index += 1) {
    const date = new Date(current.getFullYear(), current.getMonth() - index, 1);
    const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
    options.push({
      value,
      label: index === 0
        ? 'الشهر الحالي'
        : new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(date),
    });
  }
  return options;
}

function LoadingBlock({ className }) {
  return <div className={`animate-pulse rounded-lg bg-slate-100 ${className}`} />;
}

function monthEnd(value) {
  const [year, month] = value.split('-').map(Number);
  return `${year}-${String(month).padStart(2, '0')}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${value}T00:00:00`));
}

function CurrencyValues({ values = [] }) {
  if (!values.length) return <span>٠</span>;
  return values.map((item) => (
    <span key={item.currencyCode} className="block whitespace-nowrap tabular-nums">
      {formatNumber(item.amount)}
      {values.length > 1 ? <small className="mr-1 text-[9px] font-semibold text-slate-400">{item.currencyCode}</small> : null}
    </span>
  ));
}

const PAYMENT_TONE = Object.freeze({
  paid: 'bg-emerald-500',
  partially_paid: 'bg-amber-500',
  unpaid: 'bg-red-500',
  cancelled: 'bg-slate-400',
});

function OutstandingProgress({ totalAmount, outstandingAmount }) {
  const total = Math.max(Number(totalAmount) || 0, 0);
  const outstanding = Math.max(Math.min(Number(outstandingAmount) || 0, total), 0);
  const percentage = total > 0 ? Math.round((outstanding / total) * 100) : 0;

  return (
    <span className="relative grid h-6 w-6 shrink-0 place-items-center" role="img" aria-label={`المتبقي ${percentage.toLocaleString('ar-EG')}٪ من إجمالي الفاتورة`}>
      <svg viewBox="0 0 28 28" className="absolute inset-0 h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="14" cy="14" r="10.5" fill="none" stroke="rgb(34 197 94)" strokeWidth="2.5" />
        <circle cx="14" cy="14" r="10.5" fill="none" pathLength="100" stroke="rgb(220 38 38)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={`${percentage} 100`} />
      </svg>
    </span>
  );
}

function SalespeopleChart({ items = [], totalInvoices = 0 }) {
  const totalCount = Math.max(items.reduce((total, item) => total + (Number(item.confirmedSalesCount) || 0), 0), 1);
  const strokes = [
    'rgb(37 99 235)',
    'rgb(16 185 129)',
    'rgb(245 158 11)',
    'rgb(139 92 246)',
    'rgb(244 63 94)',
    'rgb(6 182 212)',
  ];
  let offset = 0;

  return (
    <section className="min-w-0" aria-label="توزيع مبيعات السيلز">
      {items.length ? (
        <div className="flex items-center gap-5">
          <span className="relative grid h-20 w-20 shrink-0 place-items-center">
            <svg viewBox="0 0 96 96" className="absolute inset-0 h-full w-full -rotate-90" role="img" aria-label="توزيع فواتير السيلز">
              <circle cx="48" cy="48" r="36" fill="none" stroke="rgb(241 245 249)" strokeWidth="9" />
              {items.map((item, index) => {
                const percentage = ((Number(item.confirmedSalesCount) || 0) / totalCount) * 100;
                const startOffset = offset;
                offset += percentage;
                const visiblePercentage = items.length > 1 ? Math.max(percentage - 1.2, 0) : percentage;
                return (
                  <circle
                    key={item.salesperson.id}
                    cx="48"
                    cy="48"
                    r="36"
                    fill="none"
                    pathLength="100"
                    stroke={strokes[index % strokes.length]}
                    strokeWidth="9"
                    strokeDasharray={`${visiblePercentage} ${100 - visiblePercentage}`}
                    strokeDashoffset={-startOffset}
                  />
                );
              })}
            </svg>
            <span className="relative text-center leading-none" aria-hidden="true">
              <strong className="block text-xl font-bold tracking-tight text-slate-950 tabular-nums">{formatNumber(totalInvoices)}</strong>
              <small className="mt-1 block text-[8px] font-semibold text-slate-400">فاتورة</small>
            </span>
          </span>

          <div className="min-w-0 flex-1">
            <div className="space-y-2" role="list">
              {items.map((item, index) => {
                const count = Number(item.confirmedSalesCount) || 0;
                return (
                  <div key={item.salesperson.id} className="flex min-w-0 items-center gap-2" role="listitem">
                    <div className="flex min-w-0 items-center gap-2">
                      <i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: strokes[index % strokes.length] }} aria-hidden="true" />
                      <span className="min-w-0 truncate text-[10px] font-semibold text-slate-600">{item.salesperson.name || 'بائع غير محدد'}</span>
                      <span className="shrink-0 text-[9px] font-medium text-slate-400">{formatNumber(count)} فاتورة</span>
                    </div>
                    <b className="shrink-0 text-[11px] font-bold tracking-tight text-slate-900"><CurrencyValues values={item.salesValueByCurrency} /></b>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[10px] font-medium text-slate-400">لا توجد مبيعات للسيلز خلال الفترة.</p>
      )}
    </section>
  );
}

function OutstandingSummary({ count = 0, totalValues = [] }) {
  const displayedValues = totalValues.length ? totalValues : [{ currencyCode: 'EGP', amount: 0 }];

  return (
    <div className="flex min-h-10 items-center justify-between gap-5" aria-label="إجمالي المبلغ المتبقي">
      <span className="flex flex-col justify-center gap-1">
        {displayedValues.map((item) => (
          <span key={item.currencyCode} className="flex items-baseline gap-1.5 whitespace-nowrap">
            <strong className="text-2xl font-semibold tracking-tight text-rose-700 tabular-nums">{formatNumber(item.amount)}</strong>
            <small className="text-[10px] font-semibold text-rose-400">{item.currencyCode === 'EGP' ? 'جنيه' : item.currencyCode}</small>
          </span>
        ))}
      </span>
      <span className="shrink-0 text-left">
        <strong className="text-lg font-bold tracking-tight text-slate-800 tabular-nums">{formatNumber(count)}</strong>
        <small className="mr-1.5 text-[9px] font-medium text-slate-400">فاتورة</small>
      </span>
    </div>
  );
}

function OutstandingInvoicesCard({ query, totalValues = [] }) {
  const location = useLocation();
  const count = query.status === 'ready' ? query.data.items.length : 0;

  return (
    <section className="flex max-h-[300px] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label="الفواتير التي عليها متبقي">
      <header className="shrink-0 border-b border-slate-300 px-4 py-2.5">
        <h2 className="text-[13px] font-bold text-slate-900">عليها متبقي</h2>
        <div className="mt-1">
          <OutstandingSummary count={count} totalValues={totalValues} />
        </div>
      </header>
      <div className="sales-invoice-scrollbar min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto px-4">
        {query.status === 'loading' ? [0, 1, 2, 3].map((index) => (
          <div key={index} className="flex items-center gap-2.5 py-3">
            <span className="h-6 w-6 animate-pulse rounded-full bg-slate-200" />
            <span className="h-3 flex-1 animate-pulse rounded bg-slate-100" />
          </div>
        )) : null}
        {query.status === 'ready' ? query.data.items.map((sale) => (
          <Link key={sale.id} to={createSaleSideSheetLocation(location, sale.id)} state={createSaleSideSheetState(location.state)} className="block py-3 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-300">
            <span className="flex items-center gap-2.5">
              <OutstandingProgress totalAmount={sale.totalAmount} outstandingAmount={sale.payment.outstandingAmount} />
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[11px] font-semibold text-slate-800">{sale.customer.name || 'عميل غير محدد'}</strong>
                <span className="mt-0.5 block truncate text-[9px] font-medium text-slate-400">{formatDate(sale.effectiveSaleDate)} · {sale.productSummary || 'منتج غير محدد'}</span>
              </span>
              <span className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap tabular-nums" dir="ltr">
                <strong className="text-xs font-bold text-rose-700">{formatNumber(sale.payment.outstandingAmount)}</strong>
                <span className="text-[9px] text-slate-300">/</span>
                <span className="text-[9px] font-semibold text-slate-500">{formatNumber(sale.totalAmount)}</span>
              </span>
            </span>
          </Link>
        )) : null}
        {query.status === 'ready' && !query.data.items.length ? <p className="py-8 text-center text-xs font-medium text-slate-400">لا توجد فواتير عليها مبالغ متبقية.</p> : null}
        {query.status === 'error' ? <p className="py-8 text-center text-xs font-semibold text-red-600">تعذر تحميل الفواتير المستحقة.</p> : null}
      </div>
    </section>
  );
}

export function SalesBranchPage() {
  const location = useLocation();
  const { branchId = '' } = useParams();
  const { tenant } = useWorkspace();
  const { can } = useAuthorization();
  const platformShell = useOptionalPlatformShell();
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(currentMonthValue);
  const isSearching = search.trim().length > 0;
  const availableMonths = useMemo(monthOptions, []);
  const periodLabel = availableMonths.find((item) => item.value === month)?.label || 'الشهر المحدد';
  const reportQuery = useSalesBranchReports({ tenantId: tenant?.id, month });
  const report = reportQuery.data.find((item) => item.branch.id === branchId);
  const salesQuery = useSalesList({
    tenantId: tenant?.id,
    filters: {
      search,
      status: 'confirmed',
      branchId,
      paymentStatus: '',
      fulfillmentStatus: '',
      dateFrom: isSearching ? '' : month,
      dateTo: isSearching ? '' : monthEnd(month),
    },
    page: 1,
    pageSize: 100,
    loadAll: true,
  });
  const outstandingQuery = useSalesList({
    tenantId: tenant?.id,
    filters: {
      search,
      status: 'confirmed',
      branchId,
      paymentStatus: 'outstanding',
      fulfillmentStatus: '',
      dateFrom: '',
      dateTo: '',
    },
    page: 1,
    pageSize: 100,
    loadAll: true,
  });

  useEffect(() => {
    if (!report?.branch.name || !platformShell?.publishRouteContext) return undefined;
    platformShell.publishRouteContext({ currentLabel: report.branch.name });
    return () => platformShell.publishRouteContext({});
  }, [platformShell?.publishRouteContext, report?.branch.name]);

  if (reportQuery.status === 'error') {
    return (
      <section className="mx-auto max-w-5xl rounded-xl border border-red-200 bg-red-50 px-6 py-12 text-center" dir="rtl" role="alert">
        <AlertCircle className="mx-auto h-7 w-7 text-red-600" aria-hidden="true" />
        <p className="mt-3 text-sm font-bold text-red-700">{reportQuery.error}</p>
        <button type="button" onClick={reportQuery.retry} className="mt-4 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700">إعادة المحاولة</button>
      </section>
    );
  }

  if (reportQuery.status === 'ready' && !report) {
    return (
      <section className="mx-auto max-w-5xl py-16 text-center" dir="rtl">
        <h1 className="text-lg font-black text-slate-900">الفرع غير متاح</h1>
        <p className="mt-2 text-sm text-slate-500">قد يكون الفرع خارج نطاق صلاحياتك أو لم يعد موجودًا.</p>
        <Link to={SALES_ROUTES.overview} className="mt-5 inline-flex text-sm font-bold text-slate-800 hover:text-slate-950">العودة إلى المبيعات</Link>
      </section>
    );
  }

  return (
    <main className="mx-auto w-full max-w-6xl lg:-mb-4" dir="rtl">
      <div className="ml-auto flex w-full max-w-[760px] flex-wrap items-center gap-2.5" aria-label="أدوات مبيعات الفرع">
        <label className="group relative block w-[240px] max-w-full sm:w-[270px]">
          <span className="sr-only">البحث في مبيعات الفرع</span>
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500 transition-colors group-focus-within:text-[var(--app-primary-color)]" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="البحث في جميع الفواتير"
            className="h-8 w-full rounded-lg border border-slate-300 bg-white pr-8 pl-3 text-xs font-semibold text-slate-800 outline-none transition-colors placeholder:text-slate-500 focus:border-[var(--app-primary-color)]"
          />
        </label>
        {can('sales.create') ? (
          <Link
            to={SALES_ROUTES.create}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-white shadow-sm transition-[filter,transform] hover:brightness-110 active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
            style={{ backgroundColor: 'var(--app-primary-color)' }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            بيع جديد
          </Link>
        ) : null}
      </div>

      <div className="mt-4 grid items-start gap-6 lg:grid-cols-[minmax(0,760px)_350px]">
        <section className="flex max-h-[540px] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white" aria-label={`فواتير ${periodLabel}`}>
          <header className="shrink-0 border-b border-slate-300 bg-slate-50 px-5 py-4">
            <div className="flex items-center gap-0">
              <h2 className="whitespace-nowrap text-[13px] font-bold leading-5 text-slate-950">جميع فواتير</h2>
              <label className="group relative inline-flex items-center text-slate-600">
                <span className="sr-only">تحديد شهر التقرير</span>
                <select
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                  className="h-5 w-[112px] cursor-pointer appearance-none bg-transparent pr-1 pl-4 text-right text-[13px] font-semibold leading-5 text-current outline-none transition-colors hover:text-slate-900 focus:text-slate-900"
                >
                  {availableMonths.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute left-0 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              </label>
            </div>
            <div className="mt-4">
              <SalespeopleChart items={report?.salespeople} totalInvoices={report?.confirmedSalesCount} />
            </div>
          </header>

          <div className="sales-invoice-scrollbar min-h-0 flex-1 overflow-auto">
            <div className="min-w-[700px] divide-y divide-slate-300">
              {salesQuery.status === 'loading' ? [0, 1, 2, 3, 4].map((index) => (
                <div key={index} className="grid grid-cols-[1.4fr_1.2fr_0.8fr_1fr] gap-4 px-5 py-4">
                  {[0, 1, 2, 3].map((cell) => <LoadingBlock key={cell} className="h-3 w-3/4" />)}
                </div>
              )) : null}
              {salesQuery.status === 'ready' ? salesQuery.data.items.map((sale) => (
                <Link key={sale.id} to={createSaleSideSheetLocation(location, sale.id)} state={createSaleSideSheetState(location.state)} className="grid grid-cols-[1.4fr_1.2fr_0.8fr_1fr] items-center gap-4 px-5 py-3.5 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-300">
                  <span className="min-w-0"><strong className="block truncate text-xs font-semibold text-slate-800">{sale.customer.name || 'عميل غير محدد'}</strong></span>
                  <span className="truncate text-[11px] font-medium text-slate-600">{sale.productSummary || 'منتج غير محدد'}</span>
                  <span className="text-[10px] font-medium text-slate-500">{formatDate(sale.effectiveSaleDate)}</span>
                  <span className="flex items-center justify-end gap-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-500">
                      <i className={`h-1.5 w-1.5 rounded-full ${PAYMENT_TONE[sale.payment.status] || PAYMENT_TONE.unpaid}`} aria-hidden="true" />
                      {SALES_PAYMENT_LABELS[sale.payment.status] || 'غير محدد'}
                      {sale.payment.status === 'partially_paid' ? <span className="text-amber-700">· متبقي {formatNumber(sale.payment.outstandingAmount)}</span> : null}
                    </span>
                    <strong className="text-left text-xs font-semibold text-slate-900 tabular-nums">{formatNumber(sale.totalAmount)}</strong>
                  </span>
                </Link>
              )) : null}
              {salesQuery.status === 'ready' && !salesQuery.data.items.length ? <p className="px-5 py-12 text-center text-xs font-medium text-slate-400">{isSearching ? 'لا توجد فواتير مطابقة لبحثك.' : 'لا توجد فواتير مطابقة في هذا الشهر.'}</p> : null}
              {salesQuery.status === 'error' ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-xs font-semibold text-red-600">{salesQuery.error}</p>
                  <button type="button" onClick={salesQuery.retry} className="mt-3 text-xs font-bold text-slate-700 hover:text-slate-950">إعادة المحاولة</button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <OutstandingInvoicesCard query={outstandingQuery} totalValues={report?.allTimeOutstandingByCurrency} />
      </div>
      <SaleDetailsSideSheet />
    </main>
  );
}
