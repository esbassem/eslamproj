import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  History,
  Loader2,
  ReceiptText,
  X,
} from 'lucide-react';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { accountantService } from '@/features/accountant/services/accountant.service';

function formatCurrency(value) {
  return `${Number(value ?? 0).toLocaleString('ar-EG')} ج.م`;
}

export function CashLocationSheet({ location, tenantId, onOpenChange }) {
  const [operationStage, setOperationStage] = useState('types');
  const [operations, setOperations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [outstandingInvoices, setOutstandingInvoices] = useState([]);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [invoiceLoadError, setInvoiceLoadError] = useState('');

  const loadSheetData = async () => {
    if (!tenantId || !location?.id) return;

    setIsLoading(true);
    setLoadError('');
    try {
      const nextOperations = await accountantService.listCashLocationOperations({
        tenantId,
        accountId: location.id,
      });
      setOperations(nextOperations);
    } catch (error) {
      setOperations([]);
      setLoadError(error.message || 'تعذر تحميل بيانات الخزنة.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!location?.id) return;

    setOperationStage('types');
    setOutstandingInvoices([]);
    setInvoiceTotal(0);
    setInvoiceLoadError('');
    loadSheetData();
  }, [location?.id, tenantId]);

  const openInvoiceCollection = async () => {
    setOperationStage('invoice-collection');
    setIsLoadingInvoices(true);
    setInvoiceLoadError('');

    try {
      const summary = await accountantService.getSalesInvoiceSummary({ tenantId });
      setOutstandingInvoices(summary.invoices || []);
      setInvoiceTotal(summary.total || 0);
    } catch (error) {
      setOutstandingInvoices([]);
      setInvoiceTotal(0);
      setInvoiceLoadError(error.message || 'تعذر تحميل الفواتير المستحقة.');
    } finally {
      setIsLoadingInvoices(false);
    }
  };

  const operationButtons = (
    <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
      <button
        type="button"
        onClick={openInvoiceCollection}
        className="group flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-slate-800/90 bg-slate-900/95 px-3 py-2 text-right text-white shadow-[0_8px_20px_rgba(15,23,42,0.18)] backdrop-blur-md transition hover:bg-slate-800 hover:shadow-[0_10px_24px_rgba(15,23,42,0.22)] active:scale-[0.98]"
      >
        <span className="min-w-0 flex-1 text-xs font-black leading-4">تحصيل فاتورة</span>
        <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-white/60 transition-transform group-hover:-translate-x-0.5 group-hover:text-white" />
      </button>

      {[2, 3, 4].map((item) => (
        <button
          key={item}
          type="button"
          disabled
          className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-white/80 bg-white/25 px-3 py-2 text-right text-slate-500 shadow-[0_5px_15px_rgba(15,23,42,0.05)] backdrop-blur-md"
        >
          <span className="min-w-0 flex-1 text-[11px] font-bold leading-4">نوع عملية جديد</span>
          <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-slate-300" />
        </button>
      ))}
    </div>
  );

  return (
    <Sheet open={Boolean(location)} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full max-w-full bg-slate-50 p-0 sm:max-w-[560px]" dir="rtl">
        <SheetHeader className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 px-5 pb-6 pt-5 text-slate-950 sm:px-7">
          <span className="pointer-events-none absolute -left-14 -top-20 h-52 w-52 rounded-full bg-white/80 blur-3xl" />
          <span className="pointer-events-none absolute -bottom-24 right-4 h-48 w-48 rounded-full bg-blue-200/30 blur-3xl" />
          {operationStage === 'invoice-collection' ? (
            <div className="cash-sheet-stage-enter relative flex items-center gap-3">
              <button
                type="button"
                onClick={() => setOperationStage('types')}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white bg-white/70 text-slate-700 shadow-sm backdrop-blur-md transition hover:bg-white"
                aria-label="رجوع"
              >
                <ArrowRight className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate text-base font-black text-slate-950">الفواتير المستحقة</SheetTitle>
                <p className="mt-1 text-xs font-bold text-slate-500">الفواتير التي ما زال عليها رصيد</p>
              </div>
              <div className="shrink-0 text-left">
                <p className="text-[10px] font-bold text-slate-400">إجمالي المستحق</p>
                <p className="mt-1 text-sm font-black text-red-600">
                  {isLoadingInvoices ? '...' : formatCurrency(invoiceTotal)}
                </p>
              </div>
            </div>
          ) : (
            <div className="cash-sheet-stage-enter relative">
              <SheetClose className="absolute left-0 top-0 flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/70 hover:text-slate-900">
                <X className="h-5 w-5" />
                <span className="sr-only">إغلاق</span>
              </SheetClose>
              <SheetTitle className="truncate pl-12 text-base font-black text-slate-950">{location?.name || 'الخزنة'}</SheetTitle>
              <div className="mt-5 flex items-start gap-3">
                <div className="w-[30%] shrink-0 pt-1">
                  <p className="text-[11px] font-bold text-slate-500">الرصيد الحالي</p>
                  <p className="mt-1 whitespace-nowrap text-lg font-black tracking-tight text-slate-950">
                    {formatCurrency(location?.balance || 0)}
                  </p>
                </div>
                {operationButtons}
              </div>
            </div>
          )}
        </SheetHeader>

        <SheetBody className="px-5 py-6 sm:px-7">
          {operationStage === 'invoice-collection' ? (
            <div className="cash-sheet-stage-enter">
              {isLoadingInvoices ? (
                <div className="flex min-h-48 items-center justify-center gap-2 text-sm font-black text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري تحميل الفواتير...
                </div>
              ) : invoiceLoadError ? (
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
                  {invoiceLoadError}
                </p>
              ) : outstandingInvoices.length ? (
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="divide-y divide-slate-100">
                    {outstandingInvoices.map((invoice) => (
                      <button
                        key={invoice.id}
                        type="button"
                        className="flex w-full items-center gap-3 px-4 py-3.5 text-right transition hover:bg-slate-50"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                          <ReceiptText className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-black text-slate-900">{invoice.customerName}</span>
                          <span className="mt-1 block truncate text-[11px] font-bold text-slate-400">
                            {invoice.saleNumber ? `فاتورة ${invoice.saleNumber}` : 'فاتورة مبيعات'}
                            {invoice.saleDate ? ` · ${new Date(invoice.saleDate).toLocaleDateString('ar-EG')}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-left">
                          <span className="block text-sm font-black text-red-600">{formatCurrency(invoice.remainingAmount)}</span>
                          <span className="mt-1 block text-[10px] font-bold text-slate-400">متبقي</span>
                        </span>
                        <ChevronLeft className="h-4 w-4 shrink-0 text-slate-300" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white px-5 py-10 text-center">
                  <ReceiptText className="mx-auto h-7 w-7 text-slate-300" />
                  <p className="mt-3 text-sm font-black text-slate-700">لا توجد فواتير مستحقة</p>
                  <p className="mt-1 text-xs font-bold text-slate-400">جميع الفواتير مسددة حاليًا</p>
                </div>
              )}
            </div>
          ) : (
            <div className="cash-sheet-stage-enter">
              <section>
                <div className="mb-3 flex items-center gap-2 px-1">
                  <History className="h-4 w-4 text-slate-500" />
                  <h3 className="text-sm font-black text-slate-900">سجل العمليات</h3>
                </div>

                {isLoading ? (
                  <div className="flex min-h-36 items-center justify-center gap-2 rounded-2xl border border-slate-200 text-sm font-black text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري تحميل السجل...
                  </div>
                ) : loadError ? (
                  <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{loadError}</p>
                ) : operations.length ? (
                  <div className="overflow-hidden rounded-2xl border border-slate-200">
                    <div className="divide-y divide-slate-100">
                      {operations.map((operation) => {
                        const isIncoming = operation.direction === 'in';
                        const OperationIcon = isIncoming ? ArrowDownToLine : ArrowUpFromLine;
                        return (
                          <div key={operation.id} className="flex items-center gap-3 px-4 py-3.5">
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                              isIncoming ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                            }`}>
                              <OperationIcon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-black text-slate-900">{operation.label}</p>
                              <p className="mt-1 truncate text-[11px] font-bold text-slate-400">{operation.dateLabel || 'بدون تاريخ'}</p>
                            </div>
                            <p className={`shrink-0 text-sm font-black ${isIncoming ? 'text-emerald-700' : 'text-red-600'}`}>
                              {isIncoming ? '+' : '-'} {formatCurrency(operation.amount)}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center">
                    <History className="mx-auto h-6 w-6 text-slate-300" />
                    <p className="mt-3 text-sm font-black text-slate-600">لا توجد عمليات حتى الآن</p>
                  </div>
                )}
              </section>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
