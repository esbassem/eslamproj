import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, Banknote, CheckCircle2, Package, Printer, Trash2, User } from 'lucide-react';
import { ShowroomContractPreview } from '@/features/showroom/components/ShowroomContractPreview';
import { useShowroomConfig } from '@/features/showroom/context/ShowroomConfigContext';
import { showroomService } from '@/features/showroom/services/showroom.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG')} EGP`;
}

function getLineConfiguredAttributes(item) {
  return Array.isArray(item?.configuredAttributes)
    ? item.configuredAttributes
      .map((attribute) => ({
        label: attribute?.label || attribute?.name || 'خاصية',
        value: attribute?.value || attribute?.valueText || attribute?.value_text || '',
      }))
      .filter((attribute) => String(attribute.value).trim())
    : [];
}

function getPaperworkGuardianshipLabel(note) {
  const guardianshipCode = String(note || '').match(/حالة الوصاية:\s*([^\n]+)/)?.[1]?.trim();
  return {
    father_guardian: 'وصاية والده',
    mother_guardian: 'وصاية والدته',
  }[guardianshipCode] || guardianshipCode || '';
}

function getPaperworkStageLabel(stageCode) {
  return {
    preparation: 'تجهيز بيانات الورق',
    owner_confirmation: 'تحديد صاحب الورق',
    sent_to_processor: 'تم الإرسال للجهة',
    processor_ready: 'الورق جاهز عند الجهة',
    received_from_processor: 'تم استلام الورق من الجهة',
    client_notified: 'تم إبلاغ العميل',
    delivered: 'تم التسليم للعميل',
    cancelled: 'ملغي',
  }[stageCode] || 'مرحلة الورق غير محددة';
}

function getItemPaperworkInfo(item) {
  const request = item?.paperworkRequest || item?.paperwork_request || null;

  if (!request) {
    return {
      exists: false,
      ownerName: 'غير محدد',
      guardianshipLabel: '',
      statusLabel: 'اضغط لتحديد طلب الورق',
    };
  }

  const ownerStatus = request.documentOwnerStatus || request.document_owner_status || '';
  const currentStage = request.currentStage || request.current_stage || '';
  const ownerName = request.documentOwnerName
    || request.document_owner_name
    || request.documentOwner?.name
    || request.document_owner?.name
    || (ownerStatus === 'later' ? 'سيتم تحديده لاحقًا' : 'غير محدد');

  return {
    exists: true,
    ownerName,
    guardianshipLabel: ownerStatus === 'later'
      ? ''
      : getPaperworkGuardianshipLabel(request.documentOwnerNote || request.document_owner_note),
    statusLabel: `مرحلة طلب الأوراق: ${getPaperworkStageLabel(currentStage)}`,
  };
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

function SaleSheetContent({
  sale,
  onContractOpen,
  onPayRemaining,
  onDelete,
  onPaperworkRequestOpen,
  canDelete,
  isPayingRemaining,
  isDeleting,
}) {
  const totalAmount = Number(sale?.total_amount ?? sale?.totalAmount ?? 0);
  const payments = Array.isArray(sale?.payments) ? sale.payments : [];
  const paymentsTotal = payments.length
    ? payments.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0)
    : 0;
  const paidAmount = payments.length ? paymentsTotal : Number(sale?.paid_amount ?? sale?.paidAmount ?? 0);
  const paymentEntries = payments.length
    ? payments
    : paidAmount > 0
      ? [{
          id: 'initial-payment',
          amount: paidAmount,
          payment_date: sale?.payment_date || sale?.created_at,
          payment_method: sale?.payment_method || sale?.paymentMethod || '',
          notes: 'دفعة أولى',
        }]
      : [];
  const remainingAmount = Number(sale?.remaining_amount ?? Math.max(totalAmount - paidAmount, 0));
  const items = Array.isArray(sale?.items) && sale.items.length > 0
    ? sale.items
    : Array.isArray(sale?.lines)
      ? sale.lines
      : [];

  return (
    <div className="h-full overflow-y-auto bg-white" dir="rtl">
      <div>
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <User className="h-5 w-5 shrink-0 text-slate-400" />
              <h2 className="truncate text-xl font-black text-slate-900">
                {sale?.customer?.name || 'عميل غير محدد'}
              </h2>
            </div>
            {sale?.customer?.phone && (
              <p className="mt-0.5 pr-7 text-sm font-bold text-slate-500">{sale.customer.phone}</p>
            )}
            <p className="mt-1 pr-7 text-xs font-bold text-slate-400">
              {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'long', timeStyle: 'short' }).format(
                new Date(sale?.created_at || Date.now()),
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {canDelete ? (
              <button
                type="button"
                onClick={onDelete}
                disabled={isDeleting}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-100 transition hover:bg-red-100 hover:text-red-700 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="حذف الفاتورة"
                title="حذف الفاتورة"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onContractOpen}
              disabled={isDeleting}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-50 text-slate-500 ring-1 ring-slate-200 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-100"
              aria-label="عرض العقد"
            >
              <Printer className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div>
          {items.length > 0 && (
            <section className="border-b border-slate-200">
              <div className="flex items-center justify-between gap-3 bg-slate-50 px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white">
                    <Package className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">الإجمالي</h3>
                    <p className="mt-0.5 text-[0.7rem] font-semibold text-slate-400">بنود الفاتورة</p>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-lg font-black text-slate-950">{formatMoney(totalAmount)}</span>
              </div>
              <div className="px-5 pb-4">
                <div className="mr-10 divide-y divide-slate-100 border-y border-slate-100">
                  {items.map((item, index) => {
                    const itemName = item?.displayName || item?.name || item?.description || `منتج ${index + 1}`;
                    const itemPrice = Number(item?.price ?? item?.unit_price ?? 0);
                    const itemQty = Number(item?.quantity ?? 1);
                    const itemTotal = Number(item?.total ?? item?.line_total ?? itemPrice * itemQty);
                    const configuredAttributes = getLineConfiguredAttributes(item);
                    const paperworkInfo = getItemPaperworkInfo(item);

                    return (
                      <div key={item?.lineId || item?.lineUuid || item?.id || index} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-slate-700">{itemName}</p>
                          {itemQty > 1 && (
                            <p className="mt-0.5 text-[0.7rem] text-slate-400">
                              {itemQty} × {formatMoney(itemPrice)}
                            </p>
                          )}
                          {item?.serialNumber && !(Array.isArray(item?.trackingIdentifiers) && item.trackingIdentifiers.length) && (
                            <p className="mt-0.5 text-[0.7rem] text-slate-400">رقم تسلسلي: {item.serialNumber}</p>
                          )}
                          {Array.isArray(item?.trackingIdentifiers) && item.trackingIdentifiers.length ? (
                            <p className="mt-0.5 truncate text-[0.7rem] text-slate-400">
                              {item.trackingIdentifiers.map((identifier) => `${identifier.label}: ${identifier.value}`).join(' - ')}
                            </p>
                          ) : null}
                          {configuredAttributes.length ? (
                            <p className="mt-0.5 truncate text-[0.7rem] text-slate-400">
                              {configuredAttributes.map((attribute) => `${attribute.label}: ${attribute.value}`).join(' - ')}
                            </p>
                          ) : null}
                          {paperworkInfo.exists ? (
                            <div className="mt-2 rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-[0.68rem] text-blue-950">
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                                <span className="font-bold text-slate-500">باسم</span>
                                <span className="font-black">{paperworkInfo.ownerName}</span>
                                {paperworkInfo.guardianshipLabel ? (
                                  <span className="font-bold text-blue-700">· {paperworkInfo.guardianshipLabel}</span>
                                ) : null}
                              </div>
                              <p className="mt-0.5 font-bold opacity-75">{paperworkInfo.statusLabel}</p>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onPaperworkRequestOpen?.(sale)}
                              className="mt-2 w-full rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-right text-[0.68rem] font-black text-red-700 transition hover:bg-red-100 focus:outline-none focus:ring-4 focus:ring-red-100"
                            >
                              طلب الورق غير محدد — اضغط لتحديده
                            </button>
                          )}
                        </div>
                        <p className="shrink-0 font-mono text-[0.72rem] font-bold text-slate-500">{formatMoney(itemTotal)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          )}

          {paidAmount > 0 && (
            <section className="border-b border-slate-200">
              <div className="flex items-center justify-between gap-3 bg-emerald-50/75 px-5 py-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white">
                    <Banknote className="h-4 w-4" />
                  </span>
                  <div>
                    <h3 className="text-sm font-black text-slate-900">المدفوع</h3>
                    <p className="mt-0.5 text-[0.7rem] font-semibold text-slate-400">سجل التحصيل</p>
                  </div>
                </div>
                <span className="shrink-0 font-mono text-lg font-black text-emerald-600">{formatMoney(paidAmount)}</span>
              </div>
              {paymentEntries.length ? (
                <div className="px-5 pb-4">
                  <div className="mr-10 divide-y divide-slate-100 border-y border-slate-100">
                  {paymentEntries.map((payment, index) => {
                    const paymentDate = payment?.payment_date || payment?.created_at;
                    const paymentMethod = payment?.payment_method || payment?.paymentMethod || '';
                    const statement = payment?.notes || `دفعة ${index + 1}`;

                    return (
                      <div key={payment?.id || index} className="flex items-start justify-between gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-slate-700">{statement}</p>
                          <p className="mt-0.5 truncate text-[0.7rem] text-slate-400">
                            {[
                              paymentMethod || 'طريقة دفع غير محددة',
                              paymentDate ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(paymentDate)) : '',
                            ].filter(Boolean).join(' - ')}
                          </p>
                        </div>
                        <span className="shrink-0 font-mono text-[0.72rem] font-bold text-slate-500">{formatMoney(payment?.amount)}</span>
                      </div>
                    );
                  })}
                  </div>
                </div>
              ) : null}
            </section>
          )}

          <div className={`flex items-center justify-between gap-3 px-5 py-4 ${
            remainingAmount > 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          }`}>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                remainingAmount > 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
              }`}>
                {remainingAmount > 0 ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-black">{remainingAmount > 0 ? 'على الفاتورة متبقي' : 'مدفوعة بالكامل'}</p>
                <p className="mt-0.5 text-[0.7rem] font-bold opacity-70">
                  {remainingAmount > 0 ? 'يمكن تسجيل دفع المتبقي الآن' : 'لا توجد مبالغ مستحقة على هذه الفاتورة'}
                </p>
              </div>
            </div>
            {remainingAmount > 0 ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="font-mono text-sm font-black">{formatMoney(remainingAmount)}</span>
                <button
                  type="button"
                  onClick={onPayRemaining}
                  disabled={isPayingRemaining}
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                >
                  {isPayingRemaining ? 'جار التسجيل...' : 'تسجيل دفعة'}
                </button>
              </div>
            ) : (
              <span className="shrink-0 rounded-full bg-white/80 px-3 py-1 text-xs font-black text-emerald-700 ring-1 ring-emerald-100">
                مكتملة
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentRegistrationStep({ sale, onBack, onSubmit, isSubmitting, submitError }) {
  const payments = Array.isArray(sale?.payments) ? sale.payments : [];
  const paymentsTotal = payments.length
    ? payments.reduce((sum, payment) => sum + Number(payment?.amount || 0), 0)
    : 0;
  const totalAmount = Number(sale?.total_amount ?? sale?.totalAmount ?? 0);
  const paidAmount = payments.length ? paymentsTotal : Number(sale?.paid_amount ?? sale?.paidAmount ?? 0);
  const remainingAmount = Math.max(Number(sale?.remaining_amount ?? totalAmount - paidAmount), 0);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    setAmount('');
    setNotes('');
    setFormError('');
  }, [remainingAmount, sale?.id]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    const paymentAmount = Number(amount);

    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      setFormError('اكتب مبلغ صحيح للدفعة.');
      return;
    }

    if (paymentAmount > remainingAmount) {
      setFormError('مبلغ الدفعة أكبر من المتبقي على الفاتورة.');
      return;
    }

    setFormError('');
    const result = await onSubmit({ amount: paymentAmount, notes });

    if (result?.error) {
      setFormError(result.error);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-4" dir="rtl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600 ring-1 ring-red-100">
                <Banknote className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="truncate text-xl font-black text-slate-900">تسجيل دفعة</h2>
                <p className="mt-0.5 text-xs font-bold text-slate-400">
                  {sale?.customer?.name || 'عميل غير محدد'}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onBack}
            disabled={isSubmitting}
            className="shrink-0 rounded-lg bg-white px-3 py-2 text-xs font-black text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            رجوع
          </button>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <p className="text-xs font-black text-slate-500">المتبقي على الفاتورة</p>
            </div>
            <span className="shrink-0 font-mono text-lg font-black text-red-600">{formatMoney(remainingAmount)}</span>
          </div>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-black text-slate-600">مبلغ الدفعة</span>
              <input
                type="number"
                min="0"
                max={remainingAmount}
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                disabled={isSubmitting}
                className="h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-right font-mono text-sm font-black text-slate-900 outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                inputMode="decimal"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-black text-slate-600">البيان</span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                disabled={isSubmitting}
                rows={3}
                placeholder="مثال: دفعة نقدية أو تحويل بنكي"
                className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-sm font-bold text-slate-700 outline-none transition placeholder:text-slate-300 focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </label>

          </div>

          {(formError || submitError) && (
            <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600">
              {formError || submitError}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting || remainingAmount <= 0}
          className="h-11 w-full rounded-xl bg-red-600 text-sm font-black text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
        >
          {isSubmitting ? 'جار تسجيل الدفعة...' : 'تسجيل الدفعة'}
        </button>
      </form>
    </div>
  );
}

