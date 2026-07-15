import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Building2, FileText, X } from 'lucide-react';
import { ProcessorPaperworkReceiptDrawer } from '@/features/moto-customer-care/components/ProcessorPaperworkReceiptDrawer';

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

function getRequestSentAt(request) {
  return [...(request.events || [])]
    .reverse()
    .find((event) => (
      event.eventType === 'sent_to_supplier'
      || event.newStage === 'sent_to_processor'
    ))?.createdAt
    || request.stageEnteredAt
    || null;
}

function getSentAgeMeta(value) {
  if (!value) {
    return {
      label: 'لم تحدد المدة',
      className: 'border-slate-200 bg-slate-50 text-slate-500',
    };
  }

  const date = new Date(value);
  const now = new Date();

  if (Number.isNaN(date.getTime())) {
    return {
      label: 'لم تحدد المدة',
      className: 'border-slate-200 bg-slate-50 text-slate-500',
    };
  }

  const elapsedMs = Math.max(now.getTime() - date.getTime(), 0);
  const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
  const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
  const label = elapsedHours < 24
    ? `منذ ${Math.max(elapsedHours, 1).toLocaleString('ar-EG')} ساعة`
    : `منذ ${elapsedDays.toLocaleString('ar-EG')} يوم`;

  if (elapsedDays >= 7) {
    return {
      label,
      className: 'border-red-200 bg-red-50 text-red-700',
    };
  }

  if (elapsedDays >= 5) {
    return {
      label,
      className: 'border-orange-200 bg-orange-50 text-orange-700',
    };
  }

  if (elapsedDays >= 3) {
    return {
      label,
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }

  return {
    label,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  };
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

export function PendingProcessorPaperworkDrawer({
  open,
  onOpenChange,
  requests = [],
  tenantId,
  onReceived,
}) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [selectedProcessor, setSelectedProcessor] = useState(null);
  const closeTimerRef = useRef(null);
  const openFrameRef = useRef(null);

  useEffect(() => {
    window.clearTimeout(closeTimerRef.current);

    if (openFrameRef.current) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }

    if (open) {
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
      setSelectedProcessor(null);
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
      if (event.key === 'Escape') onOpenChange(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mounted, onOpenChange]);

  const groupedRequests = useMemo(() => {
    const groups = new Map();

    requests
      .filter((request) => ['sent_to_processor', 'processor_ready'].includes(request.currentStage))
      .forEach((request) => {
        const processorId = request.processor?.id || request.processorPartnerId || 'unknown';
        const processorName = request.processor?.name || 'جهة غير محددة';
        const current = groups.get(processorId) || {
          id: processorId,
          name: processorName,
          requests: [],
        };

        current.requests.push(request);
        groups.set(processorId, current);
      });

    return Array.from(groups.values()).sort((first, second) => (
      first.name.localeCompare(second.name, 'ar')
    ));
  }, [requests]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-[130] ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`}
      dir="rtl"
    >
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className={`absolute inset-0 bg-slate-950/30 transition-opacity duration-200 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
        aria-label="إغلاق نافذة الأوراق المنتظرة"
      />

      <aside
        className={`absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-2xl will-change-transform transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
          visible ? 'translate-x-0' : 'translate-x-full'
        }`}
        aria-label="أوراق بانتظار استلامها من الجهات"
      >
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-4.5 w-4.5" />
            </span>
            <h2 className="truncate text-base font-black text-slate-950">
              أوراق بانتظار استلامها من الجهات
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200"
            aria-label="إغلاق"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-white">
          {groupedRequests.length ? (
            <div>
              {groupedRequests.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedProcessor(group)}
                  className="block w-full border-b border-slate-200 text-right transition hover:bg-blue-50/30 last:border-b-0"
                >
                  <span className="flex items-center justify-between gap-3 px-4 pb-2 pt-3.5">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center text-blue-600">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <span className="truncate text-sm font-black text-slate-950">{group.name}</span>
                    </span>
                    <span className="shrink-0 text-[10px] font-black text-slate-400">
                      {group.requests.length} طلب
                    </span>
                  </span>

                  <span className="mr-8 block divide-y divide-slate-100 px-4">
                    {group.requests.map((request) => {
                      const sentAt = getRequestSentAt(request);
                      const sentAgeMeta = getSentAgeMeta(sentAt);

                      return (
                        <span
                          key={request.id}
                          className="flex w-full items-start gap-3 py-4 text-right"
                        >
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center text-slate-400">
                            <FileText className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="min-w-0 truncate text-xs font-black text-slate-900">
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
                            <span className="mt-0.5 block truncate text-[10px] font-bold text-slate-400">
                              {(() => {
                                const identifiers = Array.isArray(request.trackingIdentifiers)
                                  ? request.trackingIdentifiers
                                  : [];
                                const chassis = identifiers.find((identifier) => (
                                  /chassis|شاسيه/i.test(`${identifier.code || ''} ${identifier.label || ''}`)
                                ));
                                const engine = identifiers.find((identifier) => (
                                  /engine|motor|موتور|محرك/i.test(`${identifier.code || ''} ${identifier.label || ''}`)
                                ));

                                return [
                                  chassis?.value ? `شاسيه ${chassis.value}` : '',
                                  engine?.value ? `موتور ${engine.value}` : '',
                                ].filter(Boolean).join(' · ') || 'لا توجد أرقام تعريف';
                              })()}
                            </span>
                            {getSaleBlockNotes(request.documentOwnerNote) ? (
                              <span className="mt-1.5 block rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[10px] font-black text-red-800">
                                حظر البيع: {getSaleBlockNotes(request.documentOwnerNote)}
                              </span>
                            ) : null}
                            <span className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="truncate text-[9px] font-bold text-blue-500">
                                أُرسل للجهة: {formatSentAt(sentAt)}
                              </span>
                              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-black leading-4 ${sentAgeMeta.className}`}>
                                {sentAgeMeta.label}
                              </span>
                            </span>
                          </span>
                        </span>
                      );
                    })}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex min-h-full items-center justify-center px-6 text-center">
              <p className="text-sm font-black text-slate-400">لا توجد أوراق عند الجهات حاليًا.</p>
            </div>
          )}
        </div>
      </aside>
      <ProcessorPaperworkReceiptDrawer
        processor={selectedProcessor}
        open={Boolean(selectedProcessor)}
        tenantId={tenantId}
        onReceived={(receivedItems) => {
          onReceived?.(receivedItems);
          const receivedIds = new Set(receivedItems.map((item) => item.requestId));
          setSelectedProcessor((current) => {
            if (!current) return null;
            const remainingRequests = current.requests.filter((request) => !receivedIds.has(request.id));
            return remainingRequests.length
              ? { ...current, requests: remainingRequests }
              : null;
          });
        }}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSelectedProcessor(null);
        }}
      />
    </div>,
    document.body,
  );
}
