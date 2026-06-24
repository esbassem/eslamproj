import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, Camera, CheckCircle2, MoreVertical, Pencil, PlusCircle, Power, RefreshCw, Store, Trash2, TriangleAlert } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/core/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/core/ui/dropdown-menu';
import { Input } from '@/core/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetFooter, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { ShowroomSalesCard } from '@/features/showroom/components/ShowroomSalesCard';
import { ShowroomInvoicesCard } from '@/features/showroom/components/ShowroomInvoicesCard';
import { ShowroomSaleViewSheet } from '@/features/showroom/components/ShowroomSaleViewSheet';
import { useShowroomConfig } from '@/features/showroom/context/ShowroomConfigContext';
import { showroomService } from '@/features/showroom/services/showroom.service';
import { listTenantPhotos } from '@/features/photos/services/photosStorage.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const EMPTY_CONFIG_DRAFT = {
  id: null,
  name: '',
  code: '',
  branchId: '',
  journalId: '',
  isActive: true,
};

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

function hasLinePaperworkRequest(line) {
  return Boolean(line?.paperworkRequest || line?.paperwork_request);
}

function getSalePendingPaperworkLines(sale) {
  const lines = Array.isArray(sale?.lines) ? sale.lines : [];
  return lines.filter((line) => !hasLinePaperworkRequest(line));
}

function InlineTrackingCameraFrame({ targetType, onCameraFile, isSaving }) {
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const stopCamera = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };

    stopCamera();
    setError('');

    if (!targetType) {
      setStatus('idle');
      return undefined;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setStatus('error');
      setError('معاينة الكاميرا تحتاج فتح التطبيق من رابط آمن HTTPS.');
      return undefined;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setError('المتصفح لا يدعم معاينة الكاميرا المباشرة.');
      return undefined;
    }

    setStatus('loading');

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

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play?.().catch(() => {});
        }
        setStatus('ready');
      })
      .catch((streamError) => {
        if (cancelled) return;
        setStatus('error');
        setError(streamError.message || 'تعذر تشغيل معاينة الكاميرا.');
      });

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [targetType?.documentType]);

  useEffect(() => {
    if (status !== 'ready' || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play?.().catch(() => {});
  }, [status]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || status !== 'ready') {
      inputRef.current?.click();
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const fileName = `${targetType?.documentType || 'tracking-photo'}-${Date.now()}.jpg`;
      onCameraFile?.(targetType, new File([blob], fileName, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  }, [onCameraFile, status, targetType]);

  if (!targetType) return null;

  return (
    <div className="mt-3 w-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0] || null;
          event.target.value = '';
          if (file) onCameraFile?.(targetType, file);
        }}
      />
      <canvas ref={canvasRef} className="hidden" />
      <div className="relative overflow-hidden bg-slate-950">
        {status === 'ready' ? (
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="aspect-[4/3] w-full object-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 bg-slate-100 px-5 text-center">
            <Camera className="h-8 w-8 text-slate-500" />
            <p className="text-sm font-black text-slate-700">
              {status === 'loading' ? 'جاري تشغيل الكاميرا...' : 'معاينة الكاميرا غير متاحة'}
            </p>
            {error ? <p className="text-xs font-bold leading-5 text-slate-500">{error}</p> : null}
          </div>
        )}
        <button
          type="button"
          onClick={captureFrame}
          disabled={isSaving}
          className="absolute bottom-4 left-4 inline-flex h-12 items-center gap-2 rounded-2xl border border-white/15 bg-slate-950/88 px-3.5 text-xs font-black text-white shadow-[0_18px_38px_rgba(15,23,42,0.36)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-slate-900 focus:outline-none focus:ring-4 focus:ring-white/25 disabled:cursor-not-allowed disabled:opacity-70"
          aria-label="التقاط الصورة"
          title="التقاط الصورة"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/12 text-white ring-1 ring-white/15">
            <Camera className="h-4 w-4" />
          </span>
          <span>التقاط</span>
        </button>
        {isSaving ? (
          <span className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-black text-slate-700 shadow-sm">
            جاري الحفظ...
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CloudTrackingPhotoPicker({ tenantId, targetType, onSelect, onLocalFile, isSaving }) {
  const fileInputRef = useRef(null);
  const [status, setStatus] = useState('idle');
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let mounted = true;

    if (!tenantId || !targetType) {
      setStatus('idle');
      setPhotos([]);
      setError('');
      return undefined;
    }

    setStatus('loading');
    setError('');

    listTenantPhotos({ tenantId })
      .then((items) => {
        if (!mounted) return;
        setPhotos(items || []);
        setStatus('ready');
      })
      .catch((loadError) => {
        if (!mounted) return;
        setPhotos([]);
        setStatus('error');
        setError(loadError.message || 'تعذر تحميل صور السحابة.');
      });

    return () => {
      mounted = false;
    };
  }, [reloadKey, targetType, tenantId]);

  if (!targetType) return null;

  return (
    <section className="mt-4 hidden md:block">
      {status === 'error' ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-xs font-black text-red-700">
          {error}
        </div>
      ) : status === 'loading' || photos.length ? (
        <div className="rounded-3xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-900">حدد من الصور الموجوده</p>
            </div>
            <button
              type="button"
              onClick={() => setReloadKey((current) => current + 1)}
              disabled={status === 'loading'}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:cursor-wait disabled:opacity-60"
              aria-label="إعادة تحميل الصور من السحابة"
              title="إعادة تحميل الصور من السحابة"
            >
              <RefreshCw className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              event.target.value = '';
              if (file) onLocalFile?.(targetType, file);
            }}
          />
          {status === 'loading' ? (
            <div className="flex min-h-[112px] items-center justify-center">
              <div className="flex flex-col items-center gap-3 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-slate-600 shadow-sm ring-1 ring-slate-200">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                </span>
                <p className="text-xs font-black text-slate-500">تحميل الصور من السحابة...</p>
              </div>
            </div>
          ) : (
          <div className="relative">
            <div className="flex gap-2 overflow-x-auto pb-2 pl-2 [scrollbar-width:thin]">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isSaving}
                className="flex w-24 shrink-0 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-300 bg-white text-center shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/40 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="اختيار صورة من الجهاز"
                title="اختيار صورة من الجهاز"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                  <PlusCircle className="h-5 w-5" />
                </span>
                <span className="px-2 text-[10px] font-black leading-4 text-slate-600">من الجهاز</span>
              </button>
              {photos.map((photo) => (
                <button
                  key={photo.path}
                  type="button"
                  onClick={() => onSelect?.(targetType, photo)}
                  disabled={isSaving}
                  className="group w-24 shrink-0 overflow-hidden rounded-2xl border border-slate-200 bg-white text-right shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="aspect-square bg-slate-100">
                    {photo.signedUrl ? (
                      <img src={photo.signedUrl} alt={photo.name} className="h-full w-full object-cover" loading="lazy" />
                    ) : null}
                  </div>
                  <div className="px-2 py-1.5">
                    <p className="truncate text-[10px] font-black text-slate-800">{photo.name}</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="pointer-events-none absolute bottom-2 left-0 top-0 w-10 bg-gradient-to-r from-slate-50 to-transparent" />
          </div>
          )}
        </div>
      ) : status === 'ready' ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center text-xs font-black text-slate-400">
          لا توجد صور مناسبة محفوظة في السحابة.
        </div>
      ) : null}
    </section>
  );
}

