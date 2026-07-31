import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Clock3, ExternalLink, FileImage, FileText, MapPin, UserRound, X } from 'lucide-react';

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetFooter,
  SheetTitle,
} from '@/core/ui/sheet';
import {
  getPaperworkDocumentMoveDirectionLabel,
  getPaperworkDocumentSourceLabel,
  getPaperworkDocumentStatusLabel,
  motoCustomerCareService,
} from '@/features/moto-customer-care/services/motoCustomerCare.service';

const TABS = [
  { id: 'data', label: 'البيانات' },
  { id: 'attachments', label: 'الصور والمرفقات' },
  { id: 'moves', label: 'الحركات' },
];

const DOCUMENT_TYPE_LABELS = {
  jawab: 'جواب',
  document: 'مستند',
};

function formatDateTime(value) {
  if (!value) return 'غير مسجل';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير مسجل';
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function getTrackingIdentifier(document, patterns) {
  return (document?.trackingIdentifiers || []).find((identifier) => {
    const value = `${identifier.code || ''} ${identifier.label || ''}`.toLowerCase();
    return patterns.some((pattern) => value.includes(pattern));
  });
}

function getIdentifierValue(identifier) {
  if (!identifier) return 'غير مسجل';
  return identifier.isNotAvailable ? 'غير متاح' : identifier.value || 'غير مسجل';
}

function DetailItem({ label, value, wide = false, children }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-slate-50/70 p-3.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <p className="text-[11px] font-black text-slate-400">{label}</p>
      <div className="mt-1.5 break-words text-sm font-bold leading-6 text-slate-800">
        {children || value || 'غير مسجل'}
      </div>
    </div>
  );
}

function DetailsSkeleton() {
  return (
    <div className="mb-4 flex animate-pulse items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3" aria-label="جاري تحميل تفاصيل المستند">
      <span className="h-9 w-9 shrink-0 rounded-xl bg-slate-200" />
      <span className="space-y-2">
        <span className="block h-2.5 w-40 rounded bg-slate-200" />
        <span className="block h-2 w-24 rounded bg-slate-200" />
      </span>
    </div>
  );
}

function DataTab({ document, onOpenRequest }) {
  const chassis = getTrackingIdentifier(document, ['chassis', 'شاسيه', 'شاسي']);
  const engine = getTrackingIdentifier(document, ['engine', 'motor', 'موتور', 'محرك']);
  const partnerName = document.owner?.name || '';

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <DetailItem label="رقم المستند" value={document.id?.slice(0, 8).toUpperCase()} />
      <DetailItem label="عنوان المستند" value={document.documentTitle || document.displayTitle} />
      <DetailItem label="نوع المستند" value={DOCUMENT_TYPE_LABELS[document.documentType] || document.documentType} />
      <DetailItem label="الاسم المكتوب على المستند" value={document.documentOwnerName || document.ownerName || 'غير مسجل'} />
      <DetailItem label="Partner المرتبط" value={partnerName || 'غير مرتبط بملف Partner'} />
      <DetailItem label="مصدر المستند" value={getPaperworkDocumentSourceLabel(document.sourceType)} />
      <DetailItem label="طلب الأوراق المرتبط">
        {document.paperworkRequestId ? (
          <button
            type="button"
            onClick={() => onOpenRequest?.(document.paperworkRequestId)}
            className="font-black text-blue-700 underline decoration-blue-200 underline-offset-4 hover:text-blue-900"
          >
            {document.paperworkRequestId.slice(0, 8).toUpperCase()}
          </button>
        ) : 'غير مرتبط بطلب أوراق'}
      </DetailItem>
      <DetailItem label="المنتج" value={document.productName || document.manualItemDescription || 'غير مسجل'} />
      <DetailItem label="رقم الشاسيه" value={getIdentifierValue(chassis)} />
      <DetailItem label="رقم الموتور" value={getIdentifierValue(engine)} />
      <DetailItem label="الفرع" value={document.branchName || 'غير مسجل'} />
      <DetailItem label="حالة المستند" value={getPaperworkDocumentStatusLabel(document.status)} />
      <DetailItem label="مكانه الحالي" value={document.currentLocation || document.latestMove?.toLabel || 'غير مسجل'} />
      <DetailItem label="صاحب العهدة الحالي" value={document.currentCustodianName || 'لا توجد عهدة مسجلة'} />
      <DetailItem label="تاريخ الاستلام" value={formatDateTime(document.latestMove?.movedAt || document.createdAt)} />
      <DetailItem label="تاريخ الإنشاء" value={formatDateTime(document.createdAt)} />
      <DetailItem label="الموظف المسجل" value={document.createdByName || 'غير مسجل'} />
      <DetailItem label="الملاحظات" value={document.notes || 'لا توجد ملاحظات'} wide />
    </div>
  );
}

