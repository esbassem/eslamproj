import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Building2, Camera, MoreVertical, PlusCircle, Search, Trash2, TriangleAlert, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/core/ui/dropdown-menu';
import { Input } from '@/core/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { showroomService } from '@/features/showroom/services/showroom.service';
import { partnersService } from '@/features/contacts/services/partners.service';
import { listTenantPhotos } from '@/features/photos/services/photosStorage.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const TRACKING_ATTACHMENT_TYPES = [
  { documentType: 'chassis_photo', cloudType: 'chassis', label: 'صورة رقم الشاسيه' },
  { documentType: 'engine_photo', cloudType: 'engine', label: 'صورة رقم الموتور' },
];

const IDENTITY_ATTACHMENT_TYPE = { documentType: 'identity_photo', label: 'صورة البطاقة' };

function getSaleCustomerName(sale) {
  return sale?.customer?.name || sale?.customer_name || 'عميل الفاتورة';
}

function getSaleCustomerPhone(sale) {
  return sale?.customer?.phone || sale?.customer?.phone1 || sale?.customer?.phone2 || sale?.customer_phone || '';
}

function getSaleLineTitle(line) {
  return line?.description || line?.productName || line?.product_name || 'منتج';
}

function getSaleLineAttributesText(line) {
  return Array.isArray(line?.configuredAttributes)
    ? line.configuredAttributes
      .map((attribute) => {
        const value = attribute?.value || attribute?.valueText || attribute?.value_text || '';
        return String(value).trim();
      })
      .filter(Boolean)
      .join(' - ')
    : '';
}

function getLineTrackingUnitId(line) {
  return line?.trackingUnit?.id || line?.tracking_unit_id || line?.trackingUnitId || null;
}

function getLineProcessorPartnerId(line) {
  const request = line?.paperworkRequest || line?.paperwork_request || null;
  return request?.processorPartnerId
    || request?.processor_partner_id
    || line?.trackingUnit?.paperworkProcessorPartnerId
    || line?.trackingUnit?.paperwork_processor_partner_id
    || line?.paperworkProcessorPartnerId
    || line?.paperwork_processor_partner_id
    || null;
}

function getLineProcessorPartnerName(line) {
  const request = line?.paperworkRequest || line?.paperwork_request || null;
  return request?.processor?.name
    || request?.processorPartner?.name
    || request?.processor_partner?.name
    || line?.trackingUnit?.paperworkProcessorPartner?.name
    || line?.trackingUnit?.paperwork_processor_partner?.name
    || '';
}

function hasLinePaperworkRequest(line) {
  return Boolean(line?.paperworkRequest || line?.paperwork_request);
}

function getSalePendingPaperworkLines(sale) {
  const lines = Array.isArray(sale?.lines) ? sale.lines : [];
  return lines.filter((line) => !hasLinePaperworkRequest(line));
}

