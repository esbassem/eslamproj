import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Building2, Camera, Check, FileText, ImagePlus, Trash2, X } from 'lucide-react';
import { motoCustomerCareService } from '@/features/moto-customer-care/services/motoCustomerCare.service';

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
  }[value] || value || '';
}

function getSaleBlockNotes(note) {
  return String(note || '').match(/ملاحظات حظر البيع:\s*([^\n]+)/)?.[1]?.trim() || '';
}

function formatSentAt(value) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير محدد';

  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function ProcessorPaperworkReceiptDrawer({
  processor,
  open,
  onOpenChange,
  tenantId,
  onReceived,
}) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [receiptStep, setReceiptStep] = useState(0);
  const [receiptImages, setReceiptImages] = useState({});
  const [isReceiving, setIsReceiving] = useState(false);
  const [receiveError, setReceiveError] = useState('');
  const closeTimerRef = useRef(null);
  const openFrameRef = useRef(null);
  const requests = useMemo(() => processor?.requests || [], [processor]);
  const selectedRequests = useMemo(
    () => selectedIds.map((id) => requests.find((request) => request.id === id)).filter(Boolean),
    [requests, selectedIds],
  );

  useEffect(() => {
    window.clearTimeout(closeTimerRef.current);

    if (openFrameRef.current) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }

    if (open) {
      setSelectedIds([]);
      setConfirmationOpen(false);
      setReceiptStep(0);
      setReceiptImages({});
      setReceiveError('');
      setVisible(false);
      setMounted(true);
      openFrameRef.current = window.requestAnimationFrame(() => {
        openFrameRef.current = window.requestAnimationFrame(() => {
          setVisible(true);
          openFrameRef.current = null;
        });
      });
    } else {
      setVisible(false);
      closeTimerRef.current = window.setTimeout(() => setMounted(false), 240);
    }

    return () => {
      window.clearTimeout(closeTimerRef.current);
      if (openFrameRef.current) window.cancelAnimationFrame(openFrameRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (!mounted) return undefined;

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (confirmationOpen) setConfirmationOpen(false);
      else onOpenChange(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmationOpen, mounted, onOpenChange]);

  if (!mounted || !processor) return null;

  const allSelected = requests.length > 0 && selectedIds.length === requests.length;
  const toggleRequest = (requestId) => {
    setSelectedIds((current) => (
      current.includes(requestId)
        ? current.filter((id) => id !== requestId)
        : [...current, requestId]
    ));
  };
  const clearReceiptImages = () => {
    Object.values(receiptImages).forEach((image) => {
      if (image?.previewUrl) URL.revokeObjectURL(image.previewUrl);
    });
    setReceiptImages({});
  };
  const closeReceiptWizard = () => {
    if (isReceiving) return;
    clearReceiptImages();
    setReceiptStep(0);
    setConfirmationOpen(false);
    setReceiveError('');
  };
  const selectReceiptImage = (requestId, file) => {
    if (!file) return;
    if (!file.type?.startsWith('image/')) {
      setReceiveError('يمكن اختيار صور فقط.');
      return;
    }

    setReceiveError('');
    setReceiptImages((current) => {
      if (current[requestId]?.previewUrl) URL.revokeObjectURL(current[requestId].previewUrl);
      return {
        ...current,
        [requestId]: {
          file,
          previewUrl: URL.createObjectURL(file),
        },
      };
    });
  };
  const removeReceiptImage = (requestId) => {
    setReceiptImages((current) => {
      if (current[requestId]?.previewUrl) URL.revokeObjectURL(current[requestId].previewUrl);
      const next = { ...current };
      delete next[requestId];
      return next;
    });
  };
  const confirmReceipt = async () => {
    if (isReceiving || !selectedIds.length) return;

    setIsReceiving(true);
    setReceiveError('');

    try {
      const result = await motoCustomerCareService.receivePaperworkRequestsFromProcessor({
        tenantId,
        requestIds: selectedIds,
        imagesByRequestId: Object.fromEntries(
          Object.entries(receiptImages).map(([requestId, image]) => [requestId, image.file]),
        ),
      });

      if (result.failed.length || result.imageFailed.length) {
        const failureText = [...result.failed, ...result.imageFailed]
          .map((failure) => failure.message)
          .join('، ');
        setReceiveError(
          result.succeeded.length
            ? `تم استلام ${result.succeeded.length}. ${failureText}`
            : failureText,
        );
      }

      if (result.succeeded.length) {
        const succeededIds = new Set(result.succeeded.map((item) => item.requestId));
        setSelectedIds((current) => current.filter((id) => !succeededIds.has(id)));
        onReceived?.(result.succeeded);
      }

      if (!result.failed.length) {
        clearReceiptImages();
        setConfirmationOpen(false);
        onOpenChange(false);
      }
    } catch (error) {
      setReceiveError(error?.message || 'تعذر استلام الأوراق.');
    } finally {
      setIsReceiving(false);
    }
  };

  return createPortal(
    <div className={`fixed inset-0 z-[140] ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`} dir="rtl">
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className={`absolute inset-0 bg-slate-950/35 transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label="إغلاق أوراق الجهة"
      />

      <aside
        className={`absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-2xl will-change-transform transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label={`أوراق ${processor.name}`}
      >
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 pb-4 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                <Building2 className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold text-slate-400">الأوراق الموجودة لدى</p>
                <h2 className="mt-0.5 truncate text-base font-black text-slate-950">{processor.name}</h2>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
              aria-label="إغلاق"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setSelectedIds(allSelected ? [] : requests.map((request) => request.id))}
            className="mt-4 flex w-full items-center justify-between border-t border-slate-100 pt-3 text-right"
          >
            <span>
              <span className="block text-xs font-black text-slate-700">تحديد جميع الأوراق</span>
              <span className="mt-0.5 block text-[10px] font-bold text-slate-400">
                {selectedIds.length} من {requests.length} محددة
              </span>
            </span>
            <span className={`flex h-6 w-6 items-center justify-center rounded-md border transition ${
              allSelected
                ? 'border-blue-600 bg-blue-600 text-white'
                : 'border-slate-300 bg-white text-transparent'
            }`}
            >
              <Check className="h-4 w-4" />
            </span>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white px-4">
          <div className="divide-y divide-slate-100">
            {requests.map((request) => {
              const selected = selectedIds.includes(request.id);
              const chassis = findIdentifier(request, /chassis|شاسيه/i);
              const engine = findIdentifier(request, /engine|motor|موتور|محرك/i);

              return (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => toggleRequest(request.id)}
                  className={`flex w-full items-start gap-3 py-4 text-right transition ${
                    selected ? 'bg-blue-50/55' : 'hover:bg-slate-50'
                  }`}
                >
                  <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition ${
                    selected
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white text-transparent'
                  }`}
                  >
                    <Check className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <FileText className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="truncate text-xs font-black text-slate-900">
                        {request.productName || 'طلب أوراق'}
                      </span>
                      <span className="shrink-0 text-[10px] font-bold text-slate-500">
                        باسم: {request.documentOwnerName
                          || request.documentOwner?.name
                          || (request.documentOwnerStatus === 'later' ? 'يُحدد لاحقًا' : 'غير محدد')}
                      </span>
                      {request.documentOwnerStatus !== 'later' && getGuardianshipLabel(request.documentOwnerNote) ? (
                        <span className="shrink-0 text-[9px] font-bold text-slate-400">
                          · {getGuardianshipLabel(request.documentOwnerNote)}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block truncate text-[10px] font-bold text-slate-400">
                      {[
                        chassis?.value ? `شاسيه ${chassis.value}` : '',
                        engine?.value ? `موتور ${engine.value}` : '',
                      ].filter(Boolean).join(' · ') || 'لا توجد أرقام تعريف'}
                    </span>
                    {getSaleBlockNotes(request.documentOwnerNote) ? (
                      <span className="mt-1.5 block rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-black text-red-800">
                        حظر البيع: {getSaleBlockNotes(request.documentOwnerNote)}
                      </span>
                    ) : null}
                    <span className="mt-1.5 block truncate text-[9px] font-bold text-blue-500">
                      أُرسل للجهة: {formatSentAt(
                        [...(request.events || [])]
                          .reverse()
                          .find((event) => (
                            event.eventType === 'sent_to_supplier'
                            || event.newStage === 'sent_to_processor'
                          ))?.createdAt
                        || request.stageEnteredAt,
                      )}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <footer className="shrink-0 border-t border-slate-200 bg-white px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 shadow-[0_-10px_26px_-18px_rgba(15,23,42,0.55)]">
          <button
            type="button"
            disabled={!selectedIds.length}
            onClick={() => {
              setReceiveError('');
              setReceiptStep(0);
              clearReceiptImages();
              setConfirmationOpen(true);
            }}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
          >
            استلام {selectedIds.length ? `(${selectedIds.length})` : ''}
          </button>
        </footer>

        {confirmationOpen && selectedRequests.length ? (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/30 p-4" dir="rtl">
            <button
              type="button"
              className="absolute inset-0"
              onClick={closeReceiptWizard}
              aria-label="إغلاق تأكيد الاستلام"
            />
            <section className="relative max-h-[92dvh] w-full max-w-sm overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black text-blue-600">
                    جواب {receiptStep + 1} من {selectedRequests.length}
                  </p>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="min-w-0 truncate text-base font-black text-slate-950">
                      {selectedRequests[receiptStep]?.productName || 'طلب أوراق'}
                    </h3>
                    <span className="shrink-0 text-[10px] font-bold text-slate-500">
                      الجواب باسم: {selectedRequests[receiptStep]?.documentOwnerName
                        || selectedRequests[receiptStep]?.documentOwner?.name
                        || (selectedRequests[receiptStep]?.documentOwnerStatus === 'later' ? 'يُحدد لاحقًا' : 'غير محدد')}
                    </span>
                    {selectedRequests[receiptStep]?.documentOwnerStatus !== 'later'
                      && getGuardianshipLabel(selectedRequests[receiptStep]?.documentOwnerNote) ? (
                        <span className="shrink-0 text-[9px] font-bold text-slate-400">
                          · {getGuardianshipLabel(selectedRequests[receiptStep]?.documentOwnerNote)}
                        </span>
                      ) : null}
                  </div>
                  <p className="mt-1 truncate text-[10px] font-bold text-slate-400">
                    {[
                      findIdentifier(selectedRequests[receiptStep], /chassis|شاسيه/i)?.value
                        ? `شاسيه ${findIdentifier(selectedRequests[receiptStep], /chassis|شاسيه/i).value}`
                        : '',
                      findIdentifier(selectedRequests[receiptStep], /engine|motor|موتور|محرك/i)?.value
                        ? `موتور ${findIdentifier(selectedRequests[receiptStep], /engine|motor|موتور|محرك/i).value}`
                        : '',
                    ].filter(Boolean).join(' · ') || 'لا توجد أرقام تعريف'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeReceiptWizard}
                  disabled={isReceiving}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 disabled:opacity-50"
                  aria-label="إغلاق"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-4 flex gap-1">
                {selectedRequests.map((request, index) => (
                  <span
                    key={request.id}
                    className={`h-1 flex-1 rounded-full ${
                      index <= receiptStep ? 'bg-blue-600' : 'bg-slate-200'
                    }`}
                  />
                ))}
              </div>

              <div className="mt-4">
                {receiptImages[selectedRequests[receiptStep]?.id]?.previewUrl ? (
                  <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
                    <img
                      src={receiptImages[selectedRequests[receiptStep].id].previewUrl}
                      alt="صورة الجواب"
                      className="aspect-[4/3] w-full object-contain"
                    />
                    <label className="absolute bottom-2 right-2 flex h-9 cursor-pointer items-center gap-2 rounded-xl bg-white/95 px-3 text-[10px] font-black text-slate-700 shadow-sm">
                      <Camera className="h-4 w-4" />
                      تغيير الصورة
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        disabled={isReceiving}
                        onChange={(event) => {
                          selectReceiptImage(selectedRequests[receiptStep].id, event.target.files?.[0]);
                          event.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeReceiptImage(selectedRequests[receiptStep].id)}
                      disabled={isReceiving}
                      className="absolute bottom-2 left-2 flex h-9 w-9 items-center justify-center rounded-xl bg-white/95 text-red-600 shadow-sm"
                      aria-label="حذف الصورة"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label className="flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 text-center transition hover:border-blue-300 hover:bg-blue-50/40">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-blue-600 shadow-sm">
                      <ImagePlus className="h-5 w-5" />
                    </span>
                    <span>
                      <span className="block text-xs font-black text-slate-800">إضافة صورة الجواب</span>
                      <span className="mt-1 block text-[10px] font-bold text-slate-400">اختيارية ويمكن تخطيها</span>
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      disabled={isReceiving}
                      onChange={(event) => {
                        selectReceiptImage(selectedRequests[receiptStep].id, event.target.files?.[0]);
                        event.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>

              {receiveError ? (
                <p className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-bold leading-5 text-red-700">
                  {receiveError}
                </p>
              ) : null}

              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (receiptStep > 0) setReceiptStep((current) => current - 1);
                    else closeReceiptWizard();
                  }}
                  disabled={isReceiving}
                  className="h-10 rounded-xl bg-slate-100 text-xs font-black text-slate-700 disabled:opacity-50"
                >
                  {receiptStep > 0 ? 'السابق' : 'إلغاء'}
                </button>
                {receiptStep < selectedRequests.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setReceiptStep((current) => current + 1)}
                    disabled={isReceiving}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 text-xs font-black text-white transition hover:bg-blue-700 disabled:opacity-60"
                  >
                    التالي
                    <ArrowRight className="h-4 w-4 rotate-180" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={confirmReceipt}
                    disabled={isReceiving}
                    className="h-10 rounded-xl bg-blue-600 text-xs font-black text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isReceiving ? 'جاري الاستلام...' : `تأكيد استلام ${selectedRequests.length}`}
                  </button>
                )}
              </div>
            </section>
          </div>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
