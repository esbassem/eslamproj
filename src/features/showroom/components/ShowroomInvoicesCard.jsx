import { useMemo, useState } from 'react';

import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';

function getInvoiceItems(invoice) {
  return Array.isArray(invoice?.items) && invoice.items.length > 0
    ? invoice.items
    : Array.isArray(invoice?.lines)
      ? invoice.lines
      : [];
}

function isInvoiceInMonth(invoice, reportMonth) {
  const date = new Date(invoice?.sale_date || invoice?.created_at);
  return (
    !Number.isNaN(date.getTime())
    && date.getFullYear() === reportMonth.getFullYear()
    && date.getMonth() === reportMonth.getMonth()
  );
}

export function ShowroomInvoicesCard({
  invoices = [],
  isLoading = false,
  error = '',
  onInvoiceSelect,
  reportMonth: controlledReportMonth,
  onReportMonthChange,
}) {
  const [localReportMonth, setLocalReportMonth] = useState(() => new Date());
  const reportMonth = controlledReportMonth || localReportMonth;

  const filteredInvoices = useMemo(
    () => invoices.filter((invoice) => isInvoiceInMonth(invoice, reportMonth)),
    [invoices, reportMonth],
  );

  const monthLabel = useMemo(() => (
    new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      month: 'long',
      year: 'numeric',
    }).format(reportMonth)
  ), [reportMonth]);

  const monthStats = useMemo(() => {
    return {
      count: filteredInvoices.length,
      total: filteredInvoices.reduce((sum, invoice) => sum + Number(invoice.total_amount ?? invoice.totalAmount ?? 0), 0),
    };
  }, [filteredInvoices]);

  const changeReportMonth = (offset) => {
    const nextMonth = new Date(reportMonth.getFullYear(), reportMonth.getMonth() + offset, 1);

    if (onReportMonthChange) {
      onReportMonthChange(nextMonth);
    } else {
      setLocalReportMonth(nextMonth);
    }
  };

  const getInvoiceProductsText = (invoice) => (
    getInvoiceItems(invoice)
      .map((item) => item?.displayName || item?.name || item?.description)
      .filter(Boolean)
      .join('، ')
  );

  const renderLoading = (message) => (
    <div className="flex h-full items-center justify-center px-5 text-center text-sm font-bold text-[#8e6f76]">
      {message}
    </div>
  );

  const renderError = () => (
    <div className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 sm:m-6">
      {error}
    </div>
  );

  return (
    <section className="flex h-[min(660px,calc(100vh-7rem))] min-h-[440px] flex-col overflow-hidden bg-white text-slate-900">
      <header className="border-b border-slate-200 px-6 py-5 sm:px-8 xl:hidden">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
            <FileText className="h-5 w-5 text-slate-700" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight text-[#173653] sm:text-2xl">عمليات البيع</h2>
            <div className="mt-0.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() => changeReportMonth(1)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label="الشهر التالي"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold text-slate-500">{monthLabel}</span>
              <button
                type="button"
                onClick={() => changeReportMonth(-1)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label="الشهر السابق"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold text-slate-400">·</span>
              <span className="text-xs font-black text-slate-900">{monthStats.count.toLocaleString('en-US')}</span>
              <span className="text-xs font-bold text-slate-500">فاتورة</span>
            </div>
          </div>
        </div>
      </header>

      <header className="hidden border-b border-slate-200 px-6 py-5 sm:px-8 xl:block">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100">
            <FileText className="h-5 w-5 text-slate-700" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight text-[#173653] sm:text-2xl">عمليات البيع</h2>
            <div className="mt-0.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() => changeReportMonth(1)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label="الشهر التالي"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold text-slate-500">{monthLabel}</span>
              <button
                type="button"
                onClick={() => changeReportMonth(-1)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-800"
                aria-label="الشهر السابق"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold text-slate-400">·</span>
              <span className="text-xs font-black text-slate-900">{monthStats.count.toLocaleString('en-US')}</span>
              <span className="text-xs font-bold text-slate-500">فاتورة</span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto xl:hidden">
        {isLoading ? (
          renderLoading('جاري تحميل عمليات البيع...')
        ) : error ? (
          renderError()
        ) : filteredInvoices.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {filteredInvoices.map((invoice) => {
              const totalAmount = Number(invoice.total_amount ?? invoice.totalAmount ?? 0);
              const paidAmount = Number(invoice.paid_amount ?? invoice.paidAmount ?? 0);
              const remainingAmount = Number(invoice.remaining_amount ?? Math.max(totalAmount - paidAmount, 0));

              return (
                <button
                  type="button"
                  key={invoice.id}
                  onClick={() => onInvoiceSelect?.(invoice)}
                  className="block w-full px-6 py-4 text-right transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-inset focus:ring-slate-200 sm:px-8"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">{invoice.customer?.name || 'عميل'}</p>
                      {getInvoiceProductsText(invoice) ? (
                        <p className="mt-1 max-w-[13rem] truncate text-xs font-bold text-slate-500">
                          {getInvoiceProductsText(invoice)}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs font-bold text-[#7e969f]">
                        {new Intl.DateTimeFormat('ar-EG', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }).format(new Date(invoice.created_at))}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-black text-slate-900">
                        {totalAmount.toLocaleString('ar-EG')} EGP
                      </p>
                      <p className="mt-1 text-[11px] font-bold text-emerald-700">
                        مدفوع {paidAmount.toLocaleString('ar-EG')}
                      </p>
                      <p className="mt-0.5 text-[11px] font-bold text-red-600">
                        متبقي {remainingAmount.toLocaleString('ar-EG')}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-5 text-center text-sm font-bold text-[#8e6f76]">
            لا توجد عمليات بيع حالياً
          </div>
        )}
      </div>

      <div className="hidden flex-1 overflow-y-auto xl:block">
        {isLoading ? (
          renderLoading('جاري تحميل عمليات البيع...')
        ) : error ? (
          renderError()
        ) : filteredInvoices.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {filteredInvoices.map((invoice) => {
              const totalAmount = Number(invoice.total_amount ?? invoice.totalAmount ?? 0);
              const paidAmount = Number(invoice.paid_amount ?? invoice.paidAmount ?? 0);
              const remainingAmount = Number(invoice.remaining_amount ?? Math.max(totalAmount - paidAmount, 0));
              return (
                <button
                  type="button"
                  key={invoice.id}
                  onClick={() => onInvoiceSelect?.(invoice)}
                  className="block w-full px-6 py-4 text-right transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-inset focus:ring-slate-200 sm:px-8"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-slate-900">{invoice.customer?.name || 'عميل'}</p>
                      {getInvoiceProductsText(invoice) ? (
                        <p className="mt-1 max-w-[13rem] truncate text-xs font-bold text-slate-500">
                          {getInvoiceProductsText(invoice)}
                        </p>
                      ) : null}
                      <p className="mt-2 text-xs font-bold text-[#7e969f]">
                        {new Intl.DateTimeFormat('ar-EG', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }).format(new Date(invoice.created_at))}
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-black text-slate-900">
                        {totalAmount.toLocaleString('ar-EG')} EGP
                      </p>
                      <p className="mt-1 text-[11px] font-bold text-emerald-700">
                        مدفوع {paidAmount.toLocaleString('ar-EG')}
                      </p>
                      <p className="mt-0.5 text-[11px] font-bold text-red-600">
                        متبقي {remainingAmount.toLocaleString('ar-EG')}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center px-5 text-center text-sm font-bold text-[#8e6f76]">
            لا توجد عمليات بيع حالياً
          </div>
        )}
      </div>
    </section>
  );
}
