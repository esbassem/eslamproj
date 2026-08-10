import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, FileText, ShieldCheck, X } from 'lucide-react';

import { PaperworkDocumentDetailsDialog } from '@/features/moto-customer-care/components/paperwork/PaperworkDocumentDetailsDialog';
import { motoCustomerCareService } from '@/features/moto-customer-care/services/motoCustomerCare.service';
import {
  getVaultPaperworkCacheSnapshot,
  isVaultPaperworkCacheFresh,
  loadVaultPaperworkFirstPage,
  updateVaultPaperworkCache,
} from '@/features/moto-customer-care/services/vaultPaperworkCache';

const VAULT_PAGE_SIZE = 30;

function getTrackingText(document) {
  return (document.trackingIdentifiers || [])
    .map((identifier) => {
      const value = identifier.isNotAvailable ? 'غير متاح' : identifier.value;
      return value ? `${identifier.label || identifier.code || 'تعريف'}: ${value}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ج.م`;
}

function VaultRowsSkeleton() {
  return (
    <div className="divide-y divide-slate-200" aria-label="جاري تحميل أوراق الخزنة">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex min-h-[104px] animate-pulse items-start gap-3 px-4 py-4">
          <span className="h-9 w-9 shrink-0 rounded-xl bg-slate-200" />
          <div className="flex-1 space-y-3">
            <span className="block h-3 w-2/5 rounded bg-slate-200" />
            <span className="block h-2.5 w-3/5 rounded bg-slate-100" />
            <span className="block h-2.5 w-1/3 rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function VaultPaperworkDrawer({ open, onOpenChange, onOpenRequest, tenantId, userId, isOwner = false }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [invoiceBalances, setInvoiceBalances] = useState(() => new Map());
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [balancesError, setBalancesError] = useState('');
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [isDocumentDetailsOpen, setIsDocumentDetailsOpen] = useState(false);
  const timerRef = useRef(null);
  const frameRef = useRef(null);
  const balancesFrameRef = useRef(null);
  const balancesRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const vaultDocuments = useMemo(
    () => documents.filter((document) => document.status === 'in_custody'),
    [documents],
  );

  const cacheOptions = { tenantId, userId, filter: 'in_custody', pageSize: VAULT_PAGE_SIZE };
  const fetchPage = ({ pageSize, cursor: nextCursor }) => motoCustomerCareService.listVaultPaperworkSummary({
    tenantId,
    pageSize,
    cursor: nextCursor,
  });
  const scheduleInvoiceBalances = (nextDocuments, options) => {
    if (balancesFrameRef.current) window.cancelAnimationFrame(balancesFrameRef.current);
    balancesFrameRef.current = window.requestAnimationFrame(() => {
      balancesFrameRef.current = null;
      void loadInvoiceBalances(nextDocuments, options);
    });
  };

  const loadVaultDocuments = async ({ background = false } = {}) => {
    if (!tenantId) return;
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    if (!background) setIsLoading(true);
    setLoadError('');
    try {
      const result = await loadVaultPaperworkFirstPage({
        ...cacheOptions,
        fetchPage,
        force: background,
      });
      if (listRequestRef.current !== requestId) return;
      if (result.invalidated) {
        void loadVaultDocuments({ background: documents.length > 0 });
        return;
      }
      const nextDocuments = result.documents || [];
      setDocuments(nextDocuments);
      setCursor(result.cursor || null);
      setHasMore(Boolean(result.hasMore));
      scheduleInvoiceBalances(nextDocuments, { reset: true });
    } catch (error) {
      if (listRequestRef.current !== requestId) return;
      setLoadError(error.message || 'تعذر تحديث أوراق الخزنة.');
    } finally {
      if (listRequestRef.current === requestId) setIsLoading(false);
    }
  };

  const loadInvoiceBalances = async (nextDocuments, { reset = false } = {}) => {
    const requestId = balancesRequestRef.current + 1;
    balancesRequestRef.current = requestId;
    const linkedDocuments = nextDocuments.filter((document) => document.saleId || document.paperworkRequestId);
    if (reset) setInvoiceBalances(new Map());
    setBalancesError('');
    if (!linkedDocuments.length) {
      setBalancesLoading(false);
      return;
    }

    setBalancesLoading(true);
    try {
      const balances = await motoCustomerCareService.listPaperworkDocumentInvoiceBalances({
        tenantId,
        documents: linkedDocuments.map((document) => ({
          id: document.id,
          sale_id: document.saleId,
          paperwork_request_id: document.paperworkRequestId,
        })),
      });
      if (balancesRequestRef.current === requestId) {
        setInvoiceBalances((current) => reset ? balances : new Map([...current, ...balances]));
      }
    } catch (error) {
      if (balancesRequestRef.current === requestId) setBalancesError(error?.message || 'تعذر تحميل أرصدة الفواتير.');
    } finally {
      if (balancesRequestRef.current === requestId) setBalancesLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !tenantId) return;
    const cached = getVaultPaperworkCacheSnapshot(cacheOptions);
    if (cached) {
      setDocuments(cached.documents || []);
      setCursor(cached.cursor || null);
      setHasMore(Boolean(cached.hasMore));
      setIsLoading(false);
      scheduleInvoiceBalances(cached.documents || [], { reset: true });
      if (!isVaultPaperworkCacheFresh(cached)) void loadVaultDocuments({ background: true });
    } else {
      setDocuments([]);
      setCursor(null);
      setHasMore(false);
      void loadVaultDocuments();
    }
    return () => {
      listRequestRef.current += 1;
      balancesRequestRef.current += 1;
      if (balancesFrameRef.current) window.cancelAnimationFrame(balancesFrameRef.current);
      balancesFrameRef.current = null;
    };
  }, [open, tenantId, userId]);

  const loadMore = async () => {
    if (!tenantId || !cursor || isLoadingMore) return;
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    setIsLoadingMore(true);
    setLoadError('');
    try {
      const result = await fetchPage({ pageSize: VAULT_PAGE_SIZE, cursor });
      if (listRequestRef.current !== requestId) return;
      const nextDocuments = result.documents || [];
      setDocuments((current) => {
        const byId = new Map(current.map((document) => [document.id, document]));
        nextDocuments.forEach((document) => byId.set(document.id, document));
        return [...byId.values()];
      });
      setCursor(result.cursor || null);
      setHasMore(Boolean(result.hasMore));
      scheduleInvoiceBalances(nextDocuments);
    } catch (error) {
      if (listRequestRef.current === requestId) setLoadError(error.message || 'تعذر تحميل المزيد من الأوراق.');
    } finally {
      if (listRequestRef.current === requestId) setIsLoadingMore(false);
    }
  };

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
          {isLoading && !vaultDocuments.length ? (
            <VaultRowsSkeleton />
          ) : loadError && !vaultDocuments.length ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm font-black text-red-600">{loadError}</p>
              <button type="button" onClick={loadVaultDocuments} className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-black text-slate-700 hover:bg-slate-200">إعادة المحاولة</button>
            </div>
          ) : vaultDocuments.length ? (
            <div className="divide-y divide-slate-400">
              {vaultDocuments.map((document) => {
                const trackingText = getTrackingText(document);
                const linkedInvoice = invoiceBalances.get(document.id);
                const shouldShowBalance = Boolean(document.saleId || document.paperworkRequestId);
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
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="min-w-0 truncate text-sm font-black text-slate-950">
                            {document.productName || 'منتج مجهول'}
                          </h3>
                          <p className="mt-0.5 max-w-full truncate text-[10px] font-bold text-slate-400">
                            باسم: <span className="font-black text-slate-600">{document.documentOwnerName ?? document.ownerName ?? 'غير مسجل'}</span>
                          </p>
                          {trackingText ? <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{trackingText}</p> : null}
                        </div>
                        <div className="flex max-w-44 shrink-0 flex-col items-start gap-1.5">
                          {document.hasActiveReleaseAuthorization ? (
                            <p className="inline-flex max-w-full items-center gap-1 text-[10px] font-black text-emerald-600">
                              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                              <span className="truncate">مسموح بالصرف لـ {document.releaseAuthorizedToName}</span>
                            </p>
                          ) : (
                            <p className="inline-flex items-center gap-1 text-[10px] font-black text-red-600">
                              <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                              غير مسموح بالصرف
                            </p>
                          )}
                          {shouldShowBalance ? (
                            <p className={`inline-flex max-w-full items-center gap-1 text-[10px] font-black ${balancesLoading ? 'text-slate-400' : balancesError ? 'text-amber-600' : linkedInvoice?.remainingAmount > 0 ? 'text-red-600' : 'text-emerald-600'}`} title={balancesError || undefined}>
                              {balancesLoading
                                ? 'جاري مراجعة الفاتورة...'
                                : balancesError
                                  ? 'تعذر مراجعة الفاتورة'
                                  : linkedInvoice?.remainingAmount > 0
                                    ? `عليه ${formatMoney(linkedInvoice.remainingAmount)}`
                                    : linkedInvoice
                                      ? 'الفاتورة مسددة'
                                      : 'لا توجد فاتورة مرتبطة'}
                              {!balancesLoading && !balancesError && linkedInvoice ? (
                                <span className="font-mono text-[9px] opacity-70" dir="ltr">
                                  {linkedInvoice.saleNumber ? `#${linkedInvoice.saleNumber}` : 'رقم الفاتورة غير متوفر'}
                                </span>
                              ) : null}
                            </p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                        {document.owner?.name ? (
                          <p className="inline-flex min-w-0 max-w-full text-[10px] font-bold text-slate-600">
                            <span className="truncate">Partner: {document.owner.name}</span>
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
                            className="inline-flex text-[10px] font-bold text-slate-600 transition hover:text-slate-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                            aria-label="فتح طلب الأوراق المرتبط"
                          >
                            عن طريق طلب أوراق
                          </button>
                        ) : (
                          <p className="inline-flex text-[10px] font-bold text-slate-600">
                            تسجيل يدوي
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
              {hasMore ? (
                <div className="flex justify-center px-4 py-5">
                  <button
                    type="button"
                    disabled={isLoadingMore}
                    onClick={loadMore}
                    className="h-10 rounded-xl border border-slate-200 bg-white px-5 text-xs font-black text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:cursor-wait disabled:text-slate-400"
                  >
                    {isLoadingMore ? 'جاري تحميل المزيد...' : 'تحميل المزيد'}
                  </button>
                </div>
              ) : null}
              {loadError ? <p className="px-4 py-3 text-center text-xs font-bold text-amber-700">{loadError}</p> : null}
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
          updateVaultPaperworkCache({ tenantId, userId, update: (current) => current.filter((document) => document.id !== cancelledDocument.id) });
        }}
        onPreviousDeliveryRecorded={(deliveredDocument) => {
          setDocuments((current) => current.filter((document) => document.id !== deliveredDocument.id));
          updateVaultPaperworkCache({ tenantId, userId, update: (current) => current.filter((document) => document.id !== deliveredDocument.id) });
        }}
        onReleaseAuthorized={(authorizedDocument) => {
          setDocuments((current) => current.map((document) => (
            document.id === authorizedDocument.id ? { ...document, ...authorizedDocument } : document
          )));
          updateVaultPaperworkCache({ tenantId, userId, update: (current) => current.map((document) => (
            document.id === authorizedDocument.id ? { ...document, ...authorizedDocument } : document
          )) });
        }}
        onOwnerPartnerChanged={(updatedDocument) => {
          setDocuments((current) => current.map((document) => (
            document.id === updatedDocument.id ? { ...document, ...updatedDocument } : document
          )));
          updateVaultPaperworkCache({ tenantId, userId, update: (current) => current.map((document) => (
            document.id === updatedDocument.id ? { ...document, ...updatedDocument } : document
          )) });
        }}
        onOpenRequest={onOpenRequest}
      />
    </div>,
    document.body,
  );
}
