import { useMemo, useState } from 'react';

import { ChevronLeft, ChevronRight, FileText } from 'lucide-react';

export function ShowroomInvoicesCard({ invoices = [], isLoading = false, error = '', onInvoiceSelect }) {
  const [reportMonth, setReportMonth] = useState(() => new Date());

  const filteredInvoices = invoices;

  const monthLabel = useMemo(() => (
    new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
      month: 'long',
      year: 'numeric',
    }).format(reportMonth)
  ), [reportMonth]);

  const monthStats = useMemo(() => {
    const year = reportMonth.getFullYear();
    const month = reportMonth.getMonth();
    const monthInvoices = invoices.filter((invoice) => {
      const date = new Date(invoice.sale_date || invoice.created_at);
      return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month;
    });

    return {
      count: monthInvoices.length,
      total: monthInvoices.reduce((sum, invoice) => sum + Number(invoice.total_amount ?? invoice.totalAmount ?? 0), 0),
    };
  }, [invoices, reportMonth]);

  const changeReportMonth = (offset) => {
    setReportMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const getInvoiceProductsText = (invoice) => {
    const items = Array.isArray(invoice.items) && invoice.items.length > 0
      ? invoice.items
      : Array.isArray(invoice.lines)
        ? invoice.lines
        : [];

    return items
      .map((item) => item?.displayName || item?.name || item?.description)
      .filter(Boolean)
      .join('، ');
  };

  return (
    <section className="flex h-[min(660px,calc(100vh-7rem))] min-h-[440px] flex-col overflow-hidden bg-[#f7fbff] text-[#173653]">
      <header className="border-b-2 border-[#9fc6e3] px-6 py-5 shadow-[0_10px_18px_-20px_rgba(47,134,207,0.75)] sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#edf5fc]">
            <FileText className="h-5 w-5 text-[#2f86cf]" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight text-[#173653] sm:text-2xl">عمليات البيع</h2>
            <div className="mt-0.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() => changeReportMonth(1)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[#668097] transition hover:bg-[#edf5fc] hover:text-[#173653]"
                aria-label="الشهر التالي"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold text-[#668097]">{monthLabel}</span>
              <button
                type="button"
                onClick={() => changeReportMonth(-1)}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[#668097] transition hover:bg-[#edf5fc] hover:text-[#173653]"
                aria-label="الشهر السابق"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs font-bold text-[#668097]">·</span>
              <span className="text-xs font-black text-[#173653]">{monthStats.count.toLocaleString('en-US')}</span>
              <span className="text-xs font-bold text-[#668097]">فاتورة</span>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex h-full items-center justify-center px-5 text-center text-sm font-bold text-[#668097]">
            جاري تحميل عمليات البيع...
          </div>
        ) : error ? (
          <div className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 sm:m-6">
            {error}
          </div>
        ) : filteredInvoices.length > 0 ? (
          <div className="divide-y divide-[#e1edf7]">
            {filteredInvoices.map((invoice) => {
              const totalAmount = Number(invoice.total_amount ?? invoice.totalAmount ?? 0);
              const paidAmount = Number(invoice.paid_amount ?? invoice.paidAmount ?? 0);
              const remainingAmount = Number(invoice.remaining_amount ?? Math.max(totalAmount - paidAmount, 0));
              return (
                <button
                  type="button"
                  key={invoice.id}
                  onClick={() => onInvoiceSelect?.(invoice)}
                  className="block w-full px-6 py-4 text-right transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-inset focus:ring-[#2f86cf]/15 sm:px-8"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black text-[#173653]">{invoice.customer?.name || 'عميل'}</p>
                      {getInvoiceProductsText(invoice) ? (
                        <p className="mt-1 max-w-[13rem] truncate text-xs font-bold text-[#668097]">
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
                      <p className="text-sm font-black text-[#2f86cf]">
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
          <div className="flex h-full items-center justify-center px-5 text-center text-sm font-bold text-[#668097]">
            لا توجد عمليات بيع حالياً
          </div>
        )}
      </div>
    </section>
  );
}
