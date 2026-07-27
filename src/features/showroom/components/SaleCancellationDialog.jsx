import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  FileText,
  LoaderCircle,
  PackageCheck,
  RotateCcw,
  X,
} from 'lucide-react';
import { saleCancellationService } from '@/features/showroom/services/saleCancellation.service';

const MAX_REASON_LENGTH = 500;

const BLOCKER_MESSAGES = {
  paperwork_beyond_preparation: 'لا يمكن إلغاء الفاتورة لأن طلب الأوراق تجاوز مرحلة الإعداد.',
  paperwork_rule_not_satisfied: 'لا يمكن إلغاء الفاتورة لأن طلب الأوراق تجاوز مرحلة الإعداد.',
  account_settlement_present: 'الفاتورة تحتوي على تسوية محاسبية تحتاج مراجعة قبل الإلغاء.',
  legacy_settlement_present: 'الفاتورة تحتوي على تحصيل قديم يحتاج مراجعة يدوية قبل الإلغاء.',
  original_move_missing: 'لا يمكن العثور على القيد المحاسبي الأصلي للفاتورة.',
  original_move_invalid: 'لا يمكن العثور على القيد المحاسبي الأصلي للفاتورة.',
  existing_reversal: 'تم عكس القيد المحاسبي لهذه الفاتورة بالفعل.',
  reversal_already_exists: 'تم عكس القيد المحاسبي لهذه الفاتورة بالفعل.',
  cancellation_already_completed: 'هذه الفاتورة ملغاة بالفعل.',
  cancellation_already_pending: 'يوجد طلب إلغاء قيد التنفيذ لهذه الفاتورة.',
  inventory_not_interpretable: 'بيانات المخزون تحتاج مراجعة قبل الإلغاء.',
  inventory_links_not_interpretable: 'بيانات المخزون تحتاج مراجعة قبل الإلغاء.',
  allocations_not_fully_classified: 'دفعات الفاتورة تحتاج مراجعة محاسبية قبل الإلغاء.',
  allocation_requires_manual_review: 'إحدى دفعات الفاتورة تحتاج مراجعة يدوية قبل الإلغاء.',
  original_move_reference_mismatch: 'القيد المحاسبي المرتبط بالفاتورة يحتاج مراجعة.',
};

const PAPERWORK_STAGES = {
  preparation: 'مرحلة الإعداد',
  owner_confirmation: 'تحديد صاحب الأوراق',
  sent_to_processor: 'تم الإرسال إلى الجهة',
  processor_ready: 'الأوراق جاهزة لدى الجهة',
  received_from_processor: 'تم استلام الأوراق من الجهة',
  client_notified: 'تم إبلاغ العميل',
  delivered: 'تم التسليم للعميل',
  cancelled: 'ملغي',
};

function money(value) {
  return `${Number(value || 0).toLocaleString('ar-EG')} ج.م`;
}

function diagnosticRecords(preview) {
  const records = [
    ...(preview?.blockers || []),
    ...(preview?.invariants?.failures || []),
  ];
  const codes = new Set(records.map((record) => record?.code));
  const hasAllocation = records.some((record) => (
    record?.code === 'allocation_requires_manual_review' && record?.details
  ));

  return records.filter((record, index) => {
    if (record?.code === 'account_settlement_present' && hasAllocation) return false;
    if (record?.code === 'legacy_settlement_present' && hasAllocation) return false;
    if (record?.code === 'paperwork_rule_not_satisfied' && codes.has('paperwork_beyond_preparation')) return false;
    if (record?.code === 'inventory_links_not_interpretable' && codes.has('inventory_not_interpretable')) return false;
    if (record?.code === 'allocations_not_fully_classified' && codes.has('allocation_requires_manual_review')) return false;
    if (record?.code === 'original_move_already_reversed' && codes.has('existing_reversal')) return false;
    return records.findIndex((candidate) => (
      candidate?.code === record?.code
      && JSON.stringify(candidate?.details || null) === JSON.stringify(record?.details || null)
    )) === index;
  });
}

function displayDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(date);
}

function InfoRow({ label, value, emphasize = false }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs font-bold text-slate-500">{label}</span>
      <span className={`text-left text-sm font-black ${emphasize ? 'text-red-700' : 'text-slate-900'}`}>{value}</span>
    </div>
  );
}