function AttachmentsTab({ attachments = [] }) {
  if (!attachments.length) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center">
        <FileImage className="h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-black text-slate-600">لا توجد صور أو مرفقات لهذا المستند.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

function MovesTab({ moves = [] }) {
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
            {move.notes ? <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold leading-6 text-slate-600">{move.notes}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function PaperworkDocumentDetailsDialog({ open, onOpenChange, document, tenantId, onOpenRequest }) {
  const [details, setDetails] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('data');
  const requestIdRef = useRef(0);
  const tabsId = useId();
  const displayedDocument = details?.id === document?.id ? { ...document, ...details } : document;

  useEffect(() => {
    if (!open || !tenantId || !document?.id) return undefined;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setDetails(null);
    setError('');
    setActiveTab('data');
    setIsLoading(true);

    motoCustomerCareService.getPaperworkDocumentDetails({
      tenantId,
      documentId: document.id,
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
  }, [document?.id, open, tenantId]);

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen) {
      requestIdRef.current += 1;
      setError('');
      setDetails(null);
      setActiveTab('data');
    }
    onOpenChange(nextOpen);
  };

  const handleTabKeyDown = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === 'ArrowLeft' ? 1 : -1;
    const nextIndex = (index + offset + TABS.length) % TABS.length;
    setActiveTab(TABS[nextIndex].id);
    globalThis.document?.getElementById?.(`${tabsId}-${TABS[nextIndex].id}`)?.focus();
  };

  if (!displayedDocument) return null;
  const ownerName = displayedDocument.documentOwnerName ?? displayedDocument.ownerName ?? 'غير مسجل';
  const title = displayedDocument.documentTitle || displayedDocument.displayTitle || DOCUMENT_TYPE_LABELS[displayedDocument.documentType] || 'مستند';

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="center"
        dir="rtl"
        overlayClassName="z-[140] bg-slate-950/45 backdrop-blur-[2px]"
        className="inset-0 z-[150] h-[100dvh] w-full max-w-none border-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:h-[min(88vh,900px)] sm:w-[min(94vw,1050px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[26px] sm:border sm:border-slate-200"
        aria-describedby={undefined}
      >
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <FileText className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <SheetTitle className="truncate text-lg font-black text-slate-950 sm:text-xl">{title}</SheetTitle>
                <p className="mt-0.5 truncate text-xs font-bold text-slate-500">باسم: <span className="font-black text-slate-700">{ownerName}</span></p>
                <span className="mt-2 inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700 ring-1 ring-inset ring-emerald-200">
                  {getPaperworkDocumentStatusLabel(displayedDocument.status)}
                </span>
              </div>
            </div>
            <SheetClose className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 hover:text-slate-900" aria-label="إغلاق تفاصيل المستند">
              <X className="hidden h-5 w-5 sm:block" />
              <ArrowRight className="h-5 w-5 sm:hidden" />
            </SheetClose>
          </div>
          <div role="tablist" aria-label="أقسام تفاصيل المستند" className="mt-4 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
            {TABS.map((tab, index) => (
              <button
                key={tab.id}
                id={`${tabsId}-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`${tabsId}-${tab.id}-panel`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
                className={`min-w-fit flex-1 rounded-lg px-3 py-2 text-xs font-black transition ${activeTab === tab.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white px-4 py-5 sm:px-6">
          {error ? (
            <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">{error}</div>
          ) : null}
          {isLoading && !details ? <DetailsSkeleton /> : null}
          {activeTab === 'data' ? (
            <div id={`${tabsId}-data-panel`} role="tabpanel" aria-labelledby={`${tabsId}-data`}><DataTab document={displayedDocument} onOpenRequest={onOpenRequest} /></div>
          ) : null}
          {activeTab === 'attachments' ? (
            <div id={`${tabsId}-attachments-panel`} role="tabpanel" aria-labelledby={`${tabsId}-attachments`}><AttachmentsTab attachments={displayedDocument.attachments || (displayedDocument.jawabPhoto ? [displayedDocument.jawabPhoto] : [])} /></div>
          ) : null}
          {activeTab === 'moves' ? (
            <div id={`${tabsId}-moves-panel`} role="tabpanel" aria-labelledby={`${tabsId}-moves`}><MovesTab moves={displayedDocument.moves || []} /></div>
          ) : null}
        </div>

        <SheetFooter className="shrink-0 justify-end bg-white px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-4">
          <SheetClose className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-black text-white transition hover:bg-slate-800">إغلاق</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