export function ShowroomSaleViewSheet({ sale, isOpen, onClose, onDeleted, onPaperworkRequestOpen }) {
  const { tenant, tenantUser } = useWorkspace();
  const { currentShowroomConfigId } = useShowroomConfig();
  const canDeleteSale = tenantUser?.role === 'owner';
  const [fullSale, setFullSale] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [isContractOpen, setIsContractOpen] = useState(false);
  const [isPayingRemaining, setIsPayingRemaining] = useState(false);
  const [isDeletingSale, setIsDeletingSale] = useState(false);
  const [sheetMode, setSheetMode] = useState('details');

  const fetchDetails = useCallback(async () => {
    if (!sale?.id) return;

    const hasLineDetails =
      (Array.isArray(sale.items) && sale.items.length > 0) ||
      (Array.isArray(sale.lines) && sale.lines.length > 0);
    const hasPaymentDetails = Array.isArray(sale.payments);

    if (hasLineDetails && hasPaymentDetails) {
      setFullSale(sale);
      return;
    }

    if (!tenant?.id || !currentShowroomConfigId) {
      setFullSale(sale);
      return;
    }

    setIsLoading(true);
    setFetchError('');
    try {
      const data = await showroomService.getSaleDetails({
        tenantId: tenant.id,
        saleId: sale.id,
        showroomConfigId: currentShowroomConfigId,
      });
      setFullSale(data);
    } catch (err) {
      setFetchError(err.message || 'تعذر تحميل تفاصيل العملية');
      setFullSale(sale);
    } finally {
      setIsLoading(false);
    }
  }, [currentShowroomConfigId, sale, tenant?.id]);

  useEffect(() => {
    if (isOpen) {
      fetchDetails();
    } else {
      setFullSale(null);
      setFetchError('');
      setIsContractOpen(false);
      setIsPayingRemaining(false);
      setIsDeletingSale(false);
      setSheetMode('details');
    }
  }, [isOpen, fetchDetails]);

  const handleOpenPaymentStep = useCallback(() => {
    setFetchError('');
    setSheetMode('payment');
  }, []);

  const handleSubmitPayment = useCallback(async ({ amount, notes }) => {
    const targetSale = fullSale ?? sale;

    if (!tenant?.id || !currentShowroomConfigId || !targetSale?.id || isPayingRemaining) {
      return { error: 'تعذر تحديد بيانات الفاتورة.' };
    }

    setIsPayingRemaining(true);
    setFetchError('');

    try {
      const updatedSale = await showroomService.paySaleRemaining({
        tenantId: tenant.id,
        saleId: targetSale.id,
        showroomConfigId: currentShowroomConfigId,
        amount,
        notes,
      });
      setFullSale(updatedSale);
      setSheetMode('details');
      return { ok: true };
    } catch (err) {
      const message = err.message || 'تعذر تسجيل الدفعة';
      setFetchError(message);
      return { error: message };
    } finally {
      setIsPayingRemaining(false);
    }
  }, [currentShowroomConfigId, fullSale, isPayingRemaining, sale, tenant?.id]);

  const handleDeleteSale = useCallback(async () => {
    const targetSale = fullSale ?? sale;

    if (!tenant?.id || !currentShowroomConfigId || !targetSale?.id || isDeletingSale) {
      return;
    }

    if (!canDeleteSale) {
      setFetchError('حذف الفاتورة متاح فقط لمالك الشركة.');
      return;
    }

    const confirmed = window.confirm('سيتم حذف الفاتورة وكل السطور والدفعات وآثار المخزون المرتبطة بها. هل أنت متأكد؟');
    if (!confirmed) return;

    setIsDeletingSale(true);
    setFetchError('');

    try {
      await showroomService.deleteSale({
        tenantId: tenant.id,
        saleId: targetSale.id,
        showroomConfigId: currentShowroomConfigId,
      });
      onDeleted?.(targetSale.id);
      onClose?.();
    } catch (err) {
      setFetchError(err.message || 'تعذر حذف الفاتورة.');
    } finally {
      setIsDeletingSale(false);
    }
  }, [canDeleteSale, currentShowroomConfigId, fullSale, isDeletingSale, onClose, onDeleted, sale, tenant?.id]);

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
            ) : sheetMode === 'payment' ? (
              <PaymentRegistrationStep
                sale={fullSale ?? sale}
                onBack={() => {
                  setFetchError('');
                  setSheetMode('details');
                }}
                onSubmit={handleSubmitPayment}
                isSubmitting={isPayingRemaining}
                submitError={fetchError}
              />
            ) : (
              <SaleSheetContent
                sale={fullSale ?? sale}
                onContractOpen={() => setIsContractOpen(true)}
                onPayRemaining={handleOpenPaymentStep}
                onDelete={handleDeleteSale}
                onPaperworkRequestOpen={onPaperworkRequestOpen}
                canDelete={canDeleteSale}
                isPayingRemaining={isPayingRemaining}
                isDeleting={isDeletingSale}
              />
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
        className="fixed inset-y-0 right-0 flex w-full max-w-[760px] flex-col overflow-hidden bg-slate-200 shadow-2xl"
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
        <div className="flex-1 overflow-y-auto bg-slate-200 px-3 py-5 pb-8 shadow-inner sm:px-5">
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
        <footer className="relative z-10 border-t-4 border-[#2f86cf] bg-white/95 px-5 py-4 text-right shadow-[0_-18px_38px_-24px_rgba(15,23,42,0.85)] backdrop-blur">
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
