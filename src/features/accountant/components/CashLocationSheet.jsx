import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronLeft,
  History,
  Loader2,
  ReceiptText,
  Search,
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
import { SystemReceiptDialog } from '@/core/receipts';
import { accountantService } from '@/features/accountant/services/accountant.service';
import { showroomService } from '@/features/showroom/services/showroom.service';

function formatCurrency(value) {
  return `${Number(value ?? 0).toLocaleString('ar-EG')} ج.م`;
}

export function CashLocationSheet({ location, tenantId, onOpenChange, onOperationCreated }) {
  const [operationStage, setOperationStage] = useState('types');
  const [isInvoicePickerOpen, setIsInvoicePickerOpen] = useState(false);
  const [isInvoicePickerClosing, setIsInvoicePickerClosing] = useState(false);
  const [operations, setOperations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [outstandingInvoices, setOutstandingInvoices] = useState([]);
  const [invoiceTotal, setInvoiceTotal] = useState(0);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [invoiceLoadError, setInvoiceLoadError] = useState('');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [collectionAmount, setCollectionAmount] = useState('');
  const [collectionNote, setCollectionNote] = useState('');
  const [isCollecting, setIsCollecting] = useState(false);
  const [collectionError, setCollectionError] = useState('');
  const [invoicePayments, setInvoicePayments] = useState([]);
  const [isLoadingInvoicePayments, setIsLoadingInvoicePayments] = useState(false);
  const [completedReceipt, setCompletedReceipt] = useState(null);
  const [isCompletedReceiptLoading, setIsCompletedReceiptLoading] = useState(false);

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
    setIsInvoicePickerOpen(false);
    setIsInvoicePickerClosing(false);
    setOutstandingInvoices([]);
    setInvoiceTotal(0);
    setInvoiceLoadError('');
    setInvoiceSearch('');
    setSelectedInvoice(null);
    setCollectionAmount('');
    setCollectionNote('');
    setCollectionError('');
    setInvoicePayments([]);
    setCompletedReceipt(null);
    setIsCompletedReceiptLoading(false);
    loadSheetData();
  }, [location?.id, tenantId]);

  const openInvoiceCollection = async () => {
    setIsInvoicePickerClosing(false);
    setIsInvoicePickerOpen(true);
    setSelectedInvoice(null);
    setInvoiceSearch('');
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

  const closeInvoicePicker = () => {
    if (isCollecting || isInvoicePickerClosing) return;
    setIsInvoicePickerClosing(true);
    window.setTimeout(() => {
      setIsInvoicePickerOpen(false);
      setIsInvoicePickerClosing(false);
      setSelectedInvoice(null);
    }, 240);
  };

  const selectInvoice = async (invoice) => {
    setSelectedInvoice(invoice);
    setCollectionAmount('');
    setCollectionNote('');
    setCollectionError('');
    setInvoicePayments([]);
    setIsLoadingInvoicePayments(true);
    try {
      const sale = await showroomService.getSaleDetails({
        tenantId,
        saleId: invoice.id,
        showroomConfigId: invoice.showroomConfigId,
      });
      setInvoicePayments(sale.payments || []);
    } catch {
      setInvoicePayments([]);
    } finally {
      setIsLoadingInvoicePayments(false);
    }
  };

  const submitInvoiceCollection = async (event) => {
    event.preventDefault();
    const safeAmount = Math.round(Number(collectionAmount || 0) * 100) / 100;

    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
      setCollectionError('اكتب مبلغ تحصيل صحيحًا أكبر من صفر.');
      return;
    }
    if (safeAmount > Number(selectedInvoice?.remainingAmount || 0)) {
      setCollectionError('مبلغ التحصيل أكبر من المتبقي على الفاتورة.');
      return;
    }
    if (!collectionNote.trim()) {
      setCollectionError('اكتب بيان التحصيل.');
      return;
    }

    setIsCollecting(true);
    setCollectionError('');
    try {
      const result = await accountantService.settleSalesInvoiceBalance({
        tenantId,
        saleId: selectedInvoice.id,
        amount: safeAmount,
        mode: 'account',
        destinationAccountId: location.id,
        notes: collectionNote,
      });
      await Promise.all([
        loadSheetData(),
        onOperationCreated?.(location.id),
      ]);
      setIsInvoicePickerOpen(false);
      setCompletedReceipt({
        type: 'invoice_collection',
        number: result?.settlement_move_id
          ? String(result.settlement_move_id).slice(0, 12).toUpperCase()
          : null,
        issuedAt: new Date().toISOString(),
        amount: safeAmount,
        currency: 'ج.م',
        party: {
          label: 'العميل',
          name: selectedInvoice.customerName,
          detail: selectedInvoice.productNames?.join('، ') || null,
        },
        account: {
          label: location.kind === 'main' ? 'الخزنة' : 'العهدة',
          name: location.name,
        },
        reference: {
          label: 'الفاتورة',
          value: selectedInvoice.saleNumber
            ? `فاتورة ${selectedInvoice.saleNumber}`
            : selectedInvoice.id,
        },
        items: (selectedInvoice.productNames || []).map((productName, index) => ({
          id: `${selectedInvoice.id}-${index}`,
          label: productName,
        })),
        previousPayments: invoicePayments.map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          date: payment.payment_date,
          label: payment.payment_method,
        })),
        notes: collectionNote.trim(),
        balance: {
          label: 'المتبقي بعد التحصيل',
          value: formatCurrency(
            result?.accounting_remaining_amount
            ?? result?.remaining_amount
            ?? Math.max(Number(selectedInvoice.remainingAmount || 0) - safeAmount, 0),
          ),
        },
      });
      setSelectedInvoice(null);
    } catch (error) {
      setCollectionError(error.message || 'تعذر تسجيل تحصيل الفاتورة.');
    } finally {
      setIsCollecting(false);
    }
  };

  const openOperationReceipt = async (operation) => {
    if (isCompletedReceiptLoading) return;
    const isIncoming = operation.direction === 'in';
    const counterpartNames = (operation.counterpartLines || [])
      .map((line) => [line.accountCode, line.accountName].filter(Boolean).join(' — '))
      .filter(Boolean)
      .join('، ');
    const saleId = String(operation.reference || '').match(/^showroom_sale:(.+)$/)?.[1] || null;
    const baseReceipt = {
      type: saleId ? 'invoice_collection' : isIncoming ? 'receipt' : 'payment',
      number: operation.moveId
        ? String(operation.moveId).slice(0, 12).toUpperCase()
        : null,
      issuedAt: operation.occurredAt || operation.dateLabel,
      amount: operation.amount,
      currency: 'ج.م',
      party: {
        label: isIncoming ? 'تم الاستلام من' : 'تم الدفع إلى',
        name: operation.partyName || 'غير محدد',
      },
      account: {
        label: location.kind === 'main' ? 'الخزنة' : 'العهدة',
        name: location.name,
      },
      reference: {
        label: 'المرجع',
        value: operation.reference || operation.label,
      },
      notes: operation.note || operation.label,
      metadata: counterpartNames
        ? [{ label: 'الحساب المقابل', value: counterpartNames }]
        : [],
    };

    setCompletedReceipt(baseReceipt);
    setIsCompletedReceiptLoading(true);
    let previousPayments = [];
    let balance = null;
    let partyName = operation.partyName || 'غير محدد';

    if (saleId) {
      try {
        const sale = await showroomService.getSaleReceiptContext({ tenantId, saleId });
        const payments = sale.payments || [];
        const currentPaymentIndex = payments.findIndex(
          (payment) => payment.account_move_id === operation.moveId,
        );
        const paymentsBeforeCurrent = currentPaymentIndex >= 0
          ? payments.slice(0, currentPaymentIndex)
          : payments;
        const paidThroughOperation = payments
          .slice(0, currentPaymentIndex >= 0 ? currentPaymentIndex + 1 : payments.length)
          .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

        previousPayments = paymentsBeforeCurrent.map((payment) => ({
          id: payment.id,
          amount: payment.amount,
          date: payment.payment_date,
          label: payment.payment_method,
        }));
        balance = {
          label: 'المتبقي بعد التحصيل',
          value: formatCurrency(Math.max(Number(sale.totalAmount || 0) - paidThroughOperation, 0)),
        };
        partyName = sale.customerName || partyName;
      } catch {
        previousPayments = [];
        balance = null;
      }
    }

    setCompletedReceipt({
      ...baseReceipt,
      party: {
        label: isIncoming ? 'تم الاستلام من' : 'تم الدفع إلى',
        name: partyName,
      },
      previousPayments,
      balance,
    });
    setIsCompletedReceiptLoading(false);
  };

  const operationButtons = (
    <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
      <button
        type="button"
        onClick={openInvoiceCollection}
        className="group flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/85 px-3 py-2 text-right text-white shadow-[0_8px_20px_rgba(15,23,42,0.16)] backdrop-blur-xl transition hover:bg-slate-900/95 hover:shadow-[0_10px_24px_rgba(15,23,42,0.2)] active:scale-[0.98]"
      >
        <span className="min-w-0 flex-1 text-xs font-black leading-4">تحصيل فاتورة</span>
        <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-white/60 transition-transform group-hover:-translate-x-0.5 group-hover:text-white" />
      </button>

      {[2, 3, 4].map((item) => (
        <button
          key={item}
          type="button"
          disabled
          className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-white/70 bg-white/15 px-3 py-2 text-right text-slate-600 shadow-[0_5px_15px_rgba(15,23,42,0.05)] backdrop-blur-xl"
        >
          <span className="min-w-0 flex-1 text-[11px] font-bold leading-4">نوع عملية جديد</span>
          <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-slate-300" />
        </button>
      ))}
    </div>
  );

  const normalizedInvoiceSearch = invoiceSearch.trim().toLocaleLowerCase('ar');
  const filteredInvoices = normalizedInvoiceSearch
    ? outstandingInvoices.filter((invoice) => [
      invoice.customerName,
      invoice.saleNumber,
      ...(invoice.productNames || []),
    ].some((value) => String(value || '').toLocaleLowerCase('ar').includes(normalizedInvoiceSearch)))
    : outstandingInvoices;

  return (
    <Sheet open={Boolean(location)} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full max-w-full bg-slate-50 p-0 sm:max-w-[560px]" dir="rtl">
        <SheetHeader className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-br from-slate-200 via-slate-100 to-blue-100 px-5 pb-6 pt-5 text-slate-950 sm:px-7">
          <span className="pointer-events-none absolute -left-14 -top-20 h-52 w-52 rounded-full bg-white/70 blur-3xl" />
          <span className="pointer-events-none absolute -bottom-24 right-4 h-48 w-48 rounded-full bg-blue-300/35 blur-3xl" />
          <span className="pointer-events-none absolute right-[42%] top-10 h-24 w-24 rounded-full bg-indigo-200/35 blur-2xl" />
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
                          <button
                            key={operation.id}
                            type="button"
                            onClick={() => openOperationReceipt(operation)}
                            className="flex w-full items-center gap-3 px-4 py-3.5 text-right transition hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none"
                          >
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                              isIncoming ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                            }`}>
                              <OperationIcon className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-black text-slate-900">{operation.label}</p>
                              <p className="mt-1 truncate text-[11px] font-bold text-slate-400">
                                {operation.dateLabel || 'بدون تاريخ'}
                              </p>
                            </div>
                            <p className={`shrink-0 text-sm font-black ${isIncoming ? 'text-emerald-700' : 'text-red-600'}`}>
                              {isIncoming ? '+' : '-'} {formatCurrency(operation.amount)}
                            </p>
                          </button>
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

        {isInvoicePickerOpen ? (
          <div className="absolute inset-0 z-20 flex items-end overflow-hidden overscroll-contain" dir="rtl">
            <button
              type="button"
              aria-label="إغلاق قائمة الفواتير"
              onClick={closeInvoicePicker}
              className={`absolute inset-0 bg-slate-950/30 backdrop-blur-[2px] ${
                isInvoicePickerClosing ? 'cash-invoice-backdrop-exit' : 'cash-invoice-backdrop-enter'
              }`}
            />
            <section className={`relative z-10 flex h-[86%] w-full transform-gpu flex-col overflow-hidden overscroll-contain rounded-t-[28px] border-t border-slate-200 bg-slate-50 shadow-[0_-20px_60px_rgba(15,23,42,0.2)] will-change-transform ${
              isInvoicePickerClosing ? 'cash-invoice-bottom-sheet-exit' : 'cash-invoice-bottom-sheet'
            }`}>
              <div className="shrink-0 border-b border-slate-200 bg-white px-5 pb-4 pt-3 sm:px-7">
                <div className="mx-auto mb-4 h-1.5 w-11 rounded-full bg-slate-300" />
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => selectedInvoice ? setSelectedInvoice(null) : closeInvoicePicker()}
                    disabled={isCollecting}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"
                    aria-label="رجوع"
                  >
                    <ArrowRight className="h-5 w-5" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-base font-black text-slate-950">
                      {selectedInvoice ? selectedInvoice.customerName : 'اختر الفاتورة'}
                    </h3>
                    <p className="mt-0.5 truncate text-xs font-bold text-slate-400">
                      {selectedInvoice
                        ? (selectedInvoice.productNames?.length ? selectedInvoice.productNames.join('، ') : 'منتجات الفاتورة غير محددة')
                        : 'الفواتير التي ما زال عليها رصيد'}
                    </p>
                  </div>
                  {selectedInvoice ? (
                    <div className="shrink-0 text-left">
                      <p className="text-sm font-black text-red-600">{formatCurrency(selectedInvoice.remainingAmount)}</p>
                      <p className="mt-0.5 text-[10px] font-bold text-slate-400">
                        من إجمالي {formatCurrency(selectedInvoice.totalAmount)}
                      </p>
                    </div>
                  ) : (
                    <span className="text-xs font-black text-slate-500">{outstandingInvoices.length}</span>
                  )}
                </div>

                {selectedInvoice ? (
                  <div className="mt-3">
                    {isLoadingInvoicePayments ? (
                      <div className="flex h-9 items-center gap-2 text-xs font-bold text-slate-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        جاري تحميل الدفعات...
                      </div>
                    ) : invoicePayments.length ? (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {invoicePayments.map((payment) => (
                          <div
                            key={payment.id}
                            className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                          >
                            <p className="text-xs font-black text-emerald-700">{formatCurrency(payment.amount)}</p>
                            <p className="mt-0.5 text-[9px] font-bold text-slate-400">
                              {payment.payment_date
                                ? new Date(payment.payment_date).toLocaleDateString('ar-EG')
                                : 'بدون تاريخ'}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs font-bold text-slate-400">لا توجد دفعات سابقة على الفاتورة.</p>
                    )}
                  </div>
                ) : null}

                {!selectedInvoice ? (
                  <label className="mt-4 flex h-11 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 transition focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50">
                    <Search className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      type="search"
                      value={invoiceSearch}
                      onChange={(event) => setInvoiceSearch(event.target.value)}
                      placeholder="ابحث باسم العميل أو رقم الفاتورة"
                      className="min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-900 outline-none placeholder:text-slate-400"
                    />
                    {invoiceSearch ? (
                      <button
                        type="button"
                        onClick={() => setInvoiceSearch('')}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                        aria-label="مسح البحث"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </label>
                ) : null}
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 sm:px-7">
                {selectedInvoice ? (
                  <form onSubmit={submitInvoiceCollection} className="space-y-4">
                    <div className="space-y-2">
                      <label htmlFor="invoice-collection-amount" className="block text-sm font-black text-slate-800">مبلغ التحصيل</label>
                      <input
                        id="invoice-collection-amount"
                        type="number"
                        min="0.01"
                        max={selectedInvoice.remainingAmount}
                        step="0.01"
                        inputMode="decimal"
                        value={collectionAmount}
                        onChange={(event) => setCollectionAmount(event.target.value)}
                        disabled={isCollecting}
                        className="h-12 w-full rounded-xl border border-slate-200 bg-white px-4 text-lg font-black text-slate-950 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50 disabled:opacity-60"
                      />
                    </div>

                    <div className="space-y-2">
                      <label htmlFor="invoice-collection-note" className="block text-sm font-black text-slate-800">بيان التحصيل</label>
                      <textarea
                        id="invoice-collection-note"
                        rows={3}
                        value={collectionNote}
                        onChange={(event) => setCollectionNote(event.target.value)}
                        disabled={isCollecting}
                        className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-900 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50 disabled:opacity-60"
                      />
                    </div>

                    {collectionError ? (
                      <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{collectionError}</p>
                    ) : null}

                    <button
                      type="submit"
                      disabled={
                        isCollecting
                        || !collectionNote.trim()
                        || !Number.isFinite(Number(collectionAmount))
                        || Number(collectionAmount) <= 0
                        || Number(collectionAmount) > Number(selectedInvoice.remainingAmount || 0)
                      }
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isCollecting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      {isCollecting ? 'جاري تسجيل التحصيل...' : 'تأكيد التحصيل'}
                    </button>
                  </form>
                ) : isLoadingInvoices ? (
                  <div className="flex min-h-40 items-center justify-center gap-2 text-sm font-black text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري تحميل الفواتير...
                  </div>
                ) : invoiceLoadError ? (
                  <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{invoiceLoadError}</p>
                ) : filteredInvoices.length ? (
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <div className="divide-y divide-slate-100">
                      {filteredInvoices.map((invoice) => (
                        <button
                          key={invoice.id}
                          type="button"
                          onClick={() => selectInvoice(invoice)}
                          className="flex w-full items-center gap-3 px-4 py-3.5 text-right transition hover:bg-slate-50"
                        >
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
                    <p className="text-sm font-black text-slate-700">
                      {invoiceSearch ? 'لا توجد نتائج مطابقة' : 'لا توجد فواتير مستحقة'}
                    </p>
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {invoiceSearch ? 'جرّب البحث بكلمة أخرى' : 'جميع الفواتير مسددة حاليًا'}
                    </p>
                  </div>
                )}
              </div>
            </section>
          </div>
        ) : null}

        <SystemReceiptDialog
          open={Boolean(completedReceipt)}
          onOpenChange={(open) => {
            if (!open && !isCompletedReceiptLoading) setCompletedReceipt(null);
          }}
          receipt={completedReceipt || {}}
          isLoading={isCompletedReceiptLoading}
        />
      </SheetContent>
    </Sheet>
  );
}
