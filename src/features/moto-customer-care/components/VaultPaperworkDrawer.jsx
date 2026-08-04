import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, ShieldCheck, X } from 'lucide-react';

import { PaperworkDocumentDetailsDialog } from '@/features/moto-customer-care/components/paperwork/PaperworkDocumentDetailsDialog';
import { motoCustomerCareService } from '@/features/moto-customer-care/services/motoCustomerCare.service';

function getTrackingText(document) {
  return (document.trackingIdentifiers || [])
    .map((identifier) => {
      const value = identifier.isNotAvailable ? 'غير متاح' : identifier.value;
      return value ? `${identifier.label || identifier.code || 'تعريف'}: ${value}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

export function VaultPaperworkDrawer({ open, onOpenChange, onOpenRequest, tenantId, isOwner = false }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [isDocumentDetailsOpen, setIsDocumentDetailsOpen] = useState(false);
  const timerRef = useRef(null);
  const frameRef = useRef(null);
  const vaultDocuments = useMemo(
    () => documents.filter((document) => document.status === 'in_custody'),
    [documents],
  );

  const loadVaultDocuments = async () => {
    if (!tenantId) return;
    setIsLoading(true);
    setLoadError('');
    try {
      const result = await motoCustomerCareService.listPaperworkDocuments({
        tenantId,
        limit: null,
        status: 'in_custody',
      });
      setDocuments(result.documents || []);
    } catch (error) {
      setLoadError(error.message || 'تعذر تحميل أوراق الخزنة.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !tenantId) return;
    loadVaultDocuments();
  }, [open, tenantId]);

  useEffect(() => {
    window.clearTimeout(timerRef.current);
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    if (open) {
      setMounted(true);
      setVisible(false);
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = window.requestAnimationFrame(() => {
          setVisible(true);
          frameRef.current = null;
        });
      });
    } else {
      setVisible(false);
      timerRef.current = window.setTimeout(() => setMounted(false), 240);
    }
    return () => {
      window.clearTimeout(timerRef.current);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (!mounted) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !isDocumentDetailsOpen) onOpenChange(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isDocumentDetailsOpen, mounted, onOpenChange]);

  const openDocumentDetails = (document) => {
    setSelectedDocument(document);
    setIsDocumentDetailsOpen(true);
  };

  if (!mounted) return null;

  return createPortal(
    <div className={`fixed inset-0 z-[130] ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`} dir="rtl">
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className={`absolute inset-0 bg-slate-950/30 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        aria-label="إغلاق نافذة أوراق الخزنة"
      />
      <aside className={`absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-2xl transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${visible ? 'translate-x-0' : 'translate-x-full'}`}>
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black text-slate-950">الأوراق الموجودة</h2>
              <p className="text-[10px] font-bold text-slate-400">{vaultDocuments.length} ورقة في الخزنة</p>
            </div>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="إغلاق">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex min-h-full items-center justify-center text-sm font-black text-slate-400">جاري تحميل الأوراق...</div>
          ) : loadError ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-black text-red-600">{loadError}</p>
              <button type="button" onClick={loadVaultDocuments} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-200">إعادة المحاولة</button>
            </div>
          ) : vaultDocuments.length ? (
            <div className="divide-y divide-slate-400">
              {vaultDocuments.map((document) => {
                const trackingText = getTrackingText(document);
                return (
                  <article
                    key={document.id}
                    role="button"
                    tabIndex={0}
                    onMouseDown={(event) => event.currentTarget.focus()}
                    onClick={() => openDocumentDetails(document)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openDocumentDetails(document);
                      }
                    }}
                    className="flex cursor-pointer items-start gap-3 px-4 py-4 outline-none transition hover:bg-emerald-50/30 focus-visible:bg-emerald-50/50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500"
                    aria-label={`فتح تفاصيل ${document.documentTitle || document.displayTitle || 'المستند'}`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="min-w-0">
                        <h3 className="min-w-0 truncate text-sm font-black text-slate-950">
                          {document.productName || 'منتج مجهول'}
                        </h3>
                        <p className="mt-0.5 max-w-full truncate text-[10px] font-bold text-slate-400">
                          باسم: <span className="font-black text-slate-600">{document.documentOwnerName ?? document.ownerName ?? 'غير مسجل'}</span>
                        </p>
                      </div>
                      {trackingText ? <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{trackingText}</p> : null}
                      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                        {document.hasActiveReleaseAuthorization ? (
                          <p className="inline-flex min-w-0 max-w-full rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700 ring-1 ring-blue-200/80">
                            <span className="truncate">متاح للصرف: {document.releaseAuthorizedToName}</span>
                          </p>
                        ) : null}
                        {document.owner?.name ? (
                          <p className="inline-flex min-w-0 max-w-full rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200/80">
                            <span className="truncate">Partner: <span className="font-black">{document.owner.name}</span></span>
                          </p>
                        ) : (
                          <p className="inline-flex rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 ring-1 ring-amber-200/80">
                            لا يوجد Partner مرتبط
                          </p>
                        )}
                        {document.paperworkRequestId ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpenRequest?.(document.paperworkRequestId);
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                            className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700 ring-1 ring-blue-200/80 transition hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
                            aria-label="فتح طلب الأوراق المرتبط"
                          >
                            عن طريق طلب أوراق
                          </button>
                        ) : (
                          <p className="inline-flex rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700 ring-1 ring-blue-200/80">
                            تسجيل يدوي
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-full items-center justify-center px-6 text-center text-sm font-black text-slate-400">لا توجد أوراق في الخزنة حاليًا.</div>
          )}
        </div>
      </aside>
      <PaperworkDocumentDetailsDialog
        open={isDocumentDetailsOpen}
        onOpenChange={setIsDocumentDetailsOpen}
        document={selectedDocument}
        tenantId={tenantId}
        isOwner={isOwner}
        onCancelled={(cancelledDocument) => {
          setDocuments((current) => current.filter((document) => document.id !== cancelledDocument.id));
        }}
        onPreviousDeliveryRecorded={(deliveredDocument) => {
          setDocuments((current) => current.filter((document) => document.id !== deliveredDocument.id));
        }}
        onReleaseAuthorized={(authorizedDocument) => {
          setDocuments((current) => current.map((document) => (
            document.id === authorizedDocument.id ? { ...document, ...authorizedDocument } : document
          )));
        }}
        onOpenRequest={onOpenRequest}
      />
    </div>,
    document.body,
  );
}
