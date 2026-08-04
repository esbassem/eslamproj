import { useEffect, useRef, useState } from 'react';
import { Ban, Clock3, ExternalLink, FileClock, FileImage, FileText, MapPin, ShieldCheck, TriangleAlert, UserRound, X } from 'lucide-react';

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
} from '@/core/ui/sheet';
import {
  getPaperworkDocumentMoveDirectionLabel,
  getPaperworkDocumentSourceLabel,
  getPaperworkDocumentStatusLabel,
  motoCustomerCareService,
} from '@/features/moto-customer-care/services/motoCustomerCare.service';

const DOCUMENT_TYPE_LABELS = {
  jawab: 'جواب',
  document: 'مستند',
};

const EMPTY_VALUE = 'غير مسجل';
const CANCELLATION_REASONS = [
  { value: 'test_record', label: 'سجل تجريبي' },
  { value: 'registered_by_mistake', label: 'تم التسجيل بالخطأ' },
  { value: 'duplicate_document', label: 'مستند مكرر' },
  { value: 'not_physically_received', label: 'المستند لم يدخل الخزنة فعليًا' },
  { value: 'other', label: 'سبب آخر' },
];
const CANCELLATION_REASON_LABELS = Object.fromEntries(CANCELLATION_REASONS.map((reason) => [reason.value, reason.label]));
const RETROSPECTIVE_DELIVERY_REASONS = [
  { value: 'delivered_before_system_use', label: 'تم التسليم قبل استخدام النظام' },
  { value: 'delivery_not_recorded', label: 'تم التسليم ولم تُسجل الحركة' },
  { value: 'owner_confirmed_previous_delivery', label: 'تم التأكد من التسليم بواسطة الإدارة' },
  { value: 'other', label: 'سبب آخر' },
];
const RETROSPECTIVE_DELIVERY_REASON_LABELS = Object.fromEntries(RETROSPECTIVE_DELIVERY_REASONS.map((reason) => [reason.value, reason.label]));
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('ar-EG', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDateTime(value) {
  if (!value) return EMPTY_VALUE;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? EMPTY_VALUE : DATE_TIME_FORMATTER.format(date);
}

function getCurrentLocalDateTimeInputValue() {
  const now = new Date();
  const localTime = new Date(now.getTime() - (now.getTimezoneOffset() * 60 * 1000));
  return localTime.toISOString().slice(0, 16);
}

function formatTrackingIdentifiers(identifiers = []) {
  return identifiers
    .map((identifier) => {
      const label = identifier.label || identifier.code || 'رقم تعريف';
      const value = identifier.isNotAvailable ? 'غير متاح' : identifier.value;
      return value ? `${label}: ${value}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

function DetailsSkeleton() {
  return (
    <div
      className="mx-auto grid max-w-[1020px] animate-pulse gap-5 lg:h-full lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]"
      aria-label="جاري تحميل تفاصيل المستند"
      aria-busy="true"
    >
      <section className="min-w-0 px-1 sm:px-2">
        <div className="flex items-start gap-4">
          <span className="h-14 w-14 shrink-0 rounded-2xl bg-slate-200" />
          <div className="min-w-0 flex-1 space-y-3 pt-1">
            <div className="flex items-center gap-2">
              <span className="h-7 w-28 rounded-lg bg-slate-200" />
              <span className="h-6 w-24 rounded-full bg-slate-200" />
            </div>
            <span className="block h-4 w-44 max-w-full rounded bg-slate-200" />
            <span className="block h-3 w-36 max-w-full rounded bg-slate-200" />
            <span className="block h-3 w-64 max-w-full rounded bg-slate-200" />
            <div className="flex gap-3 pt-1">
              <span className="h-6 w-32 rounded-md bg-slate-200" />
              <span className="h-6 w-24 rounded-md bg-slate-200" />
            </div>
          </div>
        </div>
        <div className="mt-9">
          <span className="block h-4 w-32 rounded bg-slate-200" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <span className="block aspect-[4/3] rounded-2xl bg-slate-200" />
            <span className="block aspect-[4/3] rounded-2xl bg-slate-200" />
          </div>
        </div>
      </section>
      <section className="min-h-72 rounded-[28px] border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <span className="block h-4 w-24 rounded bg-slate-200" />
            <span className="block h-3 w-48 rounded bg-slate-100" />
          </div>
          <span className="h-5 w-5 rounded-full bg-slate-200" />
        </div>
        <div className="mt-7 space-y-4">
          {[0, 1, 2].map((item) => (
            <div key={item} className="flex gap-3">
              <span className="h-9 w-9 shrink-0 rounded-full bg-slate-200" />
              <span className="h-24 flex-1 rounded-2xl bg-slate-100" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DocumentAttachments({ attachments = [] }) {
  if (!attachments.length) {
    return (
      <div className="flex items-center gap-3 py-5 text-slate-400">
        <FileImage className="h-5 w-5" />
        <p className="text-xs font-bold">لا توجد صور أو مرفقات.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      {attachments.map((attachment, index) => {
        const isImage = attachment.mimeType?.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(attachment.name || attachment.path);
        return (
          <a
            key={attachment.id}
            href={attachment.signedUrl || undefined}
            target="_blank"
            rel="noreferrer"
            className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden bg-slate-100">
              {isImage && attachment.signedUrl ? (
                <img src={attachment.signedUrl} alt={attachment.name || `مرفق ${index + 1}`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
              ) : (
                <FileText className="h-10 w-10 text-slate-300" />
              )}
            </div>
            <div className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-black text-slate-800">{attachment.name || `مرفق ${index + 1}`}</p>
                <p className="mt-0.5 text-[10px] font-bold text-slate-400">{formatDateTime(attachment.createdAt)}</p>
              </div>
              <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
            </div>
          </a>
        );
      })}
    </div>
  );
}

function DocumentOverviewPanel({ document }) {
  const attachments = document.attachments || (document.jawabPhoto ? [document.jawabPhoto] : []);
  const ownerName = document.documentOwnerName ?? document.ownerName ?? EMPTY_VALUE;
  const title = document.documentTitle || document.displayTitle || DOCUMENT_TYPE_LABELS[document.documentType] || 'مستند';
  const trackingIdentifiersText = formatTrackingIdentifiers(document.trackingIdentifiers);

  return (
    <section aria-labelledby="document-overview-heading" className="min-w-0 lg:overflow-y-auto lg:pl-5">
      <div className="px-1 pb-2 sm:px-2">
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-200">
            <FileText className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SheetTitle id="document-overview-heading" className="min-w-0 truncate text-2xl font-black text-slate-950">
                {title}
              </SheetTitle>
              <span className={`inline-flex shrink-0 rounded-full px-3 py-1 text-[11px] font-black ring-1 ring-inset ${document.status === 'cancelled' ? 'bg-red-100 text-red-700 ring-red-200' : 'bg-emerald-100 text-emerald-700 ring-emerald-200'}`}>
                {getPaperworkDocumentStatusLabel(document.status)}
              </span>
              {document.hasActiveReleaseAuthorization ? (
                <span className="inline-flex shrink-0 rounded-full bg-blue-100 px-3 py-1 text-[11px] font-black text-blue-700 ring-1 ring-inset ring-blue-200">متاح للصرف</span>
              ) : null}
            </div>
            <p className="mt-1 truncate text-base font-black text-slate-700">
              {document.productName || document.manualItemDescription || 'منتج غير مسجل'}
            </p>
            <div className="mt-4 flex items-center gap-2 text-sm font-bold text-slate-500">
              <UserRound className="h-4 w-4 shrink-0" />
              <p className="truncate">باسم: <span className="font-black text-slate-800">{ownerName}</span></p>
            </div>
            {trackingIdentifiersText ? (
              <p className="mt-2 break-words text-xs font-bold leading-6 text-slate-400">{trackingIdentifiersText}</p>
            ) : null}
            <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
              {document.owner?.name ? (
                <p className="inline-flex min-w-0 max-w-full rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200/80">
                  <span className="truncate">Partner: <span className="font-black">{document.owner.name}</span></span>
                </p>
              ) : (
                <p className="inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 ring-1 ring-amber-200/80">
                  لا يوجد Partner مرتبط
                </p>
              )}
              <p className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700 ring-1 ring-blue-200/80">
                {document.paperworkRequestId ? 'عن طريق طلب أوراق' : 'تسجيل يدوي'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <FileImage className="h-4 w-4 text-slate-400" />
          <h3 className="text-sm font-black text-slate-900">الصور والمرفقات</h3>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">{attachments.length}</span>
        </div>
        <DocumentAttachments attachments={attachments} />
      </div>

      {document.hasActiveReleaseAuthorization ? (
        <div className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4">
          <div className="flex items-center gap-2 text-blue-700">
            <ShieldCheck className="h-4 w-4" />
            <h3 className="text-sm font-black">إتاحة الصرف</h3>
          </div>
          <p className="mt-2 inline-flex rounded-full bg-blue-100 px-3 py-1 text-[10px] font-black text-blue-700">متاح للصرف لمرة واحدة</p>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <div><dt className="font-bold text-blue-400">المستلم المعتمد</dt><dd className="mt-1 font-black text-slate-800">{document.releaseAuthorizedToName || EMPTY_VALUE}</dd></div>
            <div><dt className="font-bold text-blue-400">أُتيح بواسطة</dt><dd className="mt-1 font-black text-slate-800">{document.releaseAuthorizedByName || EMPTY_VALUE}</dd></div>
            <div><dt className="font-bold text-blue-400">وقت الإتاحة</dt><dd className="mt-1 font-black text-slate-800">{formatDateTime(document.releaseAuthorizedAt)}</dd></div>
            <div><dt className="font-bold text-blue-400">الحالة</dt><dd className="mt-1 font-black text-slate-800">بانتظار تنفيذ التسليم</dd></div>
            <div className="sm:col-span-2"><dt className="font-bold text-blue-400">ملاحظة الإدارة</dt><dd className="mt-1 whitespace-pre-wrap font-black leading-6 text-slate-800">{document.releaseAuthorizationNotes || EMPTY_VALUE}</dd></div>
          </dl>
        </div>
      ) : null}

      {document.status === 'cancelled' ? (
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-red-700">
            <Ban className="h-4 w-4" />
            <h3 className="text-sm font-black">بيانات إلغاء الصلاحية</h3>
          </div>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <div><dt className="font-bold text-red-400">سبب الإلغاء</dt><dd className="mt-1 font-black text-slate-800">{CANCELLATION_REASON_LABELS[document.cancellationReason] || document.cancellationReason || EMPTY_VALUE}</dd></div>
            <div><dt className="font-bold text-red-400">تاريخ الإلغاء</dt><dd className="mt-1 font-black text-slate-800">{formatDateTime(document.cancelledAt)}</dd></div>
            <div><dt className="font-bold text-red-400">تم الإلغاء بواسطة</dt><dd className="mt-1 font-black text-slate-800">{document.cancelledByName || EMPTY_VALUE}</dd></div>
            {document.cancellationNotes ? <div><dt className="font-bold text-red-400">ملاحظات الإلغاء</dt><dd className="mt-1 whitespace-pre-wrap font-black leading-6 text-slate-800">{document.cancellationNotes}</dd></div> : null}
          </dl>
        </div>
      ) : null}

      {document.latestMove?.sourceType === 'retrospective_delivery' ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-amber-700">
            <FileClock className="h-4 w-4" />
            <h3 className="text-sm font-black">بيانات الصرف السابق</h3>
          </div>
          <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
            <div><dt className="font-bold text-amber-500">سبب التسجيل المتأخر</dt><dd className="mt-1 font-black text-slate-800">{RETROSPECTIVE_DELIVERY_REASON_LABELS[document.latestMove.retrospectiveReason] || EMPTY_VALUE}</dd></div>
            <div><dt className="font-bold text-amber-500">تاريخ التسليم الفعلي</dt><dd className="mt-1 font-black text-slate-800">{formatDateTime(document.latestMove.movedAt)}</dd></div>
            <div><dt className="font-bold text-amber-500">تم تسجيل الصرف بواسطة</dt><dd className="mt-1 font-black text-slate-800">{document.latestMove.createdByName || EMPTY_VALUE}</dd></div>
            <div><dt className="font-bold text-amber-500">تاريخ التسجيل على النظام</dt><dd className="mt-1 font-black text-slate-800">{formatDateTime(document.latestMove.createdAt)}</dd></div>
            {document.latestMove.retrospectiveNotes ? <div className="sm:col-span-2"><dt className="font-bold text-amber-500">الملاحظات</dt><dd className="mt-1 whitespace-pre-wrap font-black leading-6 text-slate-800">{document.latestMove.retrospectiveNotes}</dd></div> : null}
          </dl>
        </div>
      ) : null}
    </section>
  );
}

function CancellationDialog({ open, documentTitle, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setNotes('');
    setError('');
    setIsSaving(false);
  }, [open]);

  if (!open) return null;
  const notesRequired = reason === 'other';
  const canSubmit = Boolean(reason) && (!notesRequired || Boolean(notes.trim())) && !isSaving;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError('');
    setIsSaving(true);
    try {
      await onConfirm({ reason, notes: notes.trim() || null });
    } catch (saveError) {
      setError(saveError.message || 'تعذر إلغاء صلاحية المستند.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="cancel-document-heading">
      <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-[26px] border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"><TriangleAlert className="h-5 w-5" /></span>
          <div>
            <h2 id="cancel-document-heading" className="text-lg font-black text-slate-950">إلغاء صلاحية المستند</h2>
            <p className="mt-1 text-xs font-bold text-slate-500">{documentTitle}</p>
          </div>
        </div>
        <p className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-xs font-bold leading-6 text-red-700">
          لن يتم حذف المستند أو صوره أو حركاته، لكنه سيخرج من قائمة الأوراق النشطة ولن يكون متاحًا للصرف.
        </p>
        <label className="mt-5 block text-xs font-black text-slate-700">
          سبب الإلغاء <span className="text-red-500">*</span>
          <select value={reason} onChange={(event) => setReason(event.target.value)} disabled={isSaving} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100">
            <option value="">اختر سبب الإلغاء</option>
            {CANCELLATION_REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="mt-4 block text-xs font-black text-slate-700">
          ملاحظات إضافية {notesRequired ? <span className="text-red-500">*</span> : null}
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isSaving} rows={4} className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-800 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />
        </label>
        {error ? <p role="alert" className="mt-3 text-xs font-black text-red-600">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={isSaving} className="rounded-xl px-4 py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-100 disabled:opacity-50">رجوع</button>
          <button type="submit" disabled={!canSubmit} className="rounded-xl bg-red-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? 'جاري الإلغاء...' : 'تأكيد الإلغاء'}</button>
        </div>
      </form>
    </div>
  );
}

function PreviousDeliveryDialog({ open, documentTitle, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [deliveredAt, setDeliveredAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setDeliveredAt('');
    setNotes('');
    setError('');
    setIsSaving(false);
  }, [open]);

  if (!open) return null;
  const notesRequired = reason === 'other';
  const canSubmit = Boolean(reason && deliveredAt) && (!notesRequired || Boolean(notes.trim())) && !isSaving;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    const parsedDate = new Date(deliveredAt);
    if (Number.isNaN(parsedDate.getTime())) {
      setError('تاريخ ووقت التسليم غير صالح.');
      return;
    }
    setError('');
    setIsSaving(true);
    try {
      await onConfirm({ reason, deliveredAt: parsedDate.toISOString(), notes: notes.trim() || null });
    } catch (saveError) {
      setError(saveError.message || 'تعذر تسجيل الصرف السابق.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="previous-delivery-heading">
      <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-[26px] border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><FileClock className="h-5 w-5" /></span>
          <div><h2 id="previous-delivery-heading" className="text-lg font-black text-slate-950">تسجيل صرف سابق</h2><p className="mt-1 text-xs font-bold text-slate-500">{documentTitle}</p></div>
        </div>
        <p className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold leading-6 text-amber-800">
          استخدم هذا الإجراء فقط إذا تأكدت أن المستند تم تسليمه فعليًا في وقت سابق. سيتم تسجيل حركة خروج تاريخية ولن يعود المستند ظاهرًا داخل الخزنة.
        </p>
        <label className="mt-5 block text-xs font-black text-slate-700">سبب التسجيل المتأخر <span className="text-red-500">*</span>
          <select value={reason} onChange={(event) => setReason(event.target.value)} disabled={isSaving} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100">
            <option value="">اختر السبب</option>
            {RETROSPECTIVE_DELIVERY_REASONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="mt-4 block text-xs font-black text-slate-700">تاريخ ووقت التسليم <span className="text-red-500">*</span>
          <input type="datetime-local" value={deliveredAt} max={getCurrentLocalDateTimeInputValue()} onChange={(event) => setDeliveredAt(event.target.value)} disabled={isSaving} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100" />
        </label>
        <label className="mt-4 block text-xs font-black text-slate-700">ملاحظات إضافية {notesRequired ? <span className="text-red-500">*</span> : null}
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isSaving} rows={4} className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-800 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100" />
        </label>
        {error ? <p role="alert" className="mt-3 text-xs font-black text-red-600">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={isSaving} className="rounded-xl px-4 py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-100 disabled:opacity-50">رجوع</button>
          <button type="submit" disabled={!canSubmit} className="rounded-xl bg-amber-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? 'جاري التسجيل...' : 'تأكيد تسجيل الصرف'}</button>
        </div>
      </form>
    </div>
  );
}

function ReleaseAuthorizationDialog({ open, document, onClose, onConfirm }) {
  const [recipientType, setRecipientType] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRecipientType('');
    setRecipientName('');
    setNotes('');
    setError('');
    setIsSaving(false);
  }, [open]);

  if (!open) return null;
  const partnerName = document.owner?.name || '';
  const documentOwnerName = document.documentOwnerName || document.ownerName || '';
  const needsCustomName = recipientType === 'other';
  const canSubmit = Boolean(recipientType && notes.trim())
    && (!needsCustomName || Boolean(recipientName.trim()))
    && !isSaving;

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError('');
    setIsSaving(true);
    try {
      await onConfirm({
        recipientType,
        recipientName: needsCustomName ? recipientName.trim() : null,
        notes: notes.trim(),
      });
    } catch (saveError) {
      setError(saveError.message || 'تعذر إنشاء إتاحة الصرف.');
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="release-authorization-heading">
      <form onSubmit={handleSubmit} className="w-full max-w-lg rounded-[26px] border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><ShieldCheck className="h-5 w-5" /></span>
          <div><h2 id="release-authorization-heading" className="text-lg font-black text-slate-950">إتاحة صرف المستند</h2><p className="mt-1 text-xs font-bold text-slate-500">{document.documentTitle || document.displayTitle || 'المستند'}</p></div>
        </div>
        <p className="mt-5 rounded-2xl bg-blue-50 px-4 py-3 text-xs font-bold leading-6 text-blue-800">
          هذه الإتاحة لا تعني أن المستند تم تسليمه. سيظل المستند داخل الخزنة حتى يؤكد الموظف عملية التسليم.
        </p>
        <label className="mt-5 block text-xs font-black text-slate-700">يُصرف إلى <span className="text-red-500">*</span>
          <select value={recipientType} onChange={(event) => setRecipientType(event.target.value)} disabled={isSaving} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
            <option value="">اختر المستلم المعتمد</option>
            <option value="partner" disabled={!document.ownerPartnerId || !partnerName}>الـPartner المرتبط: {partnerName || 'غير متاح'}</option>
            <option value="document_name" disabled={!documentOwnerName}>الاسم المكتوب على المستند: {documentOwnerName || 'غير متاح'}</option>
            <option value="other">شخص آخر</option>
          </select>
        </label>
        {needsCustomName ? (
          <label className="mt-4 block text-xs font-black text-slate-700">اسم المستلم <span className="text-red-500">*</span>
            <input type="text" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} disabled={isSaving} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          </label>
        ) : null}
        <label className="mt-4 block text-xs font-black text-slate-700">ملاحظة الصرف <span className="text-red-500">*</span>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} disabled={isSaving} rows={4} className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
        </label>
        {error ? <p role="alert" className="mt-3 text-xs font-black text-red-600">{error}</p> : null}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} disabled={isSaving} className="rounded-xl px-4 py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-100 disabled:opacity-50">رجوع</button>
          <button type="submit" disabled={!canSubmit} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{isSaving ? 'جاري الحفظ...' : 'تأكيد الإتاحة'}</button>
        </div>
      </form>
    </div>
  );
}

function DocumentMovesPanel({ moves = [] }) {
  if (!moves.length) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
        <Clock3 className="h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-black text-slate-600">لا توجد حركات مسجلة لهذا المستند.</p>
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 before:absolute before:bottom-5 before:right-[17px] before:top-5 before:w-px before:bg-slate-200">
      {moves.map((move) => (
        <li key={move.id} className="relative flex gap-3">
          <span className={`relative z-10 mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${move.moveDirection === 'out' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
            <MapPin className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-black text-slate-900">{getPaperworkDocumentMoveDirectionLabel(move.moveDirection)}</p>
                <p className="mt-0.5 text-[11px] font-bold text-slate-500">{getPaperworkDocumentSourceLabel(move.sourceType)}</p>
              </div>
              <time className="text-[10px] font-bold text-slate-400">{formatDateTime(move.movedAt || move.createdAt)}</time>
            </div>
            <div className="mt-3 grid gap-2 text-xs font-bold text-slate-600 sm:grid-cols-2">
              <p><span className="text-slate-400">من: </span>{move.fromLabel || 'غير محدد'}</p>
              <p><span className="text-slate-400">إلى: </span>{move.toLabel || 'غير محدد'}</p>
              <p className="sm:col-span-2"><span className="text-slate-400">نفذها: </span>{move.createdByName || 'غير مسجل'}</p>
            </div>
            {(move.sourceType === 'retrospective_delivery' ? move.retrospectiveNotes : move.notes) ? <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold leading-6 text-slate-600">{move.sourceType === 'retrospective_delivery' ? move.retrospectiveNotes : move.notes}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function usePaperworkDocumentDetails({ open, tenantId, documentId }) {
  const [details, setDetails] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!open || !tenantId || !documentId) return undefined;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setDetails(null);
    setError('');
    setIsLoading(true);

    motoCustomerCareService.getPaperworkDocumentDetails({
      tenantId,
      documentId,
    }).then((result) => {
      if (requestIdRef.current !== requestId) return;
      setDetails(result);
    }).catch((loadError) => {
      if (requestIdRef.current !== requestId) return;
      setError(loadError.message || 'تعذر تحميل تفاصيل المستند.');
    }).finally(() => {
      if (requestIdRef.current === requestId) setIsLoading(false);
    });

    return () => {
      requestIdRef.current += 1;
    };
  }, [documentId, open, tenantId]);

  const reset = () => {
    requestIdRef.current += 1;
    setDetails(null);
    setError('');
    setIsLoading(false);
  };

  return { details, error, isLoading, reset, setDetails };
}

export function PaperworkDocumentDetailsDialog({
  open,
  onOpenChange,
  document: initialDocument,
  tenantId,
  isOwner = false,
  onCancelled,
  onPreviousDeliveryRecorded,
  onReleaseAuthorized,
}) {
  const { details, error, isLoading, reset, setDetails } = usePaperworkDocumentDetails({
    open,
    tenantId,
    documentId: initialDocument?.id,
  });
  const displayedDocument = details?.id === initialDocument?.id
    ? { ...initialDocument, ...details }
    : initialDocument;
  const [isCancellationOpen, setIsCancellationOpen] = useState(false);
  const [isPreviousDeliveryOpen, setIsPreviousDeliveryOpen] = useState(false);
  const [isReleaseAuthorizationOpen, setIsReleaseAuthorizationOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen) {
      reset();
      setIsCancellationOpen(false);
      setIsPreviousDeliveryOpen(false);
      setIsReleaseAuthorizationOpen(false);
      setSuccessMessage('');
    }
    onOpenChange(nextOpen);
  };

  if (!displayedDocument) return null;

  const handleCancellation = async ({ reason, notes }) => {
    const updatedDocument = await motoCustomerCareService.cancelPaperworkDocument({
      tenantId,
      documentId: displayedDocument.id,
      reason,
      notes,
    });
    setDetails(updatedDocument);
    setIsCancellationOpen(false);
    setSuccessMessage('تم إلغاء صلاحية المستند مع الاحتفاظ بسجله.');
    await onCancelled?.(updatedDocument);
  };

  const handlePreviousDelivery = async ({ reason, deliveredAt, notes }) => {
    const updatedDocument = await motoCustomerCareService.recordPreviousPaperworkDocumentDelivery({
      tenantId,
      documentId: displayedDocument.id,
      deliveredAt,
      reason,
      notes,
    });
    setDetails(updatedDocument);
    setIsPreviousDeliveryOpen(false);
    setSuccessMessage('تم تسجيل الصرف السابق وحفظ حركة الخروج.');
    await onPreviousDeliveryRecorded?.(updatedDocument);
  };

  const handleReleaseAuthorization = async ({ recipientType, recipientName, notes }) => {
    const updatedDocument = await motoCustomerCareService.authorizePaperworkDocumentRelease({
      tenantId,
      documentId: displayedDocument.id,
      recipientType,
      recipientName,
      notes,
    });
    setDetails(updatedDocument);
    setIsReleaseAuthorizationOpen(false);
    setSuccessMessage('تم إنشاء إتاحة صرف لمرة واحدة.');
    await onReleaseAuthorized?.(updatedDocument);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="center"
        dir="rtl"
        overlayClassName="z-[140] bg-slate-950/45 backdrop-blur-[2px]"
        className="inset-0 z-[150] h-[100dvh] w-full max-w-none border-0 bg-[#fafafa] sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(88vh,900px)] sm:w-[min(94vw,1100px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[30px] sm:border sm:border-slate-200"
        aria-describedby={undefined}
      >
        <SheetClose
          className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm ring-1 ring-slate-200 backdrop-blur transition hover:bg-white hover:text-slate-900 sm:left-5 sm:top-5"
          aria-label="إغلاق تفاصيل المستند"
        >
          <X className="h-5 w-5" />
        </SheetClose>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(4.5rem,calc(env(safe-area-inset-top)+4rem))] sm:p-6 lg:overflow-hidden">
          {error ? (
            <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</div>
          ) : null}
          {successMessage ? <div role="status" className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700">{successMessage}</div> : null}
          {isLoading && !details ? (
            <DetailsSkeleton />
          ) : (
            <div className="mx-auto grid w-full max-w-[1020px] gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)]">
              <DocumentOverviewPanel document={displayedDocument} />
              <section aria-labelledby="document-moves-heading" className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-5 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.28)] sm:p-6 lg:overflow-y-auto">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <h2 id="document-moves-heading" className="text-base font-black text-slate-950">سجل الحركات</h2>
                  <p className="mt-0.5 text-[11px] font-bold text-slate-400">جميع حركات المستند من الأحدث للأقدم</p>
                </div>
                <Clock3 className="h-5 w-5 text-slate-300" />
              </div>
                <DocumentMovesPanel moves={displayedDocument.moves || []} />
              </section>
            </div>
          )}
          {isOwner && displayedDocument.status === 'in_custody' && !isLoading ? (
            <div className="mx-auto mt-5 grid w-full max-w-[1020px] gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-3">
              {!displayedDocument.hasActiveReleaseAuthorization ? (
                <button type="button" onClick={() => setIsReleaseAuthorizationOpen(true)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-right transition hover:bg-blue-50">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><ShieldCheck className="h-5 w-5" /></span>
                  <span className="min-w-0"><span className="block text-sm font-black text-blue-700">إتاحة الصرف</span><span className="mt-0.5 block text-[11px] font-bold text-slate-500">تحديد مستلم معتمد والسماح بصرف المستند لمرة واحدة</span></span>
                </button>
              ) : null}
              <button type="button" onClick={() => setIsPreviousDeliveryOpen(true)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-right transition hover:bg-amber-50">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><FileClock className="h-5 w-5" /></span>
                <span className="min-w-0"><span className="block text-sm font-black text-amber-700">تسجيل صرف سابق</span><span className="mt-0.5 block text-[11px] font-bold text-slate-500">تسجيل خروج حدث فعليًا ولم يُسجل على النظام</span></span>
              </button>
              <button type="button" onClick={() => setIsCancellationOpen(true)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-right transition hover:bg-red-50">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"><Ban className="h-5 w-5" /></span>
                <span className="min-w-0"><span className="block text-sm font-black text-red-700">إلغاء صلاحية المستند</span><span className="mt-0.5 block text-[11px] font-bold text-slate-500">إخراج المستند من الأوراق النشطة مع الاحتفاظ بسجله</span></span>
              </button>
            </div>
          ) : null}
        </div>
        <CancellationDialog
          open={isCancellationOpen}
          documentTitle={displayedDocument.documentTitle || displayedDocument.displayTitle || 'المستند'}
          onClose={() => setIsCancellationOpen(false)}
          onConfirm={handleCancellation}
        />
        <PreviousDeliveryDialog
          open={isPreviousDeliveryOpen}
          documentTitle={displayedDocument.documentTitle || displayedDocument.displayTitle || 'المستند'}
          onClose={() => setIsPreviousDeliveryOpen(false)}
          onConfirm={handlePreviousDelivery}
        />
        <ReleaseAuthorizationDialog
          open={isReleaseAuthorizationOpen}
          document={displayedDocument}
          onClose={() => setIsReleaseAuthorizationOpen(false)}
          onConfirm={handleReleaseAuthorization}
        />
      </SheetContent>
    </Sheet>
  );
}
