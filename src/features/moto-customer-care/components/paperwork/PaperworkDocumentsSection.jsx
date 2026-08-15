import { Button } from '@/core/ui/button';

const DOCUMENT_STATUS_LABELS = {
  available: 'موجودة',
  in_custody: 'في العهدة',
  transferred: 'تم التحويل',
  with_employee: 'مع موظف',
  stored: 'مخزنة',
  delivered: 'تم التسليم',
  returned: 'مرتجعة',
  lost: 'مفقودة',
  archived: 'مؤرشفة',
};

const DOCUMENT_TYPE_LABELS = {
  jawab: 'جواب',
};

const MOVE_DIRECTION_LABELS = {
  in: 'دخول',
  out: 'خروج',
};

const MOVE_SOURCE_LABELS = {
  opening_custody: 'بداية عهدة',
  from_customer: 'من عميل',
  from_supplier: 'من مورد',
  from_processor: 'من جهة تخليص',
  purchase: 'مع شراء',
  manual: 'إدخال يدوي',
  to_customer: 'تسليم للعميل',
  to_supplier: 'رجوع لمورد',
  to_processor: 'إرسال لجهة تخليص',
  to_employee: 'تسليم لموظف',
  lost: 'مفقود',
  cancelled: 'ملغي',
  other: 'آخر',
  opening: 'رصيد افتتاحي',
  receive: 'استلام',
  transfer: 'نقل عهدة',
  deliver: 'تسليم',
  deliver_to_customer: 'تسليم للعميل',
  return: 'إرجاع',
  manual_adjustment: 'تسوية يدوية',
};

const FILTERS = [
  { id: 'all', label: 'كل الأوراق' },
  { id: 'moves', label: 'حركات الأوراق' },
  { id: 'current', label: 'الموجودة حاليا' },
];

const INACTIVE_STATUSES = new Set([
  'delivered',
  'returned_to_owner',
  'lost',
  'archived',
  'cancelled',
  'closed',
  'done',
]);

