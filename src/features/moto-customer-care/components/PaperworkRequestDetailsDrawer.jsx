import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Building2, Check, ImagePlus, Search, X } from 'lucide-react';
import { partnersService } from '@/features/contacts/services/partners.service';
import { motoCustomerCareService } from '@/features/moto-customer-care/services/motoCustomerCare.service';

const EVENT_LABELS = {
  created: 'تم إنشاء الطلب',
  status_changed: 'تم تغيير حالة الطلب',
  stage_changed: 'تم تحديث مرحلة الأوراق',
  done: 'تم إنهاء الطلب',
  cancelled: 'تم إلغاء الطلب',
  note: 'ملاحظة',
  sent_to_supplier: 'تم إرسال الأوراق للجهة',
};

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function getCreatedAtTime(record) {
  const value = record?.createdAt || record?.created_at;
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function getEventLabel(event) {
  return EVENT_LABELS[event?.eventType]
    || EVENT_LABELS[event?.event_type]
    || event?.eventType
    || event?.event_type
    || 'تحديث على الطلب';
}

function isCreationEvent(event) {
  const eventType = String(event?.eventType || event?.event_type || '').trim().toLowerCase();
  return eventType === 'created' || eventType === 'create' || eventType === 'request_created';
}

function findIdentifier(request, pattern) {
  return (request?.trackingIdentifiers || []).find((identifier) => (
    pattern.test(`${identifier.code || ''} ${identifier.label || ''}`)
  ));
}

function getGuardianshipLabel(note) {
  const value = String(note || '').match(/حالة الوصاية:\s*([^\n]+)/)?.[1]?.trim();
  return {
    father_guardian: 'وصاية والده',
    mother_guardian: 'وصاية والدته',
    none: 'بدون وصاية',
  }[value] || value || '--';
}

function RequestImages({ request, onPreview }) {
  const ownerImage = request?.ownerAttachments?.document_owner_id_card
    || request?.ownerAttachments?.document_owner_id_front
    || request?.ownerAttachments?.document_owner_id_back
    || null;
  const images = [
    { id: 'chassis', label: 'صورة الشاسيه', attachment: request?.attachments?.chassis_photo },
    { id: 'engine', label: 'صورة الموتور', attachment: request?.attachments?.engine_photo },
  ];

  return (
    <button
      type="button"
      onClick={onPreview}
      className="w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-right"
      aria-label="عرض صور الطلب"
    >
      <div className="aspect-[16/5] bg-slate-50">
        {ownerImage?.signedUrl ? (
          <img src={ownerImage.signedUrl} alt="بطاقة صاحب الورق" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <span className="flex h-full items-center justify-center text-slate-300"><ImagePlus className="h-6 w-6" /></span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-px border-t border-white bg-slate-200">
        {images.map((image) => (
          <span key={image.id} className="aspect-[5/4] min-w-0 bg-slate-50">
            {image.attachment?.signedUrl ? (
              <img src={image.attachment.signedUrl} alt={image.label} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full items-center justify-center text-slate-300"><ImagePlus className="h-5 w-5" /></span>
            )}
          </span>
        ))}
      </div>
    </button>
  );
}

function ImagesPreview({ request, onClose }) {
  const ownerImage = request?.ownerAttachments?.document_owner_id_card
    || request?.ownerAttachments?.document_owner_id_front
    || request?.ownerAttachments?.document_owner_id_back
    || null;
  const images = [
    { id: 'chassis', label: 'صورة الشاسيه', attachment: request?.attachments?.chassis_photo },
    { id: 'engine', label: 'صورة الموتور', attachment: request?.attachments?.engine_photo },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[120] flex flex-col bg-slate-950" dir="rtl">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-4">
        <p className="truncate text-sm font-black text-white">{request?.productName || 'صور طلب الأوراق'}</p>
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white" aria-label="إغلاق">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-[0.72fr_1.28fr] gap-1.5 p-1.5">
        <div className="min-h-0 overflow-hidden rounded-lg bg-slate-900">
          {ownerImage?.signedUrl ? <img src={ownerImage.signedUrl} alt="بطاقة صاحب الورق" className="h-full w-full object-contain" /> : null}
        </div>
        <div className="grid min-h-0 grid-cols-2 gap-1.5">
          {images.map((image) => (
            <div key={image.id} className="min-h-0 overflow-hidden rounded-lg bg-slate-900">
              {image.attachment?.signedUrl ? <img src={image.attachment.signedUrl} alt={image.label} className="h-full w-full object-contain" /> : null}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ProcessorSelector({ tenantId, request, currentProcessor, onClose, onChange, onSaved }) {
  const [options, setOptions] = useState([]);
  const [status, setStatus] = useState('loading');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState(null);
  const [pendingOption, setPendingOption] = useState(null);

  useEffect(() => {
    let active = true;
    partnersService.getPaperworkProcessorOptions({ tenantId })
      .then((rows) => {
        if (!active) return;
        setOptions(rows);
        setStatus('ready');
      })
      .catch((loadError) => {
        if (!active) return;
        setError(loadError?.message || 'تعذر تحميل جهات إصدار الأوراق.');
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [tenantId]);

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => (
      [option.name, option.phone, option.subtitle, option.parentName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    ));
  }, [options, search]);

  const confirmProcessor = async () => {
    if (!pendingOption || savingId || !request?.trackingUnitId) return;
    const previous = currentProcessor || null;
    setSavingId(pendingOption.id);
    setError('');
    onChange(pendingOption);
    onClose();

    try {
      await motoCustomerCareService.updateTrackingUnitPaperworkProcessor({
        tenantId,
        trackingUnitId: request.trackingUnitId,
        processorPartnerId: pendingOption.id,
        paperworkRequestId: request.id,
      });
      onSaved?.(pendingOption);
    } catch (saveError) {
      onChange(previous);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-end bg-slate-950/25 sm:items-center sm:justify-center" dir="rtl">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="إغلاق اختيار الجهة" />
      <section className="relative max-h-[75%] w-full overflow-hidden rounded-t-2xl bg-white sm:w-[26rem] sm:rounded-2xl sm:border sm:border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h3 className="text-sm font-black text-slate-950">اختيار جهة الإصدار</h3>
            <p className="mt-0.5 text-xs font-bold text-slate-500">اختر المورد أو الجهة التابعة.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
            <X className="h-4 w-4" />
          </button>
        </div>

        {!pendingOption && status === 'ready' && options.length > 6 ? (
          <div className="border-b border-slate-100 p-2">
            <label className="flex items-center gap-2 rounded-lg bg-slate-100 px-3">
              <Search className="h-4 w-4 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالاسم أو الهاتف" className="h-10 min-w-0 flex-1 bg-transparent text-sm font-bold outline-none" />
            </label>
          </div>
        ) : null}

        <div className="max-h-[55dvh] overflow-y-auto p-2">
          {pendingOption ? (
            <div className="p-2">
              <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-center">
                <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white">
                  <Building2 className="h-5 w-5" />
                </span>
                <p className="mt-3 text-xs font-black text-slate-500">تأكيد جهة إصدار الأوراق</p>
                <p className="mt-1 text-base font-black text-slate-950">{pendingOption.name}</p>
                <p className="mt-1 text-xs font-bold text-slate-500">
                  {[pendingOption.subtitle, pendingOption.parentName ? `تابع لـ ${pendingOption.parentName}` : '', pendingOption.phone].filter(Boolean).join(' - ')}
                </p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={confirmProcessor}
                  disabled={Boolean(savingId)}
                  className="h-11 rounded-xl bg-blue-600 text-sm font-black text-white disabled:cursor-wait disabled:opacity-60"
                >
                  {savingId ? 'جاري الحفظ...' : 'تأكيد الاختيار'}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingOption(null)}
                  disabled={Boolean(savingId)}
                  className="h-11 rounded-xl bg-slate-100 text-sm font-black text-slate-700 disabled:opacity-60"
                >
                  رجوع
                </button>
              </div>
            </div>
          ) : status === 'loading' ? (
            <p className="px-3 py-8 text-center text-sm font-bold text-slate-400">جاري تحميل الجهات...</p>
          ) : status === 'error' ? (
            <p className="m-2 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>
          ) : filteredOptions.length ? (
            filteredOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPendingOption(option)}
                disabled={Boolean(savingId)}
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-right hover:bg-blue-50 disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-slate-950">{option.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-500">
                    {[option.subtitle, option.parentName ? `تابع لـ ${option.parentName}` : '', option.phone].filter(Boolean).join(' - ')}
                  </span>
                </span>
                <span className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-300" />
              </button>
            ))
          ) : (
            <p className="px-3 py-8 text-center text-sm font-bold text-slate-400">لا توجد جهات مطابقة.</p>
          )}
        </div>
      </section>
    </div>
  );
}

const CUSTOMER_CONFIRMATION_CHECKLIST = [
  'مراجعة بيانات البيع والمنتج.',
  'مراجعة صاحب الورق.',
  'مراجعة صورة البطاقة أو التأكد أن صاحب الورق سيتم تحديده لاحقًا.',
  'التأكد أن العميل على علم بأن الأوراق ستُرسل للجهة المختصة.',
];

export function PaperworkRequestDetailsDrawer({
  request,
  open,
  onOpenChange,
  tenantId,
  canManageProcessor = false,
  onSaved,
  onCustomerConfirmed,
  onRequestSent,
}) {
  const [snapshot, setSnapshot] = useState(request);
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [contentReady, setContentReady] = useState(false);
  const [processorOpen, setProcessorOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [customerConfirmationOpen, setCustomerConfirmationOpen] = useState(false);
  const [isConfirmingCustomer, setIsConfirmingCustomer] = useState(false);
  const [customerConfirmationError, setCustomerConfirmationError] = useState('');
  const [sendConfirmationOpen, setSendConfirmationOpen] = useState(false);
  const [isSendingToProcessor, setIsSendingToProcessor] = useState(false);
  const [sendToProcessorError, setSendToProcessorError] = useState('');
  const [sendToProcessorNote, setSendToProcessorNote] = useState('');
  const [processorOverride, setProcessorOverride] = useState(null);
  const [processorPermissionNotice, setProcessorPermissionNotice] = useState('');
  const closeTimerRef = useRef(null);
  const openFrameRef = useRef(null);
  const contentTimerRef = useRef(null);

  useEffect(() => {
    if (open && request) setSnapshot(request);
  }, [open, request]);

  useEffect(() => {
    window.clearTimeout(closeTimerRef.current);
    if (openFrameRef.current) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }
    window.clearTimeout(contentTimerRef.current);

    if (open) {
      setVisible(false);
      setContentReady(false);
      setMounted(true);
      openFrameRef.current = window.requestAnimationFrame(() => {
        openFrameRef.current = window.requestAnimationFrame(() => {
          setVisible(true);
          contentTimerRef.current = window.setTimeout(() => {
            setContentReady(true);
          }, 80);
          openFrameRef.current = null;
        });
      });
    } else {
      setVisible(false);
      setContentReady(false);
      setProcessorOpen(false);
      setPreviewOpen(false);
      setCustomerConfirmationOpen(false);
      setCustomerConfirmationError('');
      setSendConfirmationOpen(false);
      setSendToProcessorError('');
      setSendToProcessorNote('');
      setProcessorPermissionNotice('');
      closeTimerRef.current = window.setTimeout(() => setMounted(false), 240);
    }

    return () => {
      window.clearTimeout(closeTimerRef.current);
      window.clearTimeout(contentTimerRef.current);
      if (openFrameRef.current) {
        window.cancelAnimationFrame(openFrameRef.current);
      }
    };
  }, [open]);

  useEffect(() => {
    setProcessorOverride(null);
    setProcessorPermissionNotice('');
  }, [snapshot?.id]);

  useEffect(() => {
    if (!mounted) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (previewOpen) setPreviewOpen(false);
      else if (processorOpen) setProcessorOpen(false);
      else if (customerConfirmationOpen) setCustomerConfirmationOpen(false);
      else if (sendConfirmationOpen) setSendConfirmationOpen(false);
      else onOpenChange(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [customerConfirmationOpen, mounted, onOpenChange, previewOpen, processorOpen, sendConfirmationOpen]);

  if (!mounted || !snapshot) return null;

  const displayedProcessor = processorOverride || snapshot.processor || null;
  const processorName = displayedProcessor?.name || 'لم يتم تحديد جهة إصدار الأوراق';
  const customerName = snapshot.customer?.name || 'عميل غير محدد';
  const customerPhone = snapshot.customer?.phone || snapshot.customer?.phone1 || snapshot.customer?.phone2 || '--';
  const customerAddress = snapshot.customer?.address || '--';
  const documentOwnerName = snapshot.documentOwnerName
    || snapshot.documentOwner?.name
    || (snapshot.documentOwnerStatus === 'later' ? 'سيتم تحديده لاحقًا' : '--');
  const guardianshipLabel = snapshot.documentOwnerStatus === 'later'
    ? '--'
    : getGuardianshipLabel(snapshot.documentOwnerNote);
  const ownerImage = snapshot.ownerAttachments?.document_owner_id_card
    || snapshot.ownerAttachments?.document_owner_id_front
    || snapshot.ownerAttachments?.document_owner_id_back
    || null;
  const ownerIsReady = snapshot.documentOwnerStatus === 'later'
    || (
      snapshot.documentOwnerStatus === 'confirmed'
      && Boolean(snapshot.documentOwnerName || snapshot.documentOwner?.name)
      && Boolean(ownerImage?.signedUrl)
    );
  const sendBlockers = [
    !snapshot.customerConfirmed ? 'يجب التأكيد مع العميل أولًا.' : '',
    !displayedProcessor?.id ? 'يجب تحديد جهة إصدار الأوراق.' : '',
    !ownerIsReady ? 'بيانات صاحب الورق أو صورة البطاقة غير مكتملة.' : '',
    snapshot.blockedReason ? snapshot.blockedReason : '',
    snapshot.currentStage !== 'preparation' ? 'الطلب ليس في مرحلة التجهيز.' : '',
    snapshot.status !== 'open' ? 'لا يمكن إرسال طلب غير مفتوح.' : '',
  ].filter(Boolean);
  const canSendToProcessor = sendBlockers.length === 0;
  const chassis = findIdentifier(snapshot, /chassis|شاسيه/i);
  const engine = findIdentifier(snapshot, /engine|motor|موتور|محرك/i);
  const sourceEvents = Array.isArray(snapshot.events) ? snapshot.events : [];
  const sortedEvents = contentReady
    ? sourceEvents.slice().sort((first, second) => (
      getCreatedAtTime(first) - getCreatedAtTime(second)
    ))
    : [];
  const recordedCreationEvent = contentReady ? sortedEvents.find(isCreationEvent) : null;
  const creationEvent = recordedCreationEvent || {
    id: `request-created-${snapshot.id}`,
    eventType: 'created',
    createdAt: snapshot.createdAt,
    createdBy: snapshot.createdBy || snapshot.created_by || null,
    createdByName: snapshot.createdByName || snapshot.created_by_name || '',
    isSynthetic: true,
  };
  const events = contentReady
    ? [
      creationEvent,
      ...sortedEvents.filter((event) => !isCreationEvent(event)),
    ]
    : [];
  const confirmWithCustomer = async () => {
    if (isConfirmingCustomer || snapshot.customerConfirmed) return;

    setIsConfirmingCustomer(true);
    setCustomerConfirmationError('');

    try {
      const confirmation = await motoCustomerCareService.confirmPaperworkRequestWithCustomer({
        tenantId,
        requestId: snapshot.id,
      });
      const nextSnapshot = {
        ...snapshot,
        customerConfirmed: true,
        customerConfirmedAt: confirmation.customerConfirmedAt,
        customerConfirmedBy: confirmation.customerConfirmedBy,
        customerConfirmedByName: confirmation.customerConfirmedByName,
        events: confirmation.event
          ? [...(snapshot.events || []), confirmation.event]
          : snapshot.events,
      };
      setSnapshot(nextSnapshot);
      setCustomerConfirmationOpen(false);
      onCustomerConfirmed?.(confirmation);
    } catch (error) {
      setCustomerConfirmationError(error?.message || 'تعذر تأكيد الطلب مع العميل.');
    } finally {
      setIsConfirmingCustomer(false);
    }
  };
  const sendToProcessor = async () => {
    if (isSendingToProcessor || !canSendToProcessor) return;

    setIsSendingToProcessor(true);
    setSendToProcessorError('');

    try {
      const result = await motoCustomerCareService.sendPaperworkRequestToProcessor({
        tenantId,
        requestId: snapshot.id,
        notes: sendToProcessorNote,
      });
      const nextSnapshot = {
        ...snapshot,
        currentStage: result.currentStage,
        stage: {
          code: result.currentStage,
          name: 'تم الإرسال للجهة',
        },
        updatedAt: result.updatedAt,
        events: [...(snapshot.events || []), result.event],
      };
      setSnapshot(nextSnapshot);
      setSendConfirmationOpen(false);
      setSendToProcessorNote('');
      onRequestSent?.(result);
    } catch (error) {
      setSendToProcessorError(error?.message || 'تعذر إرسال طلب الأوراق للجهة.');
    } finally {
      setIsSendingToProcessor(false);
    }
  };

  return createPortal(
    <div className={`fixed inset-0 z-[70] ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`} dir="rtl">
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className={`absolute inset-0 bg-slate-950/30 transition-opacity duration-200 ease-out ${visible ? 'opacity-100' : 'opacity-0'}`}
        aria-label="إغلاق تفاصيل الطلب"
      />
      <aside
        className={`absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-2xl will-change-transform transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="تفاصيل طلب الأوراق"
      >
        <header className="relative z-20 shrink-0 bg-blue-700 px-4 pb-4 pt-3 text-white shadow-[0_8px_18px_-14px_rgba(15,23,42,0.48)]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-black">تفاصيل طلب الأوراق</h2>
            <button type="button" onClick={() => onOpenChange(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15" aria-label="إغلاق">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-4 border-t border-white/20 pt-3">
            <div className="min-w-0">
              <p className="text-[10px] font-bold text-blue-100">صاحب الفاتورة</p>
              <p className="mt-0.5 truncate text-sm font-black">{customerName}</p>
              <p className="mt-1 truncate text-[10px] font-bold text-blue-100" dir="ltr">{customerPhone}</p>
              <p className="mt-0.5 truncate text-[10px] text-blue-100" title={customerAddress}>{customerAddress}</p>
            </div>

            <div className="min-w-0 border-r border-white/20 pr-4">
              <p className="text-[10px] font-bold text-blue-100">المنتج</p>
              <p className="mt-0.5 truncate text-sm font-black" title={snapshot.productName || 'منتج غير محدد'}>
                {snapshot.productName || 'منتج غير محدد'}
              </p>
              <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[10px] font-bold text-blue-100">
                <span className="min-w-0 truncate">
                  شاسيه <span className="font-mono text-white" dir="ltr">{chassis?.value || '--'}</span>
                </span>
                <span className="h-3 w-px shrink-0 bg-white/20" />
                <span className="min-w-0 truncate">
                  موتور <span className="font-mono text-white" dir="ltr">{engine?.value || '--'}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!canManageProcessor) {
                    setProcessorPermissionNotice('المالك فقط يقدر يحدد جهة إصدار الأوراق.');
                    return;
                  }
                  setProcessorPermissionNotice('');
                  setProcessorOpen(true);
                }}
                className={`mt-2 flex max-w-full items-center gap-1.5 rounded-lg px-2 py-1 text-right transition-colors ${
                  displayedProcessor
                    ? 'bg-white/12 text-white hover:bg-white/20'
                    : 'bg-amber-300/20 text-amber-100 hover:bg-amber-300/30'
                }`}
                aria-label={displayedProcessor ? 'تغيير جهة إصدار الأوراق' : 'اختيار جهة إصدار الأوراق'}
              >
                {displayedProcessor ? (
                  <Building2 className="h-3 w-3 shrink-0" />
                ) : (
                  <AlertCircle className="h-3 w-3 shrink-0" />
                )}
                <span className="min-w-0 truncate text-[10px] font-black">
                  {displayedProcessor ? `جهة الإصدار: ${processorName}` : 'جهة الإصدار غير محددة'}
                </span>
              </button>
              {processorPermissionNotice ? (
                <p className="mt-1 rounded-md bg-red-500/18 px-2 py-1 text-[10px] font-black leading-4 text-red-50">
                  {processorPermissionNotice}
                </p>
              ) : null}
            </div>
          </div>
        </header>

        <div className="relative z-0 min-h-0 flex-1 overflow-y-auto bg-white px-4 pb-6 pt-2.5">
          {contentReady ? (
            <section>
              <div className="relative">
                <div>
                  {events.map((event, index) => {
                    const isCreated = index === 0;

                    return (
                      <article key={event.id || `${event.eventType}-${index}`} className="border-b border-slate-200">
                        <div className="py-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className={`truncate text-sm font-black ${isCreated ? 'text-blue-700' : 'text-slate-950'}`}>
                                {getEventLabel(event)}
                              </p>
                              {event.createdByName ? (
                                <p className="mt-0.5 text-xs font-bold text-slate-500">بواسطة: {event.createdByName}</p>
                              ) : null}
                            </div>
                            <p className="shrink-0 text-left text-[10px] font-bold text-slate-400">
                              {formatDate(event.createdAt || event.created_at)}
                            </p>
                          </div>

                          {event.notes ? (
                            <p className="mt-2 text-xs font-bold leading-5 text-slate-600">{event.notes}</p>
                          ) : null}

                          {isCreated ? (
                            <div className="mt-3 flex items-center gap-4">
                              <div className="w-full max-w-[10.5rem] shrink-0 rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
                                <RequestImages request={snapshot} onPreview={() => setPreviewOpen(true)} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-[11px] font-bold text-slate-400">طلب الورق باسم</p>
                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                                  <p className="min-w-0 truncate text-sm font-black text-slate-950" title={documentOwnerName}>
                                    {documentOwnerName}
                                  </p>
                                  {guardianshipLabel !== '--' ? (
                                    <span className="shrink-0 text-[10px] font-bold text-slate-400">
                                      · {guardianshipLabel}
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : (
            <div className="space-y-3 py-4" aria-label="جاري تجهيز تفاصيل الطلب">
              <div className="h-4 w-32 rounded-full bg-slate-100" />
              <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
                <div className="h-24 w-40 shrink-0 rounded-2xl bg-slate-100" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="h-3 w-20 rounded-full bg-slate-100" />
                  <div className="h-4 w-32 rounded-full bg-slate-100" />
                  <div className="h-3 w-24 rounded-full bg-slate-100" />
                </div>
              </div>
              <div className="space-y-2 border-b border-slate-100 pb-4">
                <div className="h-4 w-28 rounded-full bg-slate-100" />
                <div className="h-3 w-48 rounded-full bg-slate-100" />
              </div>
            </div>
          )}
        </div>

        <footer className={`relative z-20 shrink-0 border-t shadow-[0_-10px_26px_-16px_rgba(15,23,42,0.70)] ${
          snapshot.customerConfirmed
            ? 'border-slate-200 bg-white'
            : 'border-slate-200/80 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3'
        }`}
        >
          {!snapshot.customerConfirmed ? (
            <button
              type="button"
              onClick={() => {
                setCustomerConfirmationError('');
                setCustomerConfirmationOpen(true);
              }}
              className="mb-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-xs font-black text-white transition-colors hover:bg-emerald-700"
            >
              <Check className="h-4 w-4" />
              تأكيد مع العميل
            </button>
          ) : null}

          {canSendToProcessor ? (
            <div className="grid min-h-[4.25rem] grid-cols-[minmax(0,1fr)_9.5rem] pb-[env(safe-area-inset-bottom)]">
              <div className="flex min-w-0 flex-col justify-center px-4 py-2.5">
                <p className="text-[10px] font-bold text-slate-400">ماذا يحدث عند الضغط؟</p>
                <p className="mt-0.5 text-xs font-black leading-5 text-slate-800" title={processorName}>
                  {displayedProcessor
                    ? `بالضغط تؤكد أنك أرسلت الأوراق إلى ${processorName}`
                    : 'بالضغط تؤكد أنك أرسلت الأوراق إلى جهة الإصدار'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSendToProcessorError('');
                  setSendToProcessorNote('');
                  setSendConfirmationOpen(true);
                }}
                className="group flex items-center justify-center gap-2 border-r border-emerald-700/25 bg-gradient-to-l from-emerald-600 to-emerald-500 px-3 text-white transition-colors hover:from-emerald-700 hover:to-emerald-600 focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-emerald-200"
              >
                <Building2 className="h-4 w-4 transition-transform group-hover:-translate-y-0.5" />
                <span className="text-xs font-black">إرسال للجهة</span>
              </button>
            </div>
          ) : snapshot.currentStage === 'sent_to_processor' ? (
            <div className="flex min-h-[4.25rem] items-center justify-between gap-3 px-4 pb-[env(safe-area-inset-bottom)]">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400">الإجراء التالي</p>
                <p className="mt-0.5 text-xs font-black text-slate-800">تم استلام الورق من الجهة</p>
              </div>
              <span className="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-[10px] font-black text-blue-700">
                بانتظار الاستلام
              </span>
            </div>
          ) : snapshot.currentStage === 'received_from_processor' ? (
            <div className="flex min-h-[4.25rem] items-center justify-between gap-3 px-4 pb-[env(safe-area-inset-bottom)]">
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400">الإجراء التالي</p>
                <p className="mt-0.5 text-xs font-black text-slate-800">إبلاغ العميل</p>
              </div>
              <span className="shrink-0 rounded-lg bg-amber-50 px-3 py-2 text-[10px] font-black text-amber-700">
                بانتظار الإبلاغ
              </span>
            </div>
          ) : snapshot.customerConfirmed ? (
            <div className="px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              <p className="text-xs font-black text-slate-700">لا يمكن إرسال الطلب حاليًا</p>
              <p className="mt-1 text-[10px] font-bold leading-5 text-slate-400">{sendBlockers[0]}</p>
            </div>
          ) : null}
        </footer>

        {customerConfirmationOpen ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/30 p-4" dir="rtl">
            <button
              type="button"
              className="absolute inset-0"
              onClick={() => {
                if (!isConfirmingCustomer) setCustomerConfirmationOpen(false);
              }}
              aria-label="إغلاق تأكيد العميل"
            />
            <section className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-black text-slate-950">تأكيد مع العميل</h3>
                  <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                    راجع النقاط التالية مع العميل قبل التأكيد.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomerConfirmationOpen(false)}
                  disabled={isConfirmingCustomer}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 disabled:opacity-50"
                  aria-label="إغلاق"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {CUSTOMER_CONFIRMATION_CHECKLIST.map((item) => (
                  <div key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <p className="text-xs font-bold leading-5 text-slate-700">{item}</p>
                  </div>
                ))}
              </div>

              {customerConfirmationError ? (
                <p className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-bold text-red-700">
                  {customerConfirmationError}
                </p>
              ) : null}

              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setCustomerConfirmationOpen(false)}
                  disabled={isConfirmingCustomer}
                  className="h-10 rounded-xl bg-slate-100 text-xs font-black text-slate-700 disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={confirmWithCustomer}
                  disabled={isConfirmingCustomer}
                  className="h-10 rounded-xl bg-emerald-600 text-xs font-black text-white transition-colors hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
                >
                  {isConfirmingCustomer ? 'جاري التأكيد...' : 'تأكيد مع العميل'}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {sendConfirmationOpen ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/30 p-4" dir="rtl">
            <button
              type="button"
              className="absolute inset-0"
              onClick={() => {
                if (!isSendingToProcessor) setSendConfirmationOpen(false);
              }}
              aria-label="إغلاق تأكيد الإرسال"
            />
            <section className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-black text-slate-950">إرسال للجهة</h3>
                  <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                    أنت على وشك تأكيد إرسال طلب الأوراق إلى:
                  </p>
                  <p className="mt-1 text-sm font-black text-blue-700">{processorName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSendConfirmationOpen(false)}
                  disabled={isSendingToProcessor}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 disabled:opacity-50"
                  aria-label="إغلاق"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {[
                  'تم التأكيد مع العميل.',
                  'تمت مراجعة بيانات صاحب الورق.',
                ].map((item) => (
                  <div key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                      <Check className="h-3.5 w-3.5" />
                    </span>
                    <p className="text-xs font-bold leading-5 text-slate-700">{item}</p>
                  </div>
                ))}
              </div>

              <label className="mt-4 block">
                <span className="text-[11px] font-black text-slate-600">ملاحظة الإرسال</span>
                <textarea
                  value={sendToProcessorNote}
                  onChange={(event) => setSendToProcessorNote(event.target.value)}
                  rows={3}
                  disabled={isSendingToProcessor}
                  placeholder="أضف ملاحظة اختيارية تظهر مع حدث الإرسال..."
                  className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold leading-5 text-slate-800 outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-4 focus:ring-emerald-50 disabled:opacity-60"
                />
              </label>

              {sendToProcessorError ? (
                <p className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-bold text-red-700">
                  {sendToProcessorError}
                </p>
              ) : null}

              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSendConfirmationOpen(false)}
                  disabled={isSendingToProcessor}
                  className="h-10 rounded-xl bg-slate-100 text-xs font-black text-slate-700 disabled:opacity-50"
                >
                  إلغاء
                </button>
                <button
                  type="button"
                  onClick={sendToProcessor}
                  disabled={isSendingToProcessor}
                  className="h-10 rounded-xl bg-emerald-600 text-xs font-black text-white transition-colors hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
                >
                  {isSendingToProcessor ? 'جاري الإرسال...' : 'إرسال للجهة'}
                </button>
              </div>
            </section>
          </div>
        ) : null}

        {processorOpen ? (
          <ProcessorSelector
            tenantId={tenantId}
            request={snapshot}
            currentProcessor={displayedProcessor}
            onClose={() => setProcessorOpen(false)}
            onChange={setProcessorOverride}
            onSaved={onSaved}
          />
        ) : null}
      </aside>
      {previewOpen ? <ImagesPreview request={snapshot} onClose={() => setPreviewOpen(false)} /> : null}
    </div>,
    document.body,
  );
}