function PaperworkOwnerSection({
  value,
  onChange,
  ownerName,
  onOwnerNameChange,
  guardianshipMode,
  onGuardianshipModeChange,
  identityPreviewUrl,
  onIdentitySelectRequest,
  onIdentityFileRemove,
}) {
  return (
    <section className="space-y-3">
        <AnimatePresence mode="wait" initial={false}>
          {value === 'later' ? (
            <motion.div
              key="paperwork-owner-later"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="border-y border-amber-200 bg-amber-50 px-1 py-3"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-black text-amber-950">الورق هيتعمل باسم مين؟</p>
                <button
                  type="button"
                  onClick={() => onChange('custom')}
                  className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-amber-300 bg-amber-100 px-3 text-xs font-black text-amber-900 transition hover:bg-amber-200 focus:outline-none focus:ring-4 focus:ring-amber-100"
                >
                  لاحقًا
                </button>
              </div>
              <p className="text-sm font-black text-amber-900">لن يتم البدء في إجراءات الأوراق إلا وقت الطلب.</p>
              <p className="mt-1 text-xs font-bold leading-5 text-amber-800">
                صاحب الورق غير محدد بعد، وسيظل الطلب في مرحلة تأكيد صاحب الورق لحين استكمال البيانات.
              </p>
            </motion.div>
          ) : (
            <motion.div
              key="paperwork-owner-details"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-4"
            >
              <div className="border-y border-slate-200 bg-slate-50 px-1 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-900">الورق هيتعمل باسم مين؟</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onOwnerNameChange('');
                      onIdentityFileRemove();
                      onChange('later');
                    }}
                    className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100"
                  >
                    لاحقًا
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-[8rem_minmax(0,1fr)] items-start gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
                  {identityPreviewUrl ? (
                  <div className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                    <button
                      type="button"
                      onClick={onIdentitySelectRequest}
                      className="absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-xl bg-white/95 text-slate-600 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-slate-100"
                      aria-label="تغيير صورة البطاقة"
                      title="تغيير صورة البطاقة"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={onIdentityFileRemove}
                      className="absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-xl bg-white/95 text-red-600 shadow-sm ring-1 ring-red-100 transition hover:bg-red-50 focus:outline-none focus:ring-4 focus:ring-red-100"
                      aria-label="حذف صورة البطاقة"
                      title="حذف صورة البطاقة"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <img
                      src={identityPreviewUrl}
                      alt="صورة البطاقة"
                      className="aspect-[5/3] w-full object-cover"
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={onIdentitySelectRequest}
                    className="flex h-24 w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white text-slate-600 transition hover:border-blue-300 hover:bg-blue-50/40 focus:outline-none focus:ring-4 focus:ring-blue-50"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100">
                      <PlusCircle className="h-5 w-5" />
                    </span>
                    <span className="text-xs font-black">إضافة صورة البطاقة</span>
                  </button>
                  )}
                  <div className="min-w-0 space-y-3">
                    <Input
                      value={ownerName}
                      onChange={(event) => {
                        onOwnerNameChange(event.target.value);
                        if (event.target.value.trim()) onChange('custom');
                      }}
                      placeholder="اسم صاحب الورق"
                      className="h-11 rounded-xl border-slate-200 bg-white text-base font-black text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-100 sm:text-sm"
                    />
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: 'father_guardian', label: 'وصاية والده' },
                        { id: 'mother_guardian', label: 'وصاية والدته' },
                        { id: 'none', label: 'بدون' },
                      ].map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => onGuardianshipModeChange(option.id)}
                          className={`inline-flex h-9 min-w-0 items-center justify-center whitespace-nowrap rounded-lg border px-1.5 text-[10px] font-black transition focus:outline-none focus:ring-4 sm:px-2 sm:text-[11px] ${
                            guardianshipMode === option.id
                              ? 'border-sky-300 bg-sky-50 text-sky-800 focus:ring-sky-100'
                              : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:ring-slate-100'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
    </section>
  );
}

function ProcessorSelector({ tenantId, currentProcessor, selectedProcessor, onClose, onSelect }) {
  const [options, setOptions] = useState([]);
  const [status, setStatus] = useState('loading');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [pendingOption, setPendingOption] = useState(null);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setError('');

    partnersService.getPaperworkProcessorOptions({ tenantId })
      .then((rows) => {
        if (!active) return;
        setOptions(rows || []);
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

  const currentId = currentProcessor?.id || selectedProcessor?.id || '';

  return (
    <div className="absolute inset-0 z-30 flex items-end bg-slate-950/25 sm:items-center sm:justify-center" dir="rtl">
      <button type="button" className="absolute inset-0" onClick={onClose} aria-label="إغلاق اختيار الجهة" />
      <section className="relative max-h-[78%] w-full overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:w-[26rem] sm:rounded-2xl sm:border sm:border-slate-200">
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
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="بحث بالاسم أو الهاتف"
                className="h-10 min-w-0 flex-1 bg-transparent text-sm font-bold outline-none"
              />
            </label>
          </div>
        ) : null}

        <div className="max-h-[58dvh] overflow-y-auto p-2">
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
                  onClick={() => {
                    onSelect(pendingOption);
                    onClose();
                  }}
                  className="h-11 rounded-xl bg-blue-600 text-sm font-black text-white"
                >
                  تأكيد الاختيار
                </button>
                <button
                  type="button"
                  onClick={() => setPendingOption(null)}
                  className="h-11 rounded-xl bg-slate-100 text-sm font-black text-slate-700"
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
            filteredOptions.map((option) => {
              const isCurrent = currentId === option.id;

              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPendingOption(option)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-right hover:bg-blue-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-slate-950">{option.name}</span>
                    <span className="mt-0.5 block truncate text-[11px] font-bold text-slate-500">
                      {[option.subtitle, option.parentName ? `تابع لـ ${option.parentName}` : '', option.phone].filter(Boolean).join(' - ')}
                    </span>
                  </span>
                  <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${isCurrent ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`} />
                </button>
              );
            })
          ) : (
            <p className="px-3 py-8 text-center text-sm font-bold text-slate-400">لا توجد جهات مطابقة.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function TrackingAttachmentPickerSheet({
  open,
  onOpenChange,
  tenantId,
  targetType,
  onCameraFile,
  onCloudPhoto,
  isSaving,
  error,
}) {
  const cameraInputRef = useRef(null);
  const localInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraCanvasRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const [cameraStatus, setCameraStatus] = useState('idle');
  const [cameraError, setCameraError] = useState('');
  const [libraryStatus, setLibraryStatus] = useState('idle');
  const [libraryPhotos, setLibraryPhotos] = useState([]);
  const [libraryError, setLibraryError] = useState('');

  useEffect(() => {
    let mounted = true;
    if (!open || !tenantId) return undefined;

    setLibraryStatus('loading');
    setLibraryPhotos([]);
    setLibraryError('');

    listTenantPhotos({ tenantId })
      .then((photos) => {
        if (!mounted) return;
        setLibraryPhotos(photos || []);
        setLibraryStatus('ready');
      })
      .catch((loadError) => {
        if (!mounted) return;
        setLibraryPhotos([]);
        setLibraryStatus('error');
        setLibraryError(loadError.message || 'تعذر تحميل صور السحابة.');
      });

    return () => {
      mounted = false;
    };
  }, [open, tenantId]);

  useEffect(() => {
    let cancelled = false;

    const stopCamera = () => {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
      }
    };

    if (!open) {
      stopCamera();
      setCameraStatus('idle');
      setCameraError('');
      return undefined;
    }

    if (typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches) {
      stopCamera();
      setCameraStatus('idle');
      setCameraError('');
      return undefined;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setCameraStatus('error');
      setCameraError('معاينة الكاميرا تحتاج فتح التطبيق من رابط HTTPS الآمن.');
      return undefined;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('error');
      setCameraError('المتصفح لا يدعم معاينة الكاميرا المباشرة.');
      return undefined;
    }

    setCameraStatus('loading');
    setCameraError('');

    navigator.mediaDevices
      .getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          cameraVideoRef.current.play?.().catch(() => {});
        }
        setCameraStatus('ready');
      })
      .catch((streamError) => {
        if (cancelled) return;
        setCameraStatus('error');
        setCameraError(streamError.message || 'تعذر تشغيل معاينة الكاميرا.');
      });

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setLibraryStatus('idle');
      setLibraryPhotos([]);
      setLibraryError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open || cameraStatus !== 'ready' || !cameraVideoRef.current || !cameraStreamRef.current) return;
    cameraVideoRef.current.srcObject = cameraStreamRef.current;
    cameraVideoRef.current.play?.().catch(() => {});
  }, [cameraStatus, open]);

  const captureCameraFrame = useCallback(() => {
    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;

    if (!video || !canvas || cameraStatus !== 'ready') {
      cameraInputRef.current?.click();
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context?.drawImage(video, 0, 0, width, height);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const fileName = `${targetType?.documentType || 'tracking-photo'}-${Date.now()}.jpg`;
      onCameraFile?.(new File([blob], fileName, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  }, [cameraStatus, onCameraFile, targetType?.documentType]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="z-[90] mx-auto max-h-[92vh] w-full max-w-md overflow-hidden rounded-t-[24px] md:bottom-auto md:left-1/2 md:right-auto md:top-1/2 md:w-[min(92vw,720px)] md:max-w-none md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px] md:border md:border-slate-200"
        dir="rtl"
      >
        <SheetDismissButton />
        <SheetHeader className="border-b-0 pl-16 text-right">
          <SheetTitle>{targetType?.label || 'اختيار صورة'}</SheetTitle>
        </SheetHeader>
        <SheetBody className="max-h-[calc(92vh-96px)] space-y-4 overflow-y-auto px-4 pb-5 pt-1 md:max-h-[70vh]">
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">
              {error}
            </div>
          ) : null}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.target.value = '';
              if (file) onCameraFile?.(file);
            }}
          />
          <input
            ref={localInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.target.value = '';
              if (file) onCameraFile?.(file);
            }}
          />
          <canvas ref={cameraCanvasRef} className="hidden" />

          <section className="md:hidden">
            <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 shadow-[0_18px_42px_-24px_rgba(15,23,42,0.75)]">
              {cameraStatus === 'ready' ? (
                <video
                  ref={cameraVideoRef}
                  playsInline
                  muted
                  autoPlay
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 bg-slate-100 px-5 text-center">
                  <Camera className="h-8 w-8 text-slate-500" />
                  <p className="text-sm font-black text-slate-700">
                    {cameraStatus === 'loading' ? 'جاري تشغيل الكاميرا...' : 'معاينة الكاميرا غير متاحة'}
                  </p>
                  {cameraError ? <p className="text-xs font-bold leading-5 text-slate-500">{cameraError}</p> : null}
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-slate-950/75 via-slate-950/25 to-transparent" />
              <div className="absolute inset-x-3 bottom-3 flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={captureCameraFrame}
                  disabled={isSaving || cameraStatus !== 'ready'}
                  className="inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-2xl bg-white px-4 text-sm font-black text-slate-950 shadow-[0_12px_30px_rgba(15,23,42,0.38)] ring-1 ring-white/70 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Camera className="h-5 w-5" />
                  {isSaving ? 'جاري الحفظ...' : 'التقاط الصورة'}
                </button>
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  disabled={isSaving}
                  className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-2xl border border-white/30 bg-slate-950/70 px-3 text-xs font-black text-white shadow-[0_12px_28px_rgba(15,23,42,0.34)] backdrop-blur-md transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Camera className="h-4 w-4" />
                  فتح الكاميرا
                </button>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-sm font-black text-slate-950">حدد من الصور الموجوده</p>
              {libraryStatus === 'loading' ? <span className="text-xs font-bold text-slate-400">تحميل...</span> : null}
            </div>
            {libraryStatus === 'error' ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">
                {libraryError}
              </div>
            ) : libraryPhotos.length || libraryStatus === 'ready' ? (
              <div className="grid grid-cols-3 gap-2 md:grid-cols-5">
                <button
                  type="button"
                  onClick={() => localInputRef.current?.click()}
                  disabled={isSaving}
                  className="flex aspect-square flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white text-center transition hover:border-blue-300 hover:bg-blue-50/40 hover:ring-4 hover:ring-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="اختيار صورة من الجهاز"
                  title="اختيار صورة من الجهاز"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                    <PlusCircle className="h-5 w-5" />
                  </span>
                  <span className="px-2 text-[10px] font-black leading-4 text-slate-600">من الجهاز</span>
                </button>
                {libraryPhotos.map((photo) => (
                  <button
                    key={photo.path}
                    type="button"
                    onClick={() => onCloudPhoto?.(photo)}
                    disabled={isSaving}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-right transition hover:border-blue-300 hover:ring-4 hover:ring-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="aspect-square bg-slate-100">
                      {photo.signedUrl ? (
                        <img src={photo.signedUrl} alt={photo.name} className="h-full w-full object-cover" loading="lazy" />
                      ) : null}
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="truncate text-[10px] font-black text-slate-900">{photo.name}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm font-black text-slate-400">
                لا توجد صور مناسبة محفوظة في السحابة.
              </div>
            )}
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export function PaperworkRequestPromptSheet({ open, sale, onOpenChange, onSaved, onIgnored }) {
  const { tenant } = useWorkspace();
  const lines = useMemo(() => getSalePendingPaperworkLines(sale), [sale]);
  const [selectedLine, setSelectedLine] = useState(() => (lines.length === 1 ? lines[0] : null));
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [attachmentPickerType, setAttachmentPickerType] = useState(null);
  const [isIdentityPickerOpen, setIsIdentityPickerOpen] = useState(false);
  const [attachmentPickerError, setAttachmentPickerError] = useState('');
  const [trackingAttachmentDrafts, setTrackingAttachmentDrafts] = useState({});
  const trackingPreviewUrlsRef = useRef(new Map());
  const [paperworkOwnerMode, setPaperworkOwnerMode] = useState('custom');
  const [paperworkOwnerName, setPaperworkOwnerName] = useState('');
  const [paperworkOwnerGuardianshipMode, setPaperworkOwnerGuardianshipMode] = useState('');
  const [paperworkOwnerIdentityFile, setPaperworkOwnerIdentityFile] = useState(null);
  const [paperworkOwnerIdentitySource, setPaperworkOwnerIdentitySource] = useState(null);
  const [paperworkOwnerIdentityCloudUrl, setPaperworkOwnerIdentityCloudUrl] = useState('');
  const [paperworkOwnerIdentityPreviewUrl, setPaperworkOwnerIdentityPreviewUrl] = useState('');
  const [selectedProcessorId, setSelectedProcessorId] = useState('');
  const [selectedProcessorOption, setSelectedProcessorOption] = useState(null);
  const [isProcessorSelectorOpen, setIsProcessorSelectorOpen] = useState(false);
  const [paperworkSaveError, setPaperworkSaveError] = useState('');
  const [isPaperworkSaving, setIsPaperworkSaving] = useState(false);
  const [isIgnoreWarningOpen, setIsIgnoreWarningOpen] = useState(false);
  const closeTimerRef = useRef(null);
  const openFrameRef = useRef(null);
  const hasSingleLine = lines.length === 1;

  useEffect(() => {
    const initialLine = lines.length === 1 ? lines[0] : null;
    setSelectedLine(initialLine);
    setAttachmentPickerType(null);
    setIsIdentityPickerOpen(false);
    setAttachmentPickerError('');
    trackingPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    trackingPreviewUrlsRef.current.clear();
    setTrackingAttachmentDrafts({});
    setPaperworkOwnerMode('custom');
    setPaperworkOwnerName('');
    setPaperworkOwnerGuardianshipMode('');
    setPaperworkOwnerIdentityFile(null);
    setPaperworkOwnerIdentitySource(null);
    setPaperworkOwnerIdentityCloudUrl('');
    setSelectedProcessorId('');
    setSelectedProcessorOption(null);
    setIsProcessorSelectorOpen(false);
    setPaperworkSaveError('');
    setIsPaperworkSaving(false);
    setIsIgnoreWarningOpen(false);
  }, [sale?.id]);

  useEffect(() => {
    window.clearTimeout(closeTimerRef.current);
    if (openFrameRef.current) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }

    if (open) {
      setMounted(true);
      setVisible(false);
      openFrameRef.current = window.requestAnimationFrame(() => {
        openFrameRef.current = window.requestAnimationFrame(() => {
          setVisible(true);
          openFrameRef.current = null;
        });
      });
    } else {
      setVisible(false);
      setAttachmentPickerType(null);
      setIsIdentityPickerOpen(false);
      setIsIgnoreWarningOpen(false);
      closeTimerRef.current = window.setTimeout(() => setMounted(false), 240);
    }

    return () => {
      window.clearTimeout(closeTimerRef.current);
      if (openFrameRef.current) {
        window.cancelAnimationFrame(openFrameRef.current);
        openFrameRef.current = null;
      }
    };
  }, [open]);

  useEffect(() => () => {
    trackingPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    trackingPreviewUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    trackingPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    trackingPreviewUrlsRef.current.clear();
    setTrackingAttachmentDrafts({});
    setAttachmentPickerType(null);
    setAttachmentPickerError('');
    setSelectedProcessorId(getLineProcessorPartnerId(selectedLine) || '');
    setSelectedProcessorOption(null);
    setIsProcessorSelectorOpen(false);
  }, [selectedLine?.id]);

  useEffect(() => {
    if (!paperworkOwnerIdentityFile) {
      setPaperworkOwnerIdentityPreviewUrl(paperworkOwnerIdentityCloudUrl || '');
      return undefined;
    }

    const previewUrl = URL.createObjectURL(paperworkOwnerIdentityFile);
    setPaperworkOwnerIdentityPreviewUrl(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [paperworkOwnerIdentityCloudUrl, paperworkOwnerIdentityFile]);

  const getDisplayedTrackingAttachment = useCallback((documentType) => {
    if (Object.prototype.hasOwnProperty.call(trackingAttachmentDrafts, documentType)) {
      return trackingAttachmentDrafts[documentType];
    }
    return selectedLine?.attachments?.[documentType] || null;
  }, [selectedLine, trackingAttachmentDrafts]);

  const selectTrackingFile = (typeOrFile, maybeFile) => {
    const targetType = maybeFile ? typeOrFile : attachmentPickerType;
    const file = maybeFile || typeOrFile;
    if (!targetType?.documentType || !file) return;
    const previousUrl = trackingPreviewUrlsRef.current.get(targetType.documentType);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const previewUrl = URL.createObjectURL(file);
    trackingPreviewUrlsRef.current.set(targetType.documentType, previewUrl);
    setAttachmentPickerError('');
    setTrackingAttachmentDrafts((current) => ({
      ...current,
      [targetType.documentType]: {
        documentType: targetType.documentType,
        signedUrl: previewUrl,
        name: file.name || targetType.label,
        pendingFile: file,
      },
    }));
    setAttachmentPickerType(null);
  };

  const selectTrackingCloudPhoto = (typeOrPhoto, maybePhoto) => {
    const targetType = maybePhoto ? typeOrPhoto : attachmentPickerType;
    const photo = maybePhoto || typeOrPhoto;
    if (!targetType?.documentType || !photo?.signedUrl) return;
    const previousUrl = trackingPreviewUrlsRef.current.get(targetType.documentType);
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      trackingPreviewUrlsRef.current.delete(targetType.documentType);
    }
    setAttachmentPickerError('');
    setTrackingAttachmentDrafts((current) => ({
      ...current,
      [targetType.documentType]: {
        documentType: targetType.documentType,
        signedUrl: photo.signedUrl,
        name: photo.name || targetType.label,
        pendingSource: photo,
      },
    }));
    setAttachmentPickerType(null);
  };

  const removeTrackingAttachment = (type) => {
    if (!type?.documentType) return;
    const previousUrl = trackingPreviewUrlsRef.current.get(type.documentType);
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      trackingPreviewUrlsRef.current.delete(type.documentType);
    }
    setAttachmentPickerError('');
    setTrackingAttachmentDrafts((current) => ({
      ...current,
      [type.documentType]: null,
    }));
  };

  const saveTrackingAttachmentDrafts = async () => {
    const draftEntries = Object.entries(trackingAttachmentDrafts);
    if (!draftEntries.length) return;

    const trackingUnitId = getLineTrackingUnitId(selectedLine);
    if (!trackingUnitId) {
      throw new Error('تعذر تحديد القطعة الفريدة المرتبطة بهذا المنتج.');
    }

    for (const [documentType, draft] of draftEntries) {
      const currentAttachment = selectedLine?.attachments?.[documentType] || null;

      if (!draft) {
        if (currentAttachment?.id) {
          await showroomService.removeTrackingUnitAttachment({
            tenantId: tenant?.id,
            trackingUnitId,
            attachmentId: currentAttachment.id,
          });
        }
        continue;
      }

      if (draft.pendingFile) {
        await showroomService.saveTrackingUnitAttachment({
          tenantId: tenant?.id,
          trackingUnitId,
          documentType,
          file: draft.pendingFile,
        });
      } else if (draft.pendingSource) {
        await showroomService.linkExistingTrackingUnitAttachment({
          tenantId: tenant?.id,
          trackingUnitId,
          documentType,
          source: draft.pendingSource,
        });
      }

      if (currentAttachment?.id) {
        await showroomService.removeTrackingUnitAttachment({
          tenantId: tenant?.id,
          trackingUnitId,
          attachmentId: currentAttachment.id,
        });
      }
    }
  };

  const selectIdentityFile = useCallback((file) => {
    if (!file) return;
    setPaperworkOwnerIdentitySource(null);
    setPaperworkOwnerIdentityCloudUrl('');
    setPaperworkOwnerIdentityFile(file);
    setIsIdentityPickerOpen(false);
  }, []);

  const selectIdentityCloudPhoto = useCallback((photo) => {
    if (!photo?.signedUrl) return;
    setPaperworkOwnerIdentityFile(null);
    setPaperworkOwnerIdentitySource(photo);
    setPaperworkOwnerIdentityCloudUrl(photo.signedUrl);
    setIsIdentityPickerOpen(false);
  }, []);

  const removeIdentityPhoto = useCallback(() => {
    setPaperworkOwnerIdentityFile(null);
    setPaperworkOwnerIdentitySource(null);
    setPaperworkOwnerIdentityCloudUrl('');
    setPaperworkOwnerIdentityPreviewUrl('');
  }, []);

  const hasOwnerDetails = paperworkOwnerMode === 'later'
    || (
      Boolean(paperworkOwnerName.trim())
      && Boolean(paperworkOwnerGuardianshipMode)
      && Boolean(paperworkOwnerIdentityPreviewUrl)
    );
  const currentProcessorId = getLineProcessorPartnerId(selectedLine);
  const currentProcessorName = getLineProcessorPartnerName(selectedLine);
  const displayedProcessorName = currentProcessorName || selectedProcessorOption?.name || '';
  const canConfirmPaperworkRequest = Boolean(selectedLine) && hasOwnerDetails;

  const savePaperworkRequest = async () => {
    if (!selectedLine || !canConfirmPaperworkRequest) return;

    setIsPaperworkSaving(true);
    setPaperworkSaveError('');

    try {
      const savedRequest = await showroomService.savePaperworkOwnerConfirmation({
        tenantId: tenant?.id,
        sale,
        item: selectedLine,
        ownerStatus: paperworkOwnerMode === 'later' ? 'later' : 'confirmed',
        ownerName: paperworkOwnerMode === 'later' ? '' : paperworkOwnerName,
        ownerNationalId: '',
        ownerNote: paperworkOwnerGuardianshipMode ? `حالة الوصاية: ${paperworkOwnerGuardianshipMode}` : '',
        identityFile: paperworkOwnerIdentityFile,
        identitySource: paperworkOwnerIdentitySource,
        trackingPhotosIgnored: false,
        trackingPhotosIgnoreReason: '',
        processorPartnerId: selectedProcessorId || currentProcessorId || null,
      });
      await saveTrackingAttachmentDrafts();
      onSaved?.({
        saleId: sale?.id || selectedLine?.sale_id || selectedLine?.saleId || null,
        saleLineId: selectedLine?.id || null,
        paperworkRequest: savedRequest,
      });
    } catch (saveError) {
      setPaperworkSaveError(saveError?.message || 'تعذر حفظ طلب الأوراق.');
    } finally {
      setIsPaperworkSaving(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <>
    <div className={`fixed inset-0 z-[60] ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`} dir="rtl">
      <button
        type="button"
        className={`absolute inset-0 bg-slate-950/30 transition-opacity duration-200 ease-out ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={() => {}}
        aria-label="خلفية نافذة طلب الأوراق"
      />
      <aside
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-hidden border-l border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] will-change-transform transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] md:max-w-lg ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="تحديد طلب أوراق الملكية"
      >
        <header className="relative shrink-0 bg-gradient-to-br from-[#0f5f9f] via-[#0d76b7] to-[#0b4f86] px-5 py-5 pl-12 text-right text-white">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/12 text-amber-100 ring-1 ring-white/20">
              <TriangleAlert className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase text-blue-100/85">Ownership Paperwork</p>
              <h2 className="mt-1 text-xl font-black leading-7 text-white md:text-2xl">
                تحديد طلب اوراق الملكيه
              </h2>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-blue-100/70">المنتج</p>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <p className="min-w-0 truncate text-sm font-black text-white" title={selectedLine ? getSaleLineTitle(selectedLine) : 'حدد منتجًا'}>
                      {selectedLine ? getSaleLineTitle(selectedLine) : 'حدد منتجًا'}
                    </p>
                    {selectedLine && getSaleLineAttributesText(selectedLine) ? (
                      <span className="min-w-0 shrink truncate rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-black text-blue-50 ring-1 ring-white/15">
                        {getSaleLineAttributesText(selectedLine)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs font-bold text-blue-100/75">
                    {selectedLine
                      ? selectedLine.trackingUnit?.trackingNumber
                        || selectedLine.serialNumber
                        || selectedLine.trackingIdentifiers?.[0]?.value
                        || 'بدون بيانات تتبع ظاهرة'
                      : `${lines.length || 0} منتج داخل الفاتورة`}
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black text-blue-100/70">عميل الفاتورة</p>
                  <p className="mt-1 truncate text-sm font-black text-white" title={getSaleCustomerName(sale)}>
                    {getSaleCustomerName(sale)}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs font-bold text-blue-100/75" dir="ltr">
                    {getSaleCustomerPhone(sale) || 'بدون رقم هاتف'}
                  </p>
                </div>
              </div>
            </div>
          </div>
          {selectedLine ? (
            <button
              type="button"
              disabled={hasSingleLine}
              onClick={() => setSelectedLine(null)}
              className="absolute bottom-5 right-5 flex h-9 w-9 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/15 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="الرجوع للمنتجات"
              title="الرجوع للمنتجات"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <AnimatePresence mode="wait" initial={false}>
            {selectedLine ? (
              <motion.section
                key="paperwork-line-details"
                initial={{ opacity: 0, x: -24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-5"
              >
                <motion.div
                  key="paperwork-owner-step"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-5"
                >
                      <div className="border-y border-slate-200 bg-slate-50 px-1 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-[13px] font-black text-slate-900">صورة رقم الشاسيه والموتور</p>
                        </div>
                        <motion.div
                          key="tracking-photos-required"
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                          className="mt-3 flex gap-2"
                        >
                          {TRACKING_ATTACHMENT_TYPES.map((type) => {
                            const attachment = getDisplayedTrackingAttachment(type.documentType);

                            return (
                              <div
                                key={type.documentType}
                                className={`group relative w-24 overflow-hidden rounded-xl border bg-white shadow-sm transition ${
                                  attachment?.signedUrl
                                    ? 'border-slate-200 hover:border-emerald-200 hover:shadow-md'
                                    : 'cursor-pointer border-dashed border-slate-300 hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-md'
                                }`}
                                title={type.label}
                                role={attachment?.signedUrl ? undefined : 'button'}
                                tabIndex={attachment?.signedUrl ? undefined : 0}
                                onClick={() => {
                                  if (!attachment?.signedUrl) setAttachmentPickerType(type);
                                }}
                                onKeyDown={(event) => {
                                  if (!attachment?.signedUrl && (event.key === 'Enter' || event.key === ' ')) {
                                    event.preventDefault();
                                    setAttachmentPickerType(type);
                                  }
                                }}
                              >
                                {attachment?.signedUrl ? (
                                  <a
                                    href={attachment.signedUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="block aspect-[4/3] w-full bg-slate-100"
                                  >
                                    <img
                                      src={attachment.signedUrl}
                                      alt={type.label}
                                      className="h-full w-full object-cover"
                                      loading="lazy"
                                    />
                                  </a>
                                ) : (
                                  <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 bg-slate-50 text-slate-400">
                                    <Camera className="h-5 w-5" />
                                    <span className="px-2 text-center text-[10px] font-black leading-4">اضغط للتحديد</span>
                                  </div>
                                )}
                                {attachment?.signedUrl ? (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        className="absolute left-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-lg bg-white/95 text-slate-600 opacity-90 shadow-sm ring-1 ring-slate-100 transition hover:bg-slate-50 hover:text-slate-950 hover:opacity-100 focus:outline-none focus:ring-4 focus:ring-slate-100"
                                        aria-label={`خيارات ${type.label}`}
                                        title="خيارات الصورة"
                                      >
                                        <MoreVertical className="h-3.5 w-3.5" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="min-w-40 rounded-xl">
                                      <DropdownMenuItem onSelect={() => setAttachmentPickerType(type)} className="gap-2 font-bold">
                                        <span>تغيير الصورة</span>
                                        <Camera className="h-4 w-4 text-slate-500" />
                                      </DropdownMenuItem>
                                      <DropdownMenuItem
                                        onSelect={() => removeTrackingAttachment(type)}
                                        className="gap-2 font-bold text-red-600 focus:bg-red-50 focus:text-red-700"
                                      >
                                        <span>حذف الصورة</span>
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                ) : null}
                              </div>
                            );
                          })}
                        </motion.div>
                      </div>
                      <PaperworkOwnerSection
                        value={paperworkOwnerMode}
                        onChange={setPaperworkOwnerMode}
                        ownerName={paperworkOwnerName}
                        onOwnerNameChange={setPaperworkOwnerName}
                        guardianshipMode={paperworkOwnerGuardianshipMode}
                        onGuardianshipModeChange={setPaperworkOwnerGuardianshipMode}
                        identityPreviewUrl={paperworkOwnerIdentityPreviewUrl}
                        onIdentitySelectRequest={() => setIsIdentityPickerOpen(true)}
                        onIdentityFileRemove={removeIdentityPhoto}
                        sale={sale}
                      />
                      <section className="border-y border-slate-200 bg-slate-50 px-1 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-black text-slate-900">جهة إصدار الورق</p>
                          </div>
                          {currentProcessorId || selectedProcessorId ? (
                            <span className="max-w-full rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-black text-blue-700 ring-1 ring-blue-100">
                              محددة
                            </span>
                          ) : (
                            <span className="rounded-xl bg-red-50 px-3 py-1.5 text-xs font-black text-red-700 ring-1 ring-red-100">
                              غير محددة
                            </span>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => setIsProcessorSelectorOpen(true)}
                          className={`mt-3 flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-3 text-right transition focus:outline-none focus:ring-4 ${
                            currentProcessorId || selectedProcessorId
                              ? 'border-blue-100 bg-white text-blue-900 hover:bg-blue-50/60 focus:ring-blue-100'
                              : 'border-dashed border-red-200 bg-white text-red-900 hover:bg-red-50/70 focus:ring-red-100'
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${currentProcessorId || selectedProcessorId ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                              <Building2 className="h-5 w-5" />
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-black">
                                {displayedProcessorName || 'اختر جهة إصدار الورق'}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] font-bold opacity-60">
                                {currentProcessorId || selectedProcessorId ? 'اضغط للتغيير' : 'لم يتم تحديد الجهة بعد'}
                              </span>
                            </span>
                          </span>
                          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-500">
                            اختيار
                          </span>
                        </button>
                      </section>
                </motion.div>
              </motion.section>
            ) : (
              <motion.section
                key="paperwork-lines-list"
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="space-y-4"
              >
                <div className="flex items-center justify-between gap-3 px-1">
                  <p className="text-sm font-black text-slate-950">المنتجات داخل الفاتورة</p>
                </div>

                {lines.length ? (
                  <div className="border-y border-slate-200">
                    {lines.map((line) => {
                      const attributesText = getSaleLineAttributesText(line);

                      return (
                        <button
                          key={line.id || `${line.sale_id}-${line.description}`}
                          type="button"
                          onClick={() => {
                            setSelectedLine(line);
                          }}
                          className="block w-full border-b border-slate-200 bg-white px-1 py-3 text-right transition last:border-b-0 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-blue-100"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-black text-slate-950">
                                <span className="truncate">{getSaleLineTitle(line)}</span>
                                {attributesText ? (
                                  <span className="min-w-0 truncate rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">
                                    {attributesText}
                                  </span>
                                ) : null}
                              </p>
                              <p className="mt-1 text-xs font-bold text-slate-500">
                                {line.trackingUnit?.trackingNumber || line.serialNumber || line.trackingIdentifiers?.[0]?.value || 'بدون رقم تتبع ظاهر'}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-700">
                              يحتاج تحديد
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-4 py-7 text-center text-sm font-bold text-slate-500">
                    لا توجد منتجات ظاهرة على آخر فاتورة.
                  </div>
                )}
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        <footer className="block shrink-0 space-y-3 border-t border-slate-200 bg-white/95 px-5 py-4">
          {paperworkSaveError ? (
            <div className="border-y border-red-200 bg-red-50 px-1 py-2 text-xs font-black text-red-700">
              {paperworkSaveError}
            </div>
          ) : null}
          <div className="grid grid-cols-[0.85fr_1.15fr] gap-2">
            <button
              type="button"
              onClick={() => setIsIgnoreWarningOpen(true)}
              disabled={isPaperworkSaving}
              className="inline-flex h-12 items-center justify-center rounded-xl border border-amber-200 bg-white px-2 text-xs font-black text-amber-800 transition hover:bg-amber-100/70 focus:outline-none focus:ring-4 focus:ring-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              تجاهل
            </button>
            <button
              type="button"
              onClick={savePaperworkRequest}
              disabled={!canConfirmPaperworkRequest || isPaperworkSaving}
              className="inline-flex h-12 items-center justify-center rounded-xl bg-blue-700 px-5 text-sm font-black text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              {isPaperworkSaving ? 'جاري الحفظ...' : 'تأكيد'}
            </button>
          </div>
        </footer>

        {isProcessorSelectorOpen ? (
          <ProcessorSelector
            tenantId={tenant?.id}
            currentProcessor={currentProcessorId ? { id: currentProcessorId, name: currentProcessorName || 'جهة إصدار محددة' } : null}
            selectedProcessor={selectedProcessorOption}
            onClose={() => setIsProcessorSelectorOpen(false)}
            onSelect={(option) => {
              setSelectedProcessorId(option.id);
              setSelectedProcessorOption(option);
            }}
          />
        ) : null}

      </aside>
    </div>
    <Dialog.Root
      open={isIgnoreWarningOpen}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setIsIgnoreWarningOpen(true);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-slate-950/55 backdrop-blur-sm" />
        <Dialog.Content
          dir="rtl"
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onEscapeKeyDown={(event) => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[81] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-amber-200 bg-white p-5 text-right shadow-[0_28px_80px_rgba(15,23,42,0.32)] outline-none"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
              <TriangleAlert className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <Dialog.Title className="text-base font-black text-slate-950">
                مسؤولية تجاهل طلب الأوراق
              </Dialog.Title>
              <Dialog.Description className="mt-2 text-sm font-bold leading-6 text-slate-600">
                تجاهل هذه الخطوة يعني أن طلب أوراق الملكية لم يتم تسجيله الآن، وقد يؤدي ذلك إلى نقص بيانات الورق أو تأخير المتابعة بعد البيع. يمكنك الرجوع واستكمال البيانات لضمان حفظ الطلب بشكل صحيح.
              </Dialog.Description>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setIsIgnoreWarningOpen(false)}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-blue-700 px-3 text-xs font-black text-white transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-100"
            >
              العودة للاستكمال
            </button>
            <button
              type="button"
              onClick={() => {
                setIsIgnoreWarningOpen(false);
                onIgnored?.(sale);
              }}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-black text-amber-900 transition hover:bg-amber-100 focus:outline-none focus:ring-4 focus:ring-amber-100"
            >
              تجاهل والخروج
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    <TrackingAttachmentPickerSheet
      open={Boolean(attachmentPickerType)}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) setAttachmentPickerType(null);
      }}
      tenantId={tenant?.id}
      targetType={attachmentPickerType}
      onCameraFile={selectTrackingFile}
      onCloudPhoto={selectTrackingCloudPhoto}
      isSaving={false}
      error={attachmentPickerError}
    />
    <TrackingAttachmentPickerSheet
      open={isIdentityPickerOpen}
      onOpenChange={setIsIdentityPickerOpen}
      tenantId={tenant?.id}
      targetType={IDENTITY_ATTACHMENT_TYPE}
      onCameraFile={selectIdentityFile}
      onCloudPhoto={selectIdentityCloudPhoto}
      isSaving={false}
      error=""
    />
    </>,
    document.body,
  );
}
