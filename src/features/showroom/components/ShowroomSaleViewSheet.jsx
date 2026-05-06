import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Package, Printer, User } from 'lucide-react';
import { ShowroomContractPreview } from '@/features/showroom/components/ShowroomContractPreview';
import { showroomService } from '@/features/showroom/services/showroom.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG')} EGP`;
}

function SaleSheetSkeleton() {
  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-4" dir="rtl">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-[#2f86cf]" />
        <div className="text-sm font-bold text-slate-500">جاري تحميل الفاتورة...</div>
      </div>
    </div>
  );
}

function SaleSheetContent({ sale, onContractOpen }) {
  const totalAmount = Number(sale?.total_amount ?? sale?.totalAmount ?? 0);
  const paymentsTotal = Array.isArray(sale?.payments)
    ? sale.payments.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0)
    : 0;
  const paidAmount = Number(sale?.paid_amount ?? sale?.paidAmount ?? paymentsTotal);
  const remainingAmount = Number(sale?.remaining_amount ?? Math.max(totalAmount - paidAmount, 0));
  const items = Array.isArray(sale?.items) && sale.items.length > 0
    ? sale.items
    : Array.isArray(sale?.lines)
      ? sale.lines
      : [];

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4" dir="rtl">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <User className="h-5 w-5 shrink-0 text-slate-400" />
              <h2 className="truncate text-xl font-black text-slate-800">
                {sale?.customer?.name || 'عميل غير محدد'}
              </h2>
            </div>
            {sale?.customer?.phone && (
              <p className="mt-0.5 pr-7 text-sm text-slate-500">{sale.customer.phone}</p>
            )}
            <p className="mt-1 pr-7 text-xs text-slate-400">
              {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'long', timeStyle: 'short' }).format(
                new Date(sale?.created_at || Date.now()),
              )}
            </p>
          </div>
          <div className="shrink-0">
            <button
              type="button"
              onClick={onContractOpen}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-200"
              aria-label="عرض العقد"
            >
              <Printer className="h-4 w-4" />
            </button>
          </div>
        </div>

        {items.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
              <Package className="h-5 w-5 text-slate-400" />
              <h3 className="text-sm font-bold text-slate-700">المنتجات</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {items.map((item, index) => {
                const itemName = item?.displayName || item?.name || item?.description || `منتج ${index + 1}`;
                const itemPrice = Number(item?.price ?? item?.unit_price ?? 0);
                const itemQty = Number(item?.quantity ?? 1);
                const itemTotal = Number(item?.total ?? item?.line_total ?? itemPrice * itemQty);

                return (
                  <div key={item?.lineId || item?.lineUuid || item?.id || index} className="flex items-start justify-between gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800 truncate">{itemName}</p>
                      {itemQty > 1 && (
                        <p className="mt-0.5 text-xs text-slate-400">
                          {itemQty} × {formatMoney(itemPrice)}
                        </p>
                      )}
                      {item?.serialNumber && !(Array.isArray(item?.trackingIdentifiers) && item.trackingIdentifiers.length) && (
                        <p className="mt-0.5 text-xs text-slate-400">رقم تسلسلي: {item.serialNumber}</p>
                      )}
                      {Array.isArray(item?.trackingIdentifiers) && item.trackingIdentifiers.length ? (
                        <p className="mt-0.5 truncate text-xs text-slate-400">
                          {item.trackingIdentifiers.map((identifier) => `${identifier.label}: ${identifier.value}`).join(' - ')}
                        </p>
                      ) : null}
                      {item?.ownership_name && (
                        <p className="mt-0.5 text-xs text-slate-400">نقل ملكية: {item.ownership_name}</p>
                      )}
                    </div>
                    <p className="shrink-0 font-mono text-sm font-bold text-slate-800">{formatMoney(itemTotal)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            <div className="flex items-center justify-between px-5 py-4">
              <span className="text-sm font-bold text-slate-600">الإجمالي</span>
              <span className="font-mono text-base font-black text-slate-800">{formatMoney(totalAmount)}</span>
            </div>
            {paidAmount > 0 && (
              <div className="flex items-center justify-between px-5 py-4">
                <span className="text-sm font-bold text-emerald-700">المدفوع</span>
                <span className="font-mono text-base font-black text-emerald-700">{formatMoney(paidAmount)}</span>
              </div>
            )}
            {remainingAmount > 0 && (
              <div className="flex items-center justify-between px-5 py-4">
                <span className="text-sm font-bold text-red-600">المتبقي</span>
                <span className="font-mono text-base font-black text-red-700">{formatMoney(remainingAmount)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ShowroomSaleViewSheet({ sale, isOpen, onClose }) {
  const { tenant } = useWorkspace();
  const [fullSale, setFullSale] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [isContractOpen, setIsContractOpen] = useState(false);

  const fetchDetails = useCallback(async () => {
    if (!sale?.id) return;

    if (
      (Array.isArray(sale.items) && sale.items.length > 0) ||
      (Array.isArray(sale.lines) && sale.lines.length > 0)
    ) {
      setFullSale(sale);
      return;
    }

    if (!tenant?.id) {
      setFullSale(sale);
      return;
    }

    setIsLoading(true);
    setFetchError('');
    try {
      const data = await showroomService.getSaleDetails({ tenantId: tenant.id, saleId: sale.id });
      setFullSale(data);
    } catch (err) {
      setFetchError(err.message || 'تعذر تحميل تفاصيل العملية');
      setFullSale(sale);
    } finally {
      setIsLoading(false);
    }
  }, [sale, tenant?.id]);

  useEffect(() => {
    if (isOpen) {
      fetchDetails();
    } else {
      setFullSale(null);
      setFetchError('');
      setIsContractOpen(false);
    }
  }, [isOpen, fetchDetails]);

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {isOpen && sale && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            onClick={onClose}
            style={{ zIndex: 2147483640 }}
            className="fixed inset-0 bg-black/60"
          />
          <motion.div
            key="sheet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            style={{ zIndex: 2147483641 }}
            className="fixed bottom-0 left-1/2 flex h-[92%] w-[calc(100vw-1rem)] max-w-[30rem] -translate-x-1/2 flex-col overflow-hidden rounded-t-2xl bg-white sm:w-[30rem] lg:bottom-4 lg:h-[80vh] lg:rounded-2xl"
          >
            {isLoading ? (
              <SaleSheetSkeleton />
            ) : fetchError && !fullSale ? (
              <div className="flex h-full items-center justify-center p-8 text-center text-red-500" dir="rtl">
                <div>
                  <p className="font-bold">حدث خطأ</p>
                  <p className="mt-2 text-sm">{fetchError}</p>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-4 text-sm font-bold text-slate-500 underline"
                  >
                    إغلاق
                  </button>
                </div>
              </div>
            ) : (
              <SaleSheetContent sale={fullSale ?? sale} onContractOpen={() => setIsContractOpen(true)} />
            )}
          </motion.div>
          <ShowroomContractWindow
            sale={fullSale ?? sale}
            isOpen={isContractOpen}
            companyName={tenant?.name}
            onClose={() => setIsContractOpen(false)}
          />
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function ShowroomContractWindow({ sale, isOpen, companyName, onClose }) {
  if (!isOpen || !sale) {
    return null;
  }

  const totalAmount = Number(sale?.total_amount ?? sale?.totalAmount ?? 0);
  const paymentsTotal = Array.isArray(sale?.payments)
    ? sale.payments.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0)
    : 0;
  const paidAmount = Number(sale?.paid_amount ?? sale?.paidAmount ?? paymentsTotal);
  const remainingAmount = Number(sale?.remaining_amount ?? Math.max(totalAmount - paidAmount, 0));
  const items = Array.isArray(sale?.items) && sale.items.length > 0
    ? sale.items
    : Array.isArray(sale?.lines)
      ? sale.lines
      : [];
  const paymentMethod = sale?.payments?.[0]?.payment_method || sale?.paymentMethod || '';

  return (
    <>
      <motion.div
        key="contract-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12, ease: 'easeOut' }}
        onClick={onClose}
        style={{ zIndex: 2147483642 }}
        className="fixed inset-0 bg-slate-950/35 backdrop-blur-sm"
      />
      <motion.div
        key="contract-window"
        initial={{ x: '100%' }}
        animate={{ x: '0%' }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.22, ease: [0.3, 1, 0.4, 1] }}
        style={{ zIndex: 2147483643 }}
        className="fixed inset-y-0 right-0 flex w-full max-w-[760px] flex-col overflow-hidden bg-slate-100 shadow-2xl"
        dir="rtl"
      >
        <style>{`
          @media print {
            @page {
              size: A4;
              margin: 0;
            }

            html,
            body {
              width: 210mm !important;
              min-height: 297mm !important;
              margin: 0 !important;
              background: white !important;
            }

            body * {
              visibility: hidden !important;
            }

            .showroom-contract-print,
            .showroom-contract-print * {
              visibility: visible !important;
            }

            .showroom-contract-print {
              position: fixed !important;
              inset: 0 !important;
              width: 210mm !important;
              min-height: auto !important;
              background: white !important;
            }

            .showroom-contract-print-shell {
              padding: 0 !important;
              overflow: visible !important;
              background: white !important;
            }

            .showroom-contract-preview-wrapper {
              max-width: none !important;
              width: 210mm !important;
              padding: 0 !important;
              background: white !important;
            }

            .showroom-contract-page {
              min-height: auto !important;
              border: 0 !important;
              box-shadow: none !important;
              break-after: avoid !important;
              page-break-after: avoid !important;
            }
          }
        `}</style>
        <div className="flex-1 overflow-y-auto bg-slate-100 px-4 py-4">
          <div className="showroom-contract-print-shell">
            <div className="showroom-contract-print">
              <ShowroomContractPreview
                companyName={companyName}
                customer={sale.customer}
                items={items}
                totalAmount={totalAmount}
                paidAmount={paidAmount}
                remainingAmount={remainingAmount}
                paymentMethod={paymentMethod}
                notes={sale.notes}
              />
            </div>
          </div>
        </div>
        <footer className="relative border-t-4 border-[#2f86cf] bg-white px-5 py-4 text-right shadow-[0_-16px_32px_-28px_rgba(15,23,42,0.75)]">
          <button
            type="button"
            onClick={() => window.print()}
            className="absolute left-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#bdd8ee] bg-[#edf5fc] text-[#2f86cf] transition hover:bg-[#dcecf8]"
            aria-label="طباعة العقد"
          >
            <Printer className="h-4 w-4" />
          </button>
          <h2 className="text-lg font-black text-slate-900">معاينة العقد</h2>
          <p className="text-xs font-bold text-slate-500">راجع بيانات العقد المرتبط بهذه الفاتورة.</p>
        </footer>
      </motion.div>
    </>
  );
}