function TrackingAttachmentsStrip({ attachments = {}, onChangeRequest, onRemove, removingAttachmentId, error }) {
  const completedCount = TRACKING_ATTACHMENT_TYPES.filter((type) => Boolean(attachments[type.documentType]?.signedUrl)).length;
  const progressText = completedCount === 0 ? 'مطلوب تحديد صورتين' : `تم تحديد ${completedCount} من 2`;

  return (
    <section className="py-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="h-5 w-1 rounded-full bg-slate-400" />
          <p className="text-[13px] font-black text-slate-900">صورة رقم الشاسيه ورقم الموتور</p>
        </div>
      </div>
      <div className="mt-3">
        <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-sm font-black text-slate-900">معاينة الصور المختاره</p>
            <span className={`rounded-full px-3 py-1 text-[11px] font-black ${
              completedCount === TRACKING_ATTACHMENT_TYPES.length
                ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                : 'bg-amber-50 text-amber-700 ring-1 ring-amber-100'
            }`}
            >
              {progressText}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {TRACKING_ATTACHMENT_TYPES.map((type) => {
              const attachment = attachments[type.documentType];
              return (
                <div
                  key={type.documentType}
                  onClick={() => {
                    if (!attachment?.signedUrl) onChangeRequest?.(type);
                  }}
                  onKeyDown={(event) => {
                    if (!attachment?.signedUrl && (event.key === 'Enter' || event.key === ' ')) {
                      event.preventDefault();
                      onChangeRequest?.(type);
                    }
                  }}
                  role={attachment?.signedUrl ? undefined : 'button'}
                  tabIndex={attachment?.signedUrl ? undefined : 0}
                  className={`flex min-h-[76px] items-center gap-3 rounded-2xl border p-2 ${
                    attachment?.signedUrl
                      ? 'border-emerald-100 bg-emerald-50/70'
                      : 'border-dashed border-slate-200 bg-slate-50 transition hover:border-blue-300 hover:bg-blue-50/40 focus:outline-none focus:ring-4 focus:ring-blue-50'
                  }`}
                >
                  {attachment?.signedUrl ? (
                    <a
                      href={attachment.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="h-16 w-20 shrink-0 overflow-hidden rounded-xl bg-white"
                    >
                      <img
                        src={attachment.signedUrl}
                        alt={type.label}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </a>
                  ) : (
                    <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-xl bg-white text-slate-300 ring-1 ring-slate-200">
                      <Camera className="h-5 w-5" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {attachment?.signedUrl ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
                      <p className={`truncate text-xs font-black ${attachment?.signedUrl ? 'text-emerald-800' : 'text-slate-600'}`}>
                        {type.label}
                      </p>
                    </div>
                    <p className={`mt-1 truncate text-[11px] font-bold ${attachment?.signedUrl ? 'text-emerald-700/70' : 'text-slate-400'}`}>
                      {attachment?.signedUrl ? attachment.name || 'تم حفظ الصورة' : 'لم يتم التحديد بعد'}
                    </p>
                  </div>
                  {attachment?.signedUrl ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-slate-100"
                          aria-label={`خيارات ${type.label}`}
                          title="خيارات الصورة"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-40 rounded-xl" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenuItem onSelect={() => onChangeRequest?.(type)} className="gap-2 font-bold">
                          <span>تغيير الصورة</span>
                          <Camera className="h-4 w-4 text-slate-500" />
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => onRemove?.(type, attachment)}
                          disabled={removingAttachmentId === attachment.id}
                          className="gap-2 font-bold text-red-600 focus:bg-red-50 focus:text-red-700"
                        >
                          <span>{removingAttachmentId === attachment.id ? 'جاري الحذف...' : 'حذف الصورة'}</span>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        {error ? (
          <p className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-xs font-black leading-5 text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
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
                      className="h-11 rounded-xl border-slate-200 bg-white text-sm font-black text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-100"
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
        className="mx-auto max-h-[92vh] w-full max-w-md overflow-hidden rounded-t-[24px] md:bottom-auto md:left-1/2 md:right-auto md:top-1/2 md:w-[min(92vw,720px)] md:max-w-none md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[28px] md:border md:border-slate-200"
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

function normalizeConfigCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function ShowroomShell({ children }) {
  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#5b1f2c] px-4 py-5 text-slate-950 [background-image:linear-gradient(135deg,#8e3948_0%,#5b1f2c_46%,#3b1119_100%)] sm:px-6 lg:px-10"
      dir="rtl"
    >
      <div className="pointer-events-none absolute inset-0 opacity-55 [background-image:radial-gradient(rgba(255,255,255,0.28)_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="pointer-events-none absolute -right-24 top-20 h-56 w-[42rem] -rotate-12 rounded-[32px] bg-white/12" />
      <div className="pointer-events-none absolute -left-28 top-36 h-44 w-[34rem] rotate-12 rounded-[32px] bg-[#f4c8cf]/18" />
      <main className="relative z-10 mx-auto w-full max-w-[1280px]">
        {children}
      </main>
    </div>
  );
}

function ShowroomEmptyState({ onCreate }) {
  return (
    <ShowroomShell>
      <div className="flex min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_24px_60px_-36px_rgba(15,23,42,0.28)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Store className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-black text-slate-900">أنشئ أول نقطة معرض</h1>
          <p className="mt-2 text-sm font-bold leading-7 text-slate-500">
            لا توجد نقطة معرض نشطة بعد. أنشئ نقطة مثل إعدادات Odoo POS Configurations ثم ابدأ البيع عليها.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-black text-white shadow-[0_18px_28px_-20px_rgba(15,23,42,0.65)] transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-200"
          >
            <PlusCircle className="h-4 w-4" />
            إنشاء نقطة معرض
          </button>
        </div>
      </div>
    </ShowroomShell>
  );
}

function ShowroomConfigSheet({ open, onOpenChange, configs, config, onSaved }) {
  const { tenant } = useWorkspace();
  const [draft, setDraft] = useState(EMPTY_CONFIG_DRAFT);
  const [branches, setBranches] = useState([]);
  const [journals, setJournals] = useState([]);
  const [isLoadingLookups, setIsLoadingLookups] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setDraft(config ? {
      id: config.id,
      name: config.name ?? '',
      code: config.code ?? '',
      branchId: config.branch_id ?? '',
      journalId: config.journal_id ?? '',
      isActive: config.is_active !== false,
    } : EMPTY_CONFIG_DRAFT);
    setError('');
  }, [config]);

  useEffect(() => {
    if (!open || !tenant?.id) return undefined;

    let mounted = true;
    setIsLoadingLookups(true);

    Promise.all([
      showroomService.listBranches({ tenantId: tenant.id }).catch(() => []),
      showroomService.listPaymentJournals({ tenantId: tenant.id }).catch(() => []),
    ]).then(([nextBranches, nextJournals]) => {
      if (!mounted) return;
      setBranches(nextBranches);
      setJournals(nextJournals);
    }).finally(() => {
      if (mounted) setIsLoadingLookups(false);
    });

    return () => {
      mounted = false;
    };
  }, [open, tenant?.id]);

  useEffect(() => {
    reset();
  }, [open, reset]);

  const saveConfig = async (event) => {
    event.preventDefault();

    if (!tenant?.id || isSaving) return;

    const code = normalizeConfigCode(draft.code);
    const duplicate = configs.some((item) => normalizeConfigCode(item.code) === code && item.id !== draft.id);

    if (!draft.name.trim()) {
      setError('اكتب اسم نقطة المعرض.');
      return;
    }

    if (!code) {
      setError('اكتب كود نقطة المعرض.');
      return;
    }

    if (duplicate) {
      setError('كود نقطة المعرض مستخدم بالفعل داخل نفس الشركة.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const payload = {
        tenantId: tenant.id,
        name: draft.name,
        code,
        branchId: draft.branchId || null,
        journalId: draft.journalId || null,
        isActive: draft.isActive,
      };

      const savedConfig = draft.id
        ? await showroomService.updateConfig(draft.id, payload)
        : await showroomService.createConfig(payload);

      await onSaved?.(savedConfig);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || 'تعذر حفظ نقطة المعرض.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-md" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pr-6 text-right">
          <SheetTitle className="text-[#173653]">{draft.id ? 'تعديل نقطة معرض' : 'إضافة نقطة معرض'}</SheetTitle>
          <p className="text-sm font-bold text-[#668097]">أدخل بيانات النقطة وسيتم تحديث الكروت مباشرة.</p>
        </SheetHeader>
        <form onSubmit={saveConfig} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="space-y-4">
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">
                {error}
              </div>
            ) : null}

            <div>
              <label className="mb-2 block text-xs font-black text-[#668097]">الاسم</label>
              <Input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                className="border-[#c5ddef] font-bold"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-black text-[#668097]">الكود</label>
              <Input
                value={draft.code}
                onChange={(event) => setDraft((current) => ({ ...current, code: normalizeConfigCode(event.target.value) }))}
                className="border-[#c5ddef] font-bold uppercase"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-black text-[#668097]">الفرع</label>
              <select
                value={draft.branchId}
                onChange={(event) => setDraft((current) => ({ ...current, branchId: event.target.value }))}
                disabled={isLoadingLookups}
                className="h-11 w-full rounded-xl border border-[#e6c8cf] bg-white px-3 text-sm font-bold text-[#4d1f28] outline-none focus:ring-4 focus:ring-[#f1d7dc]"
              >
                <option value="">بدون فرع</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs font-black text-[#668097]">جورنال التحصيل</label>
              <select
                value={draft.journalId}
                onChange={(event) => setDraft((current) => ({ ...current, journalId: event.target.value }))}
                disabled={isLoadingLookups}
                className="h-11 w-full rounded-xl border border-[#e6c8cf] bg-white px-3 text-sm font-bold text-[#4d1f28] outline-none focus:ring-4 focus:ring-[#f1d7dc]"
              >
                <option value="">بدون جورنال</option>
                {journals.map((journal) => <option key={journal.id} value={journal.id}>{journal.name} ({journal.code})</option>)}
              </select>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#c5ddef] bg-[#f7fbff] px-4 py-3 text-sm font-black text-[#173653]">
              <span>نشطة</span>
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
                className="h-4 w-4"
              />
            </label>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSaving}>
              إلغاء
            </Button>
            <Button type="submit" disabled={isSaving} className="bg-[#9b3645] font-black text-white hover:bg-[#862f3d]">
              {isSaving ? 'جار الحفظ...' : draft.id ? 'حفظ التعديل' : 'إضافة نقطة'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ShowroomConfigChooser({ configs, onSelect }) {
  return (
    <ShowroomShell>
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-4xl flex-col justify-center py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-white">
          <div>
            <h1 className="text-2xl font-black sm:text-3xl">اختر نقطة المعرض</h1>
            <p className="mt-1 text-sm font-bold text-white/78">سيتم تشغيل البيع والفواتير على النقطة المختارة فقط.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {configs.map((config) => (
            <button
              key={config.id}
              type="button"
              onClick={() => onSelect(config)}
              className="rounded-[18px] border border-white/55 bg-white/95 p-5 text-right shadow-[0_24px_54px_-36px_rgba(15,52,93,0.9)] transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus:ring-4 focus:ring-white/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2
                    className="text-lg font-black leading-6 text-[#173653]"
                    style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {config.name}
                  </h2>
                  <p className="mt-1 text-xs font-black text-[#668097]">{config.code}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700">نشطة</span>
              </div>
              <p className="mt-5 text-sm font-black text-[#9b3645]">دخول نقطة البيع</p>
            </button>
          ))}
        </div>
      </div>
    </ShowroomShell>
  );
}

function ShowroomConfigsHome({
  configs,
  isLoading,
  error,
  actionError,
  configUsageById,
  currentConfigId,
  onBack,
  onOpenConfig,
  onCreateConfig,
  onEditConfig,
  onToggleConfig,
  onDeleteConfig,
}) {
  const displayError = actionError || error;

  return (
    <ShowroomShell>
      <div className="mx-auto min-h-[calc(100vh-2.5rem)] max-w-5xl py-8">
        <header className="mb-7 rounded-[24px] border border-white/35 bg-white/10 px-4 py-4 text-white backdrop-blur-sm sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3 text-right">
              <button
                type="button"
                aria-label="رجوع"
                onClick={onBack}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/45 bg-white/12 text-white shadow-[0_16px_34px_-24px_rgba(21,66,116,0.9)] backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
              >
                <ArrowRight className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs font-black uppercase text-white/75">Showroom Point</p>
                <h1 className="mt-1 text-2xl font-black sm:text-3xl">نقاط المعرض</h1>
                <p className="mt-1 text-sm font-bold text-white/80">واجهة أسهل لإدارة النقاط والدخول السريع للبيع.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCreateConfig}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/45 bg-white/12 px-4 text-sm font-black text-white shadow-[0_16px_34px_-24px_rgba(21,66,116,0.9)] backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            >
              <PlusCircle className="h-4 w-4" />
              إضافة نقطة
            </button>
          </div>
        </header>

        {displayError ? (
          <div className="mb-4 rounded-xl border border-white/35 bg-white/90 px-4 py-3 text-sm font-black text-red-600">
            {displayError}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-[18px] border border-white/45 bg-white/90 px-5 py-10 text-center text-sm font-black text-[#668097]">
            جاري تحميل نقاط المعرض...
          </div>
        ) : configs.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {configs.map((config) => {
              const isActive = config.is_active !== false;
              const isCurrent = currentConfigId === config.id;
              const hasActivity = Boolean(configUsageById?.[config.id]);
              const canDelete = !hasActivity;

              return (
                <div
                  key={config.id}
                  role="button"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => isActive && onOpenConfig(config)}
                  onKeyDown={(event) => {
                    if (!isActive) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenConfig(config);
                    }
                  }}
                  className={`min-h-[170px] rounded-[22px] border border-[#d8e8f5] bg-[linear-gradient(180deg,#ffffff_0%,#f8fcff_100%)] p-5 text-right shadow-[0_26px_50px_-40px_rgba(20,82,138,0.58)] transition hover:-translate-y-0.5 hover:border-[#b6d7ee] ${isActive ? '' : 'opacity-70 hover:translate-y-0'}`}
                >
                  <div className="flex h-full flex-col justify-between gap-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2
                          className="text-lg font-black tracking-tight leading-6 text-[#16314d]"
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                        >
                          {config.name || 'نقطة معرض'}
                        </h2>
                        <p className="mt-1 text-xs font-black text-[#5c7992]">{config.code || 'بدون كود'}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {isActive ? 'نشطة' : 'معطلة'}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              onClick={(event) => event.stopPropagation()}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#ead5d9] bg-white text-[#81626a] transition hover:bg-[#fbf1f3] hover:text-[#4d1f28] focus:outline-none focus:ring-4 focus:ring-[#f1d7dc]"
                              aria-label="إعدادات نقطة المعرض"
                              title="إعدادات نقطة المعرض"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44 rounded-xl" onClick={(event) => event.stopPropagation()}>
                            <DropdownMenuItem onSelect={() => onEditConfig(config)} className="gap-2 font-bold">
                              <span>تعديل</span>
                              <Pencil className="h-4 w-4 text-[#668097]" />
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onToggleConfig(config)} className="gap-2 font-bold">
                              <span>{isActive ? 'تعطيل النقطة' : 'تفعيل النقطة'}</span>
                              {isActive ? (
                                <Power className="h-4 w-4 text-[#668097]" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              )}
                            </DropdownMenuItem>
                            {canDelete ? (
                              <DropdownMenuItem onSelect={() => onDeleteConfig(config)} className="gap-2 font-bold text-red-600 focus:bg-red-50 focus:text-red-700">
                                <span>حذف</span>
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem disabled className="gap-2 font-bold text-slate-400">
                                <span>الحذف متاح قبل أول عملية فقط</span>
                                <Trash2 className="h-4 w-4" />
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-black text-[#2a78b8] transition hover:text-[#173653] disabled:cursor-not-allowed disabled:text-[#8aa0b3]">
                        {isActive ? 'دخول نقطة البيع' : 'فعّل النقطة من الإعدادات'}
                      </span>
                      {isCurrent ? (
                        <span className="rounded-full bg-[#fbf1f3] px-2.5 py-1 text-[11px] font-black text-[#9b3645]">محددة</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[22px] border border-white/55 bg-white/95 p-8 text-center shadow-[0_32px_70px_-38px_rgba(15,52,93,0.95)]">
            <Store className="mx-auto h-12 w-12 text-[#9b3645]" />
            <h2 className="mt-4 text-xl font-black text-[#173653]">لا توجد نقاط معرض بعد</h2>
            <p className="mt-2 text-sm font-bold text-[#668097]">ابدأ بإضافة أول نقطة معرض.</p>
            <button
              type="button"
              onClick={onCreateConfig}
              className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#9b3645] px-5 text-sm font-black text-white transition hover:bg-[#862f3d]"
            >
              <PlusCircle className="h-4 w-4" />
              إضافة نقطة
            </button>
          </div>
        )}
      </div>
    </ShowroomShell>
  );
}

function PaperworkRequestPromptSheet({ open, sale, onOpenChange, onSaved, onIgnored }) {
  const { tenant } = useWorkspace();
  const [selectedLine, setSelectedLine] = useState(null);
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
  const [paperworkSaveError, setPaperworkSaveError] = useState('');
  const [isPaperworkSaving, setIsPaperworkSaving] = useState(false);
  const [isIgnoreWarningOpen, setIsIgnoreWarningOpen] = useState(false);
  const lines = useMemo(() => getSalePendingPaperworkLines(sale), [sale]);
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
    setPaperworkSaveError('');
    setIsPaperworkSaving(false);
    setIsIgnoreWarningOpen(false);
  }, [lines, open, sale?.id]);

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

  return (
    <>
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) onOpenChange(true);
      }}
    >
      <SheetContent
        side="right"
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
        className="w-full max-w-md border-l border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.18)] md:max-w-lg"
        dir="rtl"
      >
        <SheetHeader className="relative shrink-0 bg-gradient-to-br from-[#0f5f9f] via-[#0d76b7] to-[#0b4f86] px-5 py-5 pl-12 text-right text-white">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/12 text-amber-100 ring-1 ring-white/20">
              <TriangleAlert className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase text-blue-100/85">Ownership Paperwork</p>
              <SheetTitle className="mt-1 text-xl font-black leading-7 text-white md:text-2xl">
                تحديد طلب اوراق الملكيه
              </SheetTitle>
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
        </SheetHeader>

        <SheetBody className="min-h-0 overflow-y-auto px-5 py-5">
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
        </SheetBody>

        <SheetFooter className="block shrink-0 space-y-3 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
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
        </SheetFooter>

      </SheetContent>
    </Sheet>
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
    </>
  );
}

export function ShowroomSellPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tenant } = useWorkspace();
  const {
    configs,
    activeConfigs,
    currentShowroomConfig,
    currentShowroomConfigId,
    isLoadingConfigs,
    configsError,
    selectConfig,
    reloadConfigs,
  } = useShowroomConfig();
  const [sales, setSales] = useState([]);
  const [isSalesLoading, setIsSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState('');
  const [selectedSale, setSelectedSale] = useState(null);
  const [paperworkPromptSale, setPaperworkPromptSale] = useState(null);
  const [dismissedPaperworkPromptSaleId, setDismissedPaperworkPromptSaleId] = useState(null);
  const [isCreateConfigOpen, setIsCreateConfigOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const [configUsageById, setConfigUsageById] = useState({});
  const [configActionError, setConfigActionError] = useState('');
  const isHomeRoute = location.pathname.replace(/\/+$/, '') === '/app/showroom_point';

  useEffect(() => {
    if (!isHomeRoute || isLoadingConfigs || activeConfigs.length !== 1) {
      return;
    }

    const onlyConfig = activeConfigs[0];
    if (!onlyConfig) {
      return;
    }

    selectConfig(onlyConfig);
    navigate('/app/showroom_point/new', { replace: true });
  }, [activeConfigs, isHomeRoute, isLoadingConfigs, navigate, selectConfig]);

  useEffect(() => {
    if (!tenant?.id || !configs.length) {
      setConfigUsageById({});
      return;
    }

    let mounted = true;
    showroomService.listConfigActivity({
      tenantId: tenant.id,
      configIds: configs.map((config) => config.id),
    }).then((activityMap) => {
      if (!mounted) return;
      setConfigUsageById(activityMap || {});
    }).catch(() => {
      if (!mounted) return;
      setConfigUsageById({});
    });

    return () => {
      mounted = false;
    };
  }, [configs, tenant?.id]);

  const loadSales = useCallback(async () => {
    if (!tenant?.id || !currentShowroomConfigId) {
      setSales([]);
      setIsSalesLoading(false);
      return;
    }

    setIsSalesLoading(true);
    setSalesError('');

    try {
      const nextSales = await showroomService.getSales({
        tenantId: tenant.id,
        showroomConfigId: currentShowroomConfigId,
      });
      setSales(nextSales);
    } catch (error) {
      setSales([]);
      setSalesError(error.message || 'تعذر تحميل عمليات البيع.');
    } finally {
      setIsSalesLoading(false);
    }
  }, [currentShowroomConfigId, tenant?.id]);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  useEffect(() => {
    if (isSalesLoading || paperworkPromptSale) {
      return;
    }

    const latestSale = sales[0] || null;
    if (
      latestSale
      && latestSale.id !== dismissedPaperworkPromptSaleId
      && getSalePendingPaperworkLines(latestSale).length
    ) {
      setPaperworkPromptSale(latestSale);
    }
  }, [dismissedPaperworkPromptSaleId, isSalesLoading, paperworkPromptSale, sales]);

  const salesStats = useMemo(() => {
    const total = sales.reduce((sum, sale) => sum + Number(sale.total_amount || sale.totalAmount || 0), 0);
    return {
      count: sales.length,
      total,
    };
  }, [sales]);

  const handleSaleCreated = async (sale) => {
    if (!tenant?.id) {
      return { ok: false, error: 'لا توجد شركة نشطة.' };
    }

    if (!currentShowroomConfigId) {
      return { ok: false, error: 'اختر نقطة معرض أولاً.' };
    }

    try {
      const savedSale = await showroomService.createSale({
        tenantId: tenant.id,
        customerId: sale.customer?.id || null,
        items: sale.items,
        totalAmount: sale.totalAmount,
        paidAmount: sale.paidAmount,
        paymentMethodId: sale.paymentMethodId,
        contractNote: sale.contractNote,
        showroomConfigId: currentShowroomConfigId,
      });

      setSales((current) => [savedSale, ...current.filter((item) => item.id !== savedSale.id)]);
      setDismissedPaperworkPromptSaleId(null);
      if (getSalePendingPaperworkLines(savedSale).length) {
        setPaperworkPromptSale(savedSale);
      }
      return { ok: true, sale: savedSale };
    } catch (error) {
      return { ok: false, error: error.message || 'تعذر حفظ عملية البيع.' };
    }
  };

  const handleSaleDeleted = (saleId) => {
    setSales((current) => current.filter((item) => item.id !== saleId));
    setSelectedSale(null);
  };

  const handlePaperworkPromptSaved = useCallback(({ saleId, saleLineId, paperworkRequest }) => {
    if (!saleId || !saleLineId || !paperworkRequest?.id) return;

    const normalizeLine = (line) => (
      line?.id === saleLineId
        ? {
            ...line,
            paperworkRequest,
            paperwork_request: paperworkRequest,
          }
        : line
    );

    const normalizeSale = (sale) => (
      sale?.id === saleId
        ? {
            ...sale,
            lines: Array.isArray(sale.lines) ? sale.lines.map(normalizeLine) : sale.lines,
          }
        : sale
    );

    setSales((current) => current.map(normalizeSale));
    setSelectedSale((current) => normalizeSale(current));
    setPaperworkPromptSale((current) => {
      const nextSale = normalizeSale(current);
      return nextSale && getSalePendingPaperworkLines(nextSale).length ? nextSale : null;
    });
  }, []);

  if (isHomeRoute) {
    return (
      <>
        <ShowroomConfigsHome
          configs={configs}
          isLoading={isLoadingConfigs}
          error={configsError}
          actionError={configActionError}
          configUsageById={configUsageById}
          currentConfigId={currentShowroomConfigId}
          onBack={() => navigate(-1)}
          onCreateConfig={() => {
            setConfigActionError('');
            setIsCreateConfigOpen(true);
          }}
          onEditConfig={(config) => {
            setConfigActionError('');
            setEditingConfig(config);
            setIsCreateConfigOpen(true);
          }}
          onToggleConfig={async (config) => {
            if (!tenant?.id) return;

            try {
              const nextActive = config.is_active === false;
              await showroomService.toggleConfigActive({
                tenantId: tenant.id,
                id: config.id,
                isActive: nextActive,
              });

              if (!nextActive && currentShowroomConfigId === config.id) {
                selectConfig(null);
              }

              setConfigActionError('');
              await reloadConfigs();
            } catch (error) {
              setConfigActionError(error.message || 'تعذر تحديث حالة نقطة المعرض.');
            }
          }}
          onDeleteConfig={async (config) => {
            if (!tenant?.id) return;

            if (configUsageById[config.id]) {
              setConfigActionError('لا يمكن حذف النقطة بعد تسجيل عمليات عليها. يمكنك تعطيلها فقط.');
              return;
            }

            const isConfirmed = window.confirm(`هل أنت متأكد من حذف نقطة المعرض "${config.name || 'بدون اسم'}" نهائياً؟`);
            if (!isConfirmed) {
              return;
            }

            try {
              await showroomService.deleteConfig({
                tenantId: tenant.id,
                id: config.id,
              });

              if (currentShowroomConfigId === config.id) {
                selectConfig(null);
              }

              setConfigActionError('');
              await reloadConfigs();
            } catch (error) {
              setConfigActionError(error.message || 'تعذر حذف نقطة المعرض.');
            }
          }}
          onOpenConfig={(config) => {
            setConfigActionError('');
            selectConfig(config);
            navigate('/app/showroom_point/new');
          }}
        />
        <ShowroomConfigSheet
          open={isCreateConfigOpen}
          onOpenChange={(open) => {
            setIsCreateConfigOpen(open);
            if (!open) setEditingConfig(null);
          }}
          configs={configs}
          config={editingConfig}
          onSaved={async (savedConfig) => {
            await reloadConfigs();
            if (savedConfig.is_active !== false) {
              selectConfig(savedConfig);
            }
          }}
        />
      </>
    );
  }

  if (isLoadingConfigs) {
    return (
      <ShowroomShell>
        <div className="flex min-h-[calc(100vh-2.5rem)] items-center justify-center text-sm font-black text-white">
          جاري تحميل نقاط المعرض...
        </div>
      </ShowroomShell>
    );
  }

  if (!currentShowroomConfigId) {
    if (!activeConfigs.length) {
      return (
        <>
          <ShowroomEmptyState onCreate={() => setIsCreateConfigOpen(true)} />
          <ShowroomConfigSheet
            open={isCreateConfigOpen}
            onOpenChange={(open) => {
              setIsCreateConfigOpen(open);
              if (!open) setEditingConfig(null);
            }}
            configs={configs}
            config={editingConfig}
            onSaved={async (createdConfig) => {
              await reloadConfigs();
              selectConfig(createdConfig);
            }}
          />
        </>
      );
    }

    return (
      <ShowroomConfigChooser
        configs={activeConfigs}
        onSelect={selectConfig}
      />
    );
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#5b1f2c] px-4 py-5 text-slate-950 [background-image:linear-gradient(135deg,#8e3948_0%,#5b1f2c_46%,#3b1119_100%)] sm:px-6 lg:px-10"
      dir="rtl"
    >
      <style>{`
        @keyframes showroomBackdropIn {
          from { opacity: 0; transform: scale(1.025); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes showroomHeaderIn {
          from { opacity: 0; transform: translateY(-14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes showroomPanelIn {
          from { opacity: 0; transform: translateY(26px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .showroom-backdrop-in { animation: showroomBackdropIn 0.32s ease-out both; }
        .showroom-header-in { animation: showroomHeaderIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .showroom-panel-in { animation: showroomPanelIn 0.34s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>
      <div className="pointer-events-none absolute inset-0 opacity-55 [background-image:radial-gradient(rgba(255,255,255,0.28)_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="showroom-backdrop-in pointer-events-none absolute -right-24 top-20 h-56 w-[42rem] -rotate-12 rounded-[32px] bg-white/12" />
      <div className="showroom-backdrop-in pointer-events-none absolute -left-28 top-36 h-44 w-[34rem] rotate-12 rounded-[32px] bg-[#f4c8cf]/18" style={{ animationDelay: '0.03s' }} />
      <div className="showroom-backdrop-in pointer-events-none absolute bottom-[-4rem] right-12 h-36 w-[34rem] -rotate-6 rounded-[28px] bg-white/10" style={{ animationDelay: '0.06s' }} />
      <div className="showroom-backdrop-in pointer-events-none absolute left-10 top-12 hidden h-28 w-44 rounded-[22px] border border-white/30 bg-white/10 backdrop-blur-sm md:block" style={{ animationDelay: '0.08s' }} />
      <div className="pointer-events-none absolute left-16 top-20 hidden h-2.5 w-12 rounded-full bg-[#f0a6b0] md:block" />
      <div className="pointer-events-none absolute left-16 top-32 hidden grid-cols-2 gap-3 md:grid">
        <span className="h-12 w-16 rounded-xl border border-white/24 bg-white/10" />
        <span className="h-12 w-16 rounded-xl border border-white/20 bg-white/8" />
        <span className="h-12 w-16 rounded-xl border border-white/20 bg-white/8" />
        <span className="h-12 w-16 rounded-xl border border-white/20 bg-white/8" />
      </div>
      <div className="pointer-events-none absolute bottom-12 right-10 hidden h-px w-80 bg-white/55 md:block" />
      <div className="pointer-events-none absolute bottom-16 right-16 hidden h-px w-48 bg-[#f4d35e]/70 md:block" />
      <main className="relative z-10 mx-auto w-full max-w-[1280px]">
        <header className="showroom-header-in mb-3 flex flex-wrap items-center justify-between gap-3 px-1 text-white sm:px-0">
          <div className="flex min-w-0 items-center gap-3 text-right">
            <button
              type="button"
              aria-label="رجوع"
              onClick={() => navigate(-1)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            >
              <ArrowRight className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black leading-tight text-white sm:text-2xl">نقطة المعرض</h1>
                <span className="rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-black text-white/80 backdrop-blur">Live Workspace</span>
              </div>
              <p className="hidden text-[11px] font-semibold text-white/70 sm:block">واجهة بيع احترافية بترتيب واضح ومظهر مؤسسي هادئ</p>
            </div>
          </div>
          <div className="flex w-full items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur sm:w-auto sm:min-w-[17rem]">
            <Store className="h-4 w-4 shrink-0 text-white/80" />
            <div className="min-w-0 flex-1">
              <label htmlFor="showroom-config" className="sr-only">نقطة المعرض</label>
              <select
                id="showroom-config"
                value={currentShowroomConfigId}
                onChange={(event) => {
                  const nextConfig = activeConfigs.find((config) => config.id === event.target.value) ?? null;
                  selectConfig(nextConfig);
                }}
                disabled={isLoadingConfigs || activeConfigs.length < 2}
                className="h-9 w-full rounded-xl border border-white/20 bg-white/95 px-3 text-xs font-black text-slate-800 outline-none transition focus:ring-4 focus:ring-white/25 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {activeConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name || config.code || 'نقطة معرض'}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              aria-label="إضافة نقطة جديدة"
              title="إضافة نقطة جديدة"
              onClick={() => {
                setEditingConfig(null);
                setIsCreateConfigOpen(true);
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/95 text-slate-700 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-white/25"
            >
              <PlusCircle className="h-4 w-4" />
            </button>
          </div>
        </header>

        {configsError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-black text-red-600 shadow-sm">
            {configsError}
          </div>
        ) : null}

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px] xl:gap-7">
          <div className="showroom-panel-in overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_60px_-34px_rgba(15,23,42,0.18)] xl:col-start-1">
            <ShowroomSalesCard onSaleCreated={handleSaleCreated} showroomConfig={currentShowroomConfig} />
          </div>
          <div className="showroom-panel-in overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_60px_-34px_rgba(15,23,42,0.18)] xl:col-start-2" style={{ animationDelay: '0.04s' }}>
            <ShowroomInvoicesCard
              invoices={sales}
              stats={salesStats}
              isLoading={isSalesLoading}
              error={salesError}
              onInvoiceSelect={setSelectedSale}
            />
          </div>
        </div>
      </main>
      <ShowroomSaleViewSheet
        sale={selectedSale}
        isOpen={Boolean(selectedSale)}
        onClose={() => setSelectedSale(null)}
        onDeleted={handleSaleDeleted}
        onPaperworkRequestOpen={(saleToUpdate) => {
          if (saleToUpdate && getSalePendingPaperworkLines(saleToUpdate).length) {
            setDismissedPaperworkPromptSaleId(null);
            setSelectedSale(null);
            setPaperworkPromptSale(saleToUpdate);
          }
        }}
      />
      <PaperworkRequestPromptSheet
        open={Boolean(paperworkPromptSale)}
        sale={paperworkPromptSale}
        onOpenChange={(open) => {
          if (open) return;
          setPaperworkPromptSale((current) => (
            current && getSalePendingPaperworkLines(current).length ? current : null
          ));
        }}
        onSaved={handlePaperworkPromptSaved}
        onIgnored={(ignoredSale) => {
          setDismissedPaperworkPromptSaleId(ignoredSale?.id || null);
          setPaperworkPromptSale(null);
        }}
      />
      <ShowroomConfigSheet
        open={isCreateConfigOpen}
        onOpenChange={(open) => {
          setIsCreateConfigOpen(open);
          if (!open) setEditingConfig(null);
        }}
        configs={configs}
        config={editingConfig}
        onSaved={async (savedConfig) => {
          await reloadConfigs();
          if (savedConfig.is_active !== false) {
            selectConfig(savedConfig);
          }
        }}
      />
    </div>
  );
}
