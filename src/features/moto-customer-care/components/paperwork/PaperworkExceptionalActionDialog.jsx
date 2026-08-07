import { AlertTriangle, X } from 'lucide-react';
import { PAPERWORK_EXCEPTIONAL_ACTION_IDS } from '@/features/moto-customer-care/config/paperworkExceptionalActions';

const PREVIOUS_DELIVERY_REASONS = [
  { value: 'delivered_before_system_use', label: 'تم التسليم قبل استخدام نظام المتابعة' },
  { value: 'delivery_not_recorded', label: 'تم التسليم ولم يُسجل وقتها' },
  { value: 'owner_confirmed_previous_delivery', label: 'تم التأكد من المالك أن التسليم حدث سابقًا' },
  { value: 'other', label: 'سبب آخر' },
];

const CANCELLATION_REASONS = [
  { value: 'customer_request', label: 'بناءً على طلب العميل' },
  { value: 'request_created_by_mistake', label: 'تم إنشاء الطلب بالخطأ' },
  { value: 'duplicate_request', label: 'طلب مكرر' },
  { value: 'sale_cancelled', label: 'تم إلغاء عملية البيع' },
  { value: 'other', label: 'سبب آخر' },
];

export function PaperworkExceptionalActionDialog({
  action,
  request,
  requests = [],
  reason,
  notes,
  confirmationChecked = false,
  error,
  isSubmitting,
  onReasonChange,
  onNotesChange,
  onConfirmationChange,
  onClose,
  onConfirm,
}) {
  if (!action || ![
    PAPERWORK_EXCEPTIONAL_ACTION_IDS.PREVIOUS_CUSTOMER_DELIVERY,
    PAPERWORK_EXCEPTIONAL_ACTION_IDS.CANCEL,
  ].includes(action.id)) return null;

  const isCancellation = action.id === PAPERWORK_EXCEPTIONAL_ACTION_IDS.CANCEL;
  const requiresNotes = reason === 'other';
  const canSubmit = Boolean(
    reason
    && (!requiresNotes || notes.trim())
    && (!isCancellation || confirmationChecked),
  ) && !isSubmitting;
  const affectedRequests = requests.length ? requests : request ? [request] : [];
  const isBulk = affectedRequests.length > 1;

  return (
    <div className="fixed inset-0 z-[160] flex items-center justify-center bg-slate-950/40 p-4" dir="rtl">
      <button type="button" className="absolute inset-0" disabled={isSubmitting} onClick={onClose} aria-label="إغلاق نافذة الإجراء الاستثنائي" />
      <section className="relative max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="previous-delivery-title">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`text-[10px] font-black ${isCancellation ? 'text-red-600' : 'text-amber-600'}`}>إجراء استثنائي</p>
            <h3 id="previous-delivery-title" className="mt-1 text-base font-black text-slate-950">
              {isCancellation ? 'إلغاء طلب الأوراق' : 'تسجيل استلام العميل للأوراق سابقًا'}
            </h3>
            <p className="mt-1 text-xs font-bold text-slate-500">
              {isBulk ? `${affectedRequests.length} طلبات محددة` : `${request?.customer?.name || 'عميل غير محدد'} · ${request?.productName || 'منتج غير محدد'}`}
            </p>
          </div>
          <button type="button" disabled={isSubmitting} onClick={onClose} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 disabled:opacity-50" aria-label="إغلاق">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className={`mt-4 flex gap-2 rounded-xl px-3 py-2.5 text-[11px] font-bold leading-5 ${isCancellation ? 'border border-red-200 bg-red-50 text-red-900' : 'border border-amber-200 bg-amber-50 text-amber-900'}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{isCancellation
            ? 'لا يمكن التراجع عن الإلغاء. يجب أن تكون الأوراق لم تُنجز لدى جهة الإصدار ولم يتم استلامها منها.'
            : 'سيُغلق الطلب باعتبار الأوراق سُلّمت للعميل. وإذا كان له مستند داخل العهدة فسيُسجل خروجه في نفس العملية.'}</p>
        </div>

        {isBulk ? (
          <div className="mt-3 max-h-32 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            {affectedRequests.map((item) => (
              <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-200 py-1.5 text-[10px] font-bold last:border-b-0">
                <span className="truncate text-slate-800">{item.productName || 'منتج غير محدد'}</span>
                <span className="shrink-0 text-slate-500">{item.customer?.name || 'عميل غير محدد'}</span>
              </div>
            ))}
          </div>
        ) : null}

        <form className="mt-4 space-y-4" onSubmit={(event) => { event.preventDefault(); if (canSubmit) onConfirm(); }}>
          <label className="block">
            <span className="text-xs font-black text-slate-700">{isCancellation ? 'سبب الإلغاء' : 'سبب التسجيل المتأخر'}</span>
            <select required value={reason} disabled={isSubmitting} onChange={(event) => onReasonChange(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60">
              <option value="">اختر السبب</option>
              {(isCancellation ? CANCELLATION_REASONS : PREVIOUS_DELIVERY_REASONS).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          {isCancellation ? (
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-xs font-black leading-5 text-red-900">
              <input
                type="checkbox"
                checked={confirmationChecked}
                disabled={isSubmitting}
                onChange={(event) => onConfirmationChange?.(event.target.checked)}
                className="mt-1 h-4 w-4 shrink-0 accent-red-700"
              />
              <span>أؤكد أن جهة الإصدار لم تُنجز الأوراق بعد، وأن الطلب ما زال يمكن إلغاؤه لديها.</span>
            </label>
          ) : null}

          <label className="block">
            <span className="text-xs font-black text-slate-700">ملاحظات {requiresNotes ? '(إلزامية)' : '(اختيارية)'}</span>
            <textarea rows={3} required={requiresNotes} value={notes} disabled={isSubmitting} onChange={(event) => onNotesChange(event.target.value)} placeholder="اكتب أي تفاصيل تساعد في مراجعة هذا الإجراء لاحقًا" className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-bold leading-5 text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:opacity-60" />
          </label>

          {error ? <p className="rounded-xl bg-red-50 px-3 py-2.5 text-xs font-bold leading-5 text-red-700">{error}</p> : null}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" disabled={isSubmitting} onClick={onClose} className="h-10 rounded-xl bg-slate-100 text-xs font-black text-slate-700 disabled:opacity-50">إلغاء</button>
            <button type="submit" disabled={!canSubmit} className={`h-10 rounded-xl text-xs font-black text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${isCancellation ? 'bg-red-700 hover:bg-red-800' : 'bg-amber-600 hover:bg-amber-700'}`}>
              {isSubmitting ? (isCancellation ? 'جاري الإلغاء...' : 'جاري التسجيل...') : (isCancellation ? 'تأكيد إلغاء الطلب' : 'تأكيد وإغلاق الطلب')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