function DiagnosticCard({ record, number, total }) {
  const details = record?.details || {};
  const code = record?.code;
  const isAllocation = code === 'allocation_requires_manual_review';
  const isTemp = isAllocation && details.classification === 'account_settlement';
  const isLegacy119001 = isAllocation && details.legacy_kind === 'legacy_collection_119001';
  const isLegacy212001 = isAllocation && details.legacy_kind === 'legacy_advance_212001';
  const isPaperwork = code === 'paperwork_beyond_preparation';
  const isInventory = code === 'inventory_not_interpretable';
  const isReversal = ['existing_reversal', 'original_move_already_reversed'].includes(code);
  const isOriginalMove = code?.startsWith('original_move_')
    || code?.startsWith('invoice_receivable_')
    || code === 'receivable_account_not_unique'
    || code === 'invoice_total_mismatch';

  let title = BLOCKER_MESSAGES[code] || 'هذه الفاتورة تحتاج مراجعة قبل الإلغاء.';
  if (isTemp) title = 'توجد تسوية محاسبية تحتاج مراجعة';
  if (isLegacy119001) title = 'يوجد تحصيل قديم يحتاج مراجعة';
  if (isLegacy212001) title = 'توجد دفعة مقدمة بالنظام القديم تحتاج مراجعة';
  if (isPaperwork) title = 'طلب الأوراق يمنع إلغاء الفاتورة';
  if (isInventory) title = 'توجد مشكلة في حالة المخزون';
  if (isReversal) title = 'تم عكس القيد المحاسبي لهذه الفاتورة بالفعل';
  if (isOriginalMove && !isReversal) {
    title = BLOCKER_MESSAGES[code] || 'توجد مشكلة في القيد المحاسبي الأصلي للفاتورة';
  }

  return (
    <article className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-black text-amber-800">
          {total > 1 ? number : '!'}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="font-black text-slate-950">{title}</h4>

          {isAllocation ? (
            <div className="mt-3 rounded-xl bg-slate-50 px-3">
              <InfoRow
                label="الحساب"
                value={[details.account_code, details.account_name].filter(Boolean).join(' — ')}
              />
              <InfoRow label="المبلغ" value={money(details.amount)} />
              {isLegacy119001 || isLegacy212001 ? (
                <InfoRow label="وسيلة التحصيل المسجلة" value={details.pay_method} />
              ) : null}
              <InfoRow label="تاريخ العملية" value={displayDate(details.source_move_date)} />
              <InfoRow label="الوصف" value={details.description} />
            </div>
          ) : null}

          {isPaperwork ? (
            <div className="mt-3 rounded-xl bg-slate-50 px-3">
              <InfoRow label="المرحلة الحالية" value={details.current_stage_display} />
              <InfoRow label="حالة الطلب" value={details.request_status} />
              <InfoRow label="تاريخ الطلب" value={displayDate(details.request_date)} />
            </div>
          ) : null}

          {isInventory ? (
            <div className="mt-3 rounded-xl bg-slate-50 px-3">
              <InfoRow label="المنتج" value={details.product_name} />
              <InfoRow label="رقم التتبع" value={details.tracking_identifier} />
              <InfoRow label="الحالة الحالية" value={details.current_tracking_status} />
              <InfoRow label="الحالة المتوقعة قبل الإلغاء" value={details.expected_tracking_status} />
              <InfoRow label="السبب" value={details.reason} />
            </div>
          ) : null}

          {isOriginalMove && !isCacheDrift && !isReversal ? (
            <div className="mt-3 rounded-xl bg-slate-50 px-3">
              <InfoRow label="اسم القيد" value={details.move_name} />
              <InfoRow label="مرجع القيد" value={details.move_reference} />
              <InfoRow label="حالة القيد" value={details.move_state} />
              <InfoRow label="عدد سطور الذمم" value={details.receivable_line_count} />
              <InfoRow label="قيمة الفاتورة" value={details.invoice_total !== undefined ? money(details.invoice_total) : ''} />
              <InfoRow label="قيمة الذمم محاسبيًا" value={details.accounting_receivable_amount !== undefined ? money(details.accounting_receivable_amount) : ''} />
            </div>
          ) : null}

          {isReversal ? (
            <div className="mt-3 rounded-xl bg-slate-50 px-3">
              <InfoRow label="اسم القيد العكسي" value={details.move_name} />
              <InfoRow label="تاريخ القيد العكسي" value={displayDate(details.move_date)} />
            </div>
          ) : null}

          <p className="mt-3 text-xs font-bold leading-6 text-amber-900">
            {isCacheDrift
              ? 'يجب مراجعة هذا الاختلاف قبل إلغاء الفاتورة.'
              : isTemp
                ? 'يجب مراجعة هذه التسوية قبل إلغاء الفاتورة.'
                : isLegacy119001 || isLegacy212001
                  ? 'لا يمكن إلغاء الفاتورة تلقائيًا قبل مراجعة هذا التحصيل.'
                  : BLOCKER_MESSAGES[code] || 'هذه الفاتورة تحتاج مراجعة قبل الإلغاء.'}
          </p>
        </div>
      </div>
    </article>
  );
}