function formatDate(value) {
  if (!value) return '--';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function isCurrentDocument(document) {
  return !INACTIVE_STATUSES.has(document?.status);
}

export function PaperworkDocumentsToolbar({ activeFilter, onFilterChange, onCreate }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" onClick={onCreate} className="h-9 rounded-full px-4 text-xs font-black">
        استلام ورق جديد
      </Button>
      {FILTERS.map((filter) => (
        <button
          key={filter.id}
          type="button"
          onClick={() => onFilterChange(filter.id)}
          className={`rounded-full px-3.5 py-2 text-xs font-black transition ${
            activeFilter === filter.id
              ? 'bg-slate-950 text-white shadow-sm'
              : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
          }`}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

export function PaperworkDocumentsContent({ documents = [], moves = [], activeFilter }) {
  if (activeFilter === 'moves') {
    if (!moves.length) return <EmptyState />;
    return moves.map((move) => <PaperworkDocumentMoveCard key={move.id} move={move} />);
  }

  const visibleDocuments = activeFilter === 'current'
    ? documents.filter(isCurrentDocument)
    : documents;

  if (!visibleDocuments.length) return <EmptyState />;
  return visibleDocuments.map((document) => <PaperworkDocumentCard key={document.id} document={document} />);
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
      <h2 className="text-lg font-black text-slate-950">لا توجد أوراق</h2>
      <p className="mt-2 text-sm font-semibold text-slate-500">
        قسم الأوراق يعرض مستندات paperwork_documents وحركاتها من paperwork_document_moves.
      </p>
    </div>
  );
}

function PaperworkDocumentCard({ document }) {
  const statusLabel = DOCUMENT_STATUS_LABELS[document.status] || document.status || '--';
  const isInCustody = document.status === 'in_custody';
  const documentTypeLabel = DOCUMENT_TYPE_LABELS[document.documentType] || document.documentType || '--';
  const isJawabDocument = document.documentType === 'jawab';
  const itemDescription = document.itemDescription || document.manualItemDescription || 'بدون قطعة مرتبطة';
  const productName = document.trackingUnit?.isIncomplete
    ? '⚠️ قطعة غير مكتملة'
    : document.trackingUnit?.dataStatus === 'complete' && !document.trackingUnit?.productProductId
      ? '⚠️ بيانات غير متسقة'
      : document.productName || itemDescription;
  const documentName = document.documentTitle || document.displayTitle || '--';
  const documentOwnerName = document.documentOwnerName ?? document.owner?.name ?? 'غير مسجل';
  const noteText = typeof document.notes === 'string' ? document.notes.trim() : '';
  const trackingValues = (Array.isArray(document.trackingIdentifiers) ? document.trackingIdentifiers : [])
    .map((identifier) => {
      const value = identifier.isNotAvailable ? 'غير متاح' : identifier.value;
      if (!value) return '';
      return `${identifier.label || identifier.code || 'تعريف'}: ${value}`;
    })
    .filter(Boolean)
    .join(' / ');
  const titleText = [documentTypeLabel, productName, documentName].filter(Boolean).join(' - ');

  return (
    <article className="relative bg-white px-4 py-5 transition before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-slate-200 first:before:hidden hover:bg-blue-50/45">
      <div className="min-w-0 space-y-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-black text-blue-700">{documentTypeLabel}</span>
          <div className="min-w-0 max-w-full">
            <div className="flex min-w-0 items-stretch gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="min-w-0 truncate text-sm font-black text-slate-950" title={titleText}>
                  <span>{productName}</span>
                  <span className="mx-2 text-slate-300">/</span>
                  <span>{documentName}</span>
                  {noteText && !isInCustody ? <span className="text-slate-500"> ({noteText})</span> : null}
                </h2>
                <p className="mt-0.5 truncate text-[11px] font-black text-slate-600" title={documentOwnerName}>
                  صاحب الجواب: {documentOwnerName}
                </p>
                {document.trackingUnit?.isIncomplete ? <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black text-amber-800">بيانات غير مكتملة</span> : null}
                {trackingValues ? (
                  <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400" title={trackingValues}>
                    {trackingValues}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <div className={`grid min-w-0 gap-4 ${isInCustody ? 'grid-cols-1' : 'lg:grid-cols-[250px_minmax(0,1fr)]'}`}>
          {!isInCustody ? (
            <aside className="px-1 py-1">
              <div className="space-y-2 text-xs font-bold text-slate-500">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">
                    {statusLabel}
                  </span>
                </div>
              </div>
            </aside>
          ) : null}

          <div className={`min-w-0 ${isInCustody ? 'px-2' : ''}`}>
            <div className="flex min-w-0 items-start gap-3">
              {isJawabDocument && isInCustody ? (
                <div className="flex flex-shrink-0 items-start gap-2">
                  <div className="space-y-1">
                    <span className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-0.5 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200/70">
                      هذا الجواب موجود حاليًا في العهدة
                    </span>
                    {noteText ? <p className="text-[11px] font-bold text-slate-500">ملاحظة: {noteText}</p> : null}
                  </div>
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
                <PaperworkDocumentMovesInline moves={document.moves} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

function PaperworkDocumentMovesInline({ moves }) {
  const rows = Array.isArray(moves) ? moves : [];
  if (!rows.length) return null;

  return (
    <div className="grid justify-items-start gap-2">
      {rows.map((move) => {
        const directionLabel = MOVE_DIRECTION_LABELS[move.moveDirection] || move.moveDirection || 'حركة';
        const partyLabel = `${move.fromLabel || 'غير محدد'} -> ${move.toLabel || 'غير محدد'}`;
        const isOutMove = move.moveDirection === 'out';
        const creatorLabel = move.createdByName || 'مستخدم غير محدد';
        const noteText = typeof move.notes === 'string' ? move.notes.trim() : '';

        return (
          <div key={move.id} className="max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_6px_16px_rgba(15,23,42,0.05)] transition hover:border-slate-300 hover:shadow-[0_8px_20px_rgba(15,23,42,0.07)]">
            <div className="flex min-w-0 flex-wrap items-stretch divide-x divide-x-reverse divide-slate-200/80" dir="rtl">
              <div className={`flex w-16 flex-shrink-0 items-center justify-center px-3 py-2 ${isOutMove ? 'bg-gradient-to-br from-[#d94865] to-[#9f1239]' : 'bg-gradient-to-br from-[#14b8a6] to-[#0f766e]'}`} title={directionLabel}>
                <MoveDirectionGlyph isOutMove={isOutMove} label={directionLabel} />
              </div>
              <div className="min-w-[240px] max-w-[520px] flex-shrink-0 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <p className="min-w-0 max-w-full truncate text-xs font-black text-slate-950" title={directionLabel}>{directionLabel}</p>
                  <span className="text-[11px] font-black text-slate-400">{formatDate(move.movedAt || move.createdAt)}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] font-bold text-slate-500" title={partyLabel}>
                  <span>من </span><span className="text-slate-700">{move.fromLabel || 'غير محدد'}</span>
                  <span className="px-1 text-slate-300">إلى</span><span className="text-slate-700">{move.toLabel || 'غير محدد'}</span>
                </p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-400">
                  <span className="min-w-0 max-w-full truncate" title={creatorLabel}>بواسطة: {creatorLabel}</span>
                  {noteText ? <><span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" /><span className="min-w-0 max-w-full truncate text-slate-500" title={noteText}>ملاحظة: {noteText}</span></> : null}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MoveDirectionGlyph({ isOutMove, label }) {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_18px_rgba(15,23,42,0.16)] backdrop-blur-sm">
      <svg aria-label={label} className={`h-6 w-6 text-white drop-shadow-[0_1px_1px_rgba(15,23,42,0.2)] ${isOutMove ? '-rotate-45' : 'rotate-[135deg]'}`} fill="none" role="img" viewBox="0 0 24 24">
        <path d="M5 12h12.25" stroke="currentColor" strokeLinecap="round" strokeWidth="2.6" />
        <path d="M13.25 7.75 17.5 12l-4.25 4.25" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.6" />
      </svg>
    </span>
  );
}

function PaperworkDocumentMoveCard({ move }) {
  const directionLabel = MOVE_DIRECTION_LABELS[move.moveDirection] || move.moveDirection || 'حركة';
  const sourceLabel = MOVE_SOURCE_LABELS[move.sourceType] || move.sourceType || 'غير محدد';
  const creatorLabel = move.createdByName || 'مستخدم غير محدد';
  const noteText = typeof move.notes === 'string' ? move.notes.trim() : '';

  return (
    <article className="relative bg-white px-4 py-5 transition before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-slate-200 first:before:hidden hover:bg-blue-50/45">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="min-w-0 max-w-full truncate text-sm font-black text-slate-950" title={move.documentTitle}>{move.documentTitle}</h2>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">{directionLabel} - {sourceLabel}</span>
          <span className="text-xs font-black text-slate-400">{formatDate(move.movedAt || move.createdAt)}</span>
        </div>
        <p className="mt-1 truncate text-[11px] font-black text-slate-600" title={move.documentOwnerName}>صاحب الجواب: {move.documentOwnerName ?? 'غير مسجل'}</p>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs font-black text-slate-500">
          <span className="min-w-0 max-w-full truncate" title={move.fromLabel}>من: {move.fromLabel}</span><span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" /><span className="min-w-0 max-w-full truncate" title={move.toLabel}>إلى: {move.toLabel}</span>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
          <span className="min-w-0 max-w-full truncate" title={creatorLabel}>بواسطة: {creatorLabel}</span>
          {noteText ? <><span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" /><span className="min-w-0 max-w-full truncate" title={noteText}>ملاحظة: {noteText}</span></> : null}
        </div>
      </div>
    </article>
  );
}