function isStalePreviewError(error) {
  return String(error?.message || '').includes('بيانات الفاتورة تغيرت');
}

function userErrorMessage(error) {
  const message = String(error?.message || '');
  if (message.includes('مالك الشركة فقط')) return 'إلغاء الفاتورة متاح لمالك الشركة فقط.';
  if (message.includes('سبب الإلغاء')) return 'اكتب سبب الإلغاء أولًا.';
  if (message.includes('موانع تمنع الإلغاء')) return 'تغيرت حالة الفاتورة وأصبحت تحتاج مراجعة قبل الإلغاء.';
  return 'تعذر إلغاء الفاتورة. أعد المحاولة أو راجع بياناتها.';
}

function SummaryLine({ icon: Icon, children }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-bold text-emerald-950">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <span>{children}</span>
    </div>
  );
}

export function SaleCancellationDialog({
  open,
  onOpenChange,
  tenantId,
  sale,
  onSuccess,
}) {
  const [preview, setPreview] = useState(null);
  const [reason, setReason] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const submitLockRef = useRef(false);

  const loadPreview = useCallback(async ({ stale = false } = {}) => {
    if (!open || !tenantId || !sale?.id) return;
    setIsLoading(true);
    setError('');
    if (!stale) setNotice('');
    try {
      const data = await saleCancellationService.previewSaleCancellation({
        tenantId,
        saleId: sale.id,
      });
      setPreview(data);
      if (stale) {
        setNotice('تم تغيير بيانات الفاتورة منذ فتح نافذة الإلغاء. تمت إعادة فحصها.');
      }
    } catch (loadError) {
      console.error('Sale cancellation preview failed', loadError);
      setPreview(null);
      setError('تعذر فحص إمكانية إلغاء الفاتورة الآن.');
    } finally {
      setIsLoading(false);
    }
  }, [open, sale?.id, tenantId]);

  useEffect(() => {
    if (open) {
      setReason('');
      setPreview(null);
      submitLockRef.current = false;
      loadPreview();
    } else {
      setError('');
      setNotice('');
      setIsSubmitting(false);
    }
  }, [loadPreview, open]);

  const handleSubmit = async () => {
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setError('سبب الإلغاء إلزامي.');
      return;
    }
    if (!preview?.can_cancel_now || !preview?.preview_version || submitLockRef.current) return;

    submitLockRef.current = true;
    setIsSubmitting(true);
    setError('');
    setNotice('');
    try {
      const result = await saleCancellationService.cancelSale({
        tenantId,
        saleId: sale.id,
        reason: normalizedReason,
        previewVersion: preview.preview_version,
      });
      setNotice(result.idempotent ? 'الفاتورة ملغاة بالفعل.' : 'تم إلغاء الفاتورة بنجاح.');
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      await onSuccess?.(result);
      onOpenChange?.(false);
    } catch (submitError) {
      console.error('Sale cancellation failed', submitError);
      if (isStalePreviewError(submitError)) {
        submitLockRef.current = false;
        setIsSubmitting(false);
        await loadPreview({ stale: true });
        return;
      }
      setError(userErrorMessage(submitError));
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  if (!open || typeof document === 'undefined') return null;

  const diagnostics = diagnosticRecords(preview);
  const cashTotal = Number(preview?.payments?.cash_total || 0)
    + Number(preview?.payments?.employee_custody_cash_total || 0);
  const openCredits = preview?.open_credits?.items || [];
  const inventoryItems = (preview?.inventory?.items || []).filter((item) => (
    ['return_tracking_unit_to_stock', 'restore_stock_quantity'].includes(item?.action_if_cancelled)
  ));
  const paperwork = preview?.paperwork?.requests || [];

  return createPortal(
    <div className="fixed inset-0 z-[2147483646] flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4" dir="rtl">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sale-cancellation-title"
        className="flex max-h-[94vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:max-h-[88vh] sm:rounded-3xl"
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 id="sale-cancellation-title" className="text-lg font-black text-slate-950">إلغاء الفاتورة</h2>
            <p className="mt-0.5 text-xs font-bold text-slate-500">راجع الأثر قبل التأكيد</p>
          </div>
          <button
            type="button"
            onClick={() => !isSubmitting && onOpenChange?.(false)}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="overflow-y-auto px-5 py-4">
          {isLoading ? (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-slate-500">
              <LoaderCircle className="h-8 w-8 animate-spin text-blue-600" />
              <p className="text-sm font-bold">جاري فحص الفاتورة...</p>
            </div>
          ) : error && !preview ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">
              {error}
              <button type="button" onClick={() => loadPreview()} className="mt-3 block underline">إعادة المحاولة</button>
            </div>
          ) : preview ? (
            <div className="space-y-4">
              {notice ? (
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm font-bold text-blue-800">
                  {notice}
                </div>
              ) : null}

              <section className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs font-bold text-slate-500">قيمة الفاتورة</p>
                <p className="mt-1 text-2xl font-black text-slate-950">{money(preview?.sale?.total_amount)}</p>
              </section>

              {preview.can_cancel_now ? (
                <section className="space-y-2">
                  <h3 className="text-sm font-black text-slate-950">ما الذي سيحدث؟</h3>
                  <SummaryLine icon={RotateCcw}>سيتم إلغاء أثر البيع محاسبيًا.</SummaryLine>
                  {cashTotal > 0 ? (
                    <SummaryLine icon={Banknote}>
                      مبلغ {money(cashTotal)} المدفوع سيبقى رصيدًا للعميل، ولن يُرد نقدًا تلقائيًا.
                    </SummaryLine>
                  ) : null}
                  {openCredits.map((credit) => (
                    <SummaryLine key={credit.open_credit_line_id} icon={CheckCircle2}>
                      سيعود {money(credit.released_from_this_invoice)} إلى رصيد اعتماد {credit.source_entity_name || 'جهة الدفع'} المتاح.
                    </SummaryLine>
                  ))}
                  {inventoryItems.length ? (
                    <SummaryLine icon={PackageCheck}>سيتم إرجاع المنتج أو الوحدة إلى المخزون.</SummaryLine>
                  ) : null}
                  {paperwork.some((request) => request.current_stage === 'preparation') ? (
                    <SummaryLine icon={FileText}>طلب الأوراق ما زال في الإعداد وسيتم إلغاؤه مع الفاتورة.</SummaryLine>
                  ) : null}
                </section>
              ) : (
                <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-amber-900">
                    <AlertTriangle className="h-5 w-5" />
                    <h3 className="font-black">لا يمكن إلغاء هذه الفاتورة حاليًا.</h3>
                  </div>
                  <p className="mt-2 text-sm font-bold text-amber-800">
                    {diagnostics.length > 1
                      ? `يوجد ${diagnostics.length.toLocaleString('ar-EG')} أسباب تحتاج إلى مراجعة:`
                      : 'يوجد سبب يحتاج إلى مراجعة:'}
                  </p>
                  <div className="mt-3 space-y-3">
                    {diagnostics.map((record, index) => (
                      <DiagnosticCard
                        key={`${record.code}-${index}`}
                        record={record}
                        number={index + 1}
                        total={diagnostics.length}
                      />
                    ))}
                  </div>
                </section>
              )}

              {paperwork.some((request) => request.current_stage !== 'preparation') ? (
                <section className="rounded-2xl border border-slate-200 p-4 text-sm">
                  <h3 className="font-black text-slate-950">حالة الأوراق</h3>
                  {paperwork.map((request) => (
                    <p key={request.request_id} className="mt-2 font-bold text-slate-600">
                      المرحلة الحالية: {PAPERWORK_STAGES[request.current_stage] || 'مرحلة غير معروفة'}.
                    </p>
                  ))}
                </section>
              ) : null}

              {preview.can_cancel_now ? (
                <label className="block">
                  <span className="text-sm font-black text-slate-900">سبب الإلغاء *</span>
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value.slice(0, MAX_REASON_LENGTH))}
                    rows={4}
                    disabled={isSubmitting}
                    placeholder="اكتب سبب إلغاء الفاتورة"
                    className="mt-2 w-full resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                  />
                  <span className="mt-1 block text-left text-[0.7rem] font-bold text-slate-400">{reason.length}/{MAX_REASON_LENGTH}</span>
                </label>
              ) : null}

              {error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p> : null}
            </div>
          ) : null}
        </div>

        <footer className="flex gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4">
          <button
            type="button"
            onClick={() => onOpenChange?.(false)}
            disabled={isSubmitting}
            className="h-11 flex-1 rounded-xl border border-slate-300 bg-white text-sm font-black text-slate-700 disabled:opacity-50"
          >
            رجوع
          </button>
          {preview?.can_cancel_now ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !reason.trim()}
              className="flex h-11 flex-[1.5] items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-black text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
            >
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting ? 'جاري الإلغاء...' : 'تأكيد إلغاء الفاتورة'}
            </button>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
