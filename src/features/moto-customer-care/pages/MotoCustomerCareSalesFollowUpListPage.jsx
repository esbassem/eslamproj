import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CircleAlert, CircleCheck, FileText, FolderOpen, ImagePlus, PackagePlus, Search, UploadCloud } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDismissButton,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { QuickStockUnitSheet } from '@/features/dashboard/components/QuickStockUnitSheet';
import { inventoryService } from '@/features/inventory/api/inventory.api';
import { useMotoCustomerCareSales } from '@/features/moto-customer-care/hooks/useMotoCustomerCareSales';
import { motoCustomerCareService } from '@/features/moto-customer-care/services/motoCustomerCare.service';

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} ج.م`;
}

function formatDate(value) {
  if (!value) {
    return '--';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatFileSize(size) {
  const value = Number(size || 0);
  if (!value) return '';
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function countSaleProducts(sales) {
  return sales.reduce((total, sale) => total + (Array.isArray(sale.items) ? sale.items.length : 0), 0);
}

function countTrackedSaleProducts(sales) {
  return sales.reduce((total, sale) => {
    const saleItems = Array.isArray(sale.items) ? sale.items : [];
    return total + saleItems.filter((item) => Boolean(item.trackingUnitId)).length;
  }, 0);
}

function formatAttributesText(attributes) {
  return (Array.isArray(attributes) ? attributes : [])
    .map((attribute) => attribute.value)
    .filter(Boolean)
    .join(' - ');
}

function formatPaperAttributesText(attributes) {
  return (Array.isArray(attributes) ? attributes : [])
    .map((attribute) => attribute.value)
    .filter(Boolean)
    .join(' / ');
}

function getLicenseStatusLabel(status) {
  if (status === 'licensed') return 'مرخص';
  if (status === 'jawab') return 'جواب';
  return status || '--';
}

function getPaperLicenseSummary(license) {
  if (!license) return 'لا يوجد سجل ترخيص';

  const parts = [getLicenseStatusLabel(license.status)];
  if (license.status === 'licensed') {
    if (license.number) parts.push(`رقم ${license.number}`);
    if (license.expiresAt) parts.push(`ينتهي ${license.expiresAt}`);
    if (license.issuingAuthority) parts.push(license.issuingAuthority);
  }

  return parts.filter(Boolean).join(' / ');
}

const PAPERWORK_STATUS_LABELS = {
  open: 'مفتوح',
  deferred: 'مؤجل',
  blocked: 'متوقف',
  done: 'منتهي',
  cancelled: 'ملغي',
};

const PAPERWORK_PRIORITY_LABELS = {
  low: 'منخفض',
  normal: 'عادي',
  high: 'مرتفع',
  urgent: 'عاجل',
};

const PAPERWORK_TYPE_LABELS = {
  new_document: 'مستند جديد',
  ownership_transfer: 'نقل ملكية',
  correction: 'تصحيح',
  replacement: 'بدل فاقد',
  other: 'أخرى',
};

const PAPERWORK_DOCUMENT_STATUS_LABELS = {
  available: 'موجودة',
  in_custody: 'في العهدة',
  with_employee: 'مع موظف',
  stored: 'مخزنة',
  delivered: 'تم التسليم',
  delivered_to_customer: 'تم التسليم للعميل',
  returned: 'مرتجعة',
  lost: 'مفقودة',
  archived: 'مؤرشفة',
};

const PAPERWORK_DOCUMENT_TYPE_LABELS = {
  jawab: 'جواب',
};

const PAPERWORK_MOVE_DIRECTION_LABELS = {
  in: 'دخول',
  out: 'خروج',
};

const PAPERWORK_MOVE_SOURCE_LABELS = {
  opening_custody: 'بداية عهدة',
  from_customer: 'من عميل',
  from_supplier: 'من مورد',
  from_processor: 'من جهة تخليص',
  purchase: 'مع شراء',
  manual: 'إدخال يدوي',
  to_customer: 'تسليم للعميل',
  to_supplier: 'رجوع لمورد',
  to_processor: 'إرسال لجهة تخليص',
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

const paperworkDocumentFilters = [
  { id: 'all', label: 'كل الأوراق' },
  { id: 'moves', label: 'حركات الأوراق' },
  { id: 'current', label: 'الموجودة حاليا' },
];

const inactiveDocumentStatuses = new Set(['delivered', 'delivered_to_customer', 'returned_to_owner', 'lost', 'archived', 'cancelled', 'closed', 'done']);

function isCurrentPaperworkDocument(document) {
  return !inactiveDocumentStatuses.has(document?.status);
}

function getSectionReports(sectionId, sales, summary, paperworkDocuments = []) {
  if (sectionId === 'papers') {
    const currentDocuments = paperworkDocuments.filter(isCurrentPaperworkDocument);

    return [
      { label: 'كل الأوراق', value: paperworkDocuments.length },
      { label: 'الموجودة حاليا', value: currentDocuments.length },
    ];
  }

  return [
    { label: 'عدد المبيعات', value: summary.count },
    { label: 'إجمالي البيع', value: formatMoney(summary.totalAmount) },
  ];
}

function buildSectionSummary(sales) {
  return sales.reduce(
    (accumulator, sale) => {
      accumulator.count += 1;
      accumulator.totalAmount += sale.totalAmount;
      accumulator.paidAmount += sale.paidAmount;
      accumulator.remainingAmount += sale.remainingAmount;

      if (sale.remainingAmount > 0) {
        accumulator.openCount += 1;
      }

      if (sale.status === 'completed' || sale.status === 'confirmed') {
        accumulator.confirmedCount += 1;
      }

      return accumulator;
    },
    {
      count: 0,
      totalAmount: 0,
      paidAmount: 0,
      remainingAmount: 0,
      openCount: 0,
      confirmedCount: 0,
    },
  );
}

function ReportNumber({ label, value, active = false }) {
  return (
    <div className={`min-w-0 rounded-full px-3 py-2 text-center ring-1 ${
      active
        ? 'bg-slate-100 text-slate-950 ring-slate-200/80'
        : 'bg-white/[0.10] text-white ring-white/10'
    }`}>
      <p className={`truncate text-[10px] font-black ${active ? 'text-slate-500' : 'text-blue-50/60'}`}>{label}</p>
      <p className={`mt-0.5 truncate font-mono text-xs font-black ${active ? 'text-slate-950' : 'text-white/90'}`} dir="ltr">{value}</p>
    </div>
  );
}

const followUpSections = [
  { id: 'sales', label: 'المبيعات' },
  { id: 'papers', label: 'الأوراق' },
];

function FollowUpSectionsPanel({ activeSection, onSectionChange, sales, paperworkDocuments = [] }) {
  const sectionStats = useMemo(() => {
    return {
      sales: sales,
      papers: paperworkDocuments,
    };
  }, [paperworkDocuments, sales]);

  return (
    <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3 py-1 lg:pr-6">
      {followUpSections.map((section) => {
        const sectionRows = sectionStats[section.id] || [];
        const sectionSales = section.id === 'papers' ? sales : sectionRows;
        const sectionSummary = buildSectionSummary(sectionSales);
        const reports = getSectionReports(section.id, sectionSales, sectionSummary, paperworkDocuments);
        const isActive = activeSection === section.id;

        return (
          <button
            key={section.id}
            type="button"
            onClick={() => onSectionChange(section.id)}
            className={`group relative w-full overflow-hidden rounded-2xl border px-4 py-4 text-right transition duration-200 ${
              isActive
                ? 'border-white bg-white text-slate-950 shadow-[0_18px_40px_rgba(15,23,42,0.18)]'
                : 'border-white/15 bg-white/[0.10] text-white/85 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:border-white/30 hover:bg-white/[0.16]'
            }`}
          >
            <div className={`absolute inset-y-5 right-0 w-1.5 rounded-l-full transition ${
              isActive ? 'bg-[#2189ff]' : 'bg-transparent'
            }`} aria-hidden="true" />
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className={`text-lg font-black leading-6 ${isActive ? 'text-slate-950' : 'text-blue-50'}`}>{section.label}</p>
              </div>
              <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full transition ${
                isActive ? 'bg-[#2189ff]' : 'bg-white/25 group-hover:bg-white/45'
              }`} aria-hidden="true" />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {reports.slice(0, 2).map((report) => (
                <ReportNumber key={report.label} label={report.label} value={report.value} active={isActive} />
              ))}
            </div>
          </button>
        );
      })}
    </aside>
  );
}

function hasPaperworkRequestForItem(item, paperworkRequests) {
  return (Array.isArray(paperworkRequests) ? paperworkRequests : []).some((request) => {
    if (item?.id && request.saleLineId === item.id) {
      return true;
    }

    return Boolean(item?.trackingUnitId && request.trackingUnitId === item.trackingUnitId);
  });
}

function TrackingUnitPhotosInline({ item }) {
  const attachments = item?.attachments || {};

  if (!item?.trackingUnitId) {
    return null;
  }

  return (
    <PaperProductAttachmentStatus attachments={attachments} compact />
  );
}

function SaleProductsCards({ items, paperworkRequests = [], onRegisterTrackingUnit, onCreatePaperworkRequest }) {
  const saleItems = Array.isArray(items) ? items : [];

  if (!saleItems.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-xs font-black text-slate-400">
        لا توجد منتجات مسجلة
      </div>
    );
  }

  return (
    <div className="grid justify-items-start gap-2">
      {saleItems.map((item, index) => {
        const attributes = item.trackingUnitId && Array.isArray(item.trackingUnitAttributes) ? item.trackingUnitAttributes : [];
        const attributesText = formatAttributesText(attributes);
        const itemName = item.displayName || item.name || item.description || `منتج ${index + 1}`;
        const missingTrackingUnit = item.tracking === 'serial' && !item.trackingUnitId;
        const licenseSummary = getPaperLicenseSummary(item.license);
        const missingPaperworkRequest = !hasPaperworkRequestForItem(item, paperworkRequests);
        const itemPrice = formatMoney(item.total || item.unitPrice);

        return (
          <div key={item.id || index} className="max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_6px_16px_rgba(15,23,42,0.05)] transition hover:border-slate-300 hover:shadow-[0_8px_20px_rgba(15,23,42,0.07)]">
            <div className="flex min-w-0 flex-wrap items-stretch divide-x divide-x-reverse divide-slate-200/80" dir="rtl">
              <div className="min-w-[280px] max-w-[560px] flex-shrink-0 px-3 py-2">
                {missingTrackingUnit ? (
                  <>
                    <button
                      type="button"
                      onClick={() => onRegisterTrackingUnit?.(item)}
                      className="block max-w-full truncate text-right text-xs font-black text-red-600 transition hover:text-red-700 hover:underline"
                    >
                      لم يتم تحديد القطعة المباعة
                    </button>
                    <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400" title={itemName}>
                      {itemName}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] font-bold text-slate-500" dir="rtl">
                      السعر <span className="font-mono font-black text-slate-800" dir="ltr">{itemPrice}</span>
                      {Number(item.quantity) > 1 ? (
                        <span className="font-mono text-slate-400" dir="ltr"> x{item.quantity}</span>
                      ) : null}
                    </p>
                    <TrackingUnitPhotosInline item={item} />
                  </>
                ) : (
                  <>
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <p className="min-w-0 max-w-full truncate text-xs font-black text-slate-950" title={itemName}>
                        {itemName}
                      </p>
                      {attributesText ? (
                        <span className="min-w-0 max-w-full truncate border-r border-slate-300 pr-2 text-[11px] font-bold text-slate-600" title={attributesText}>
                          {attributesText}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[11px] font-bold text-slate-500" dir="rtl">
                      {item.trackingUnitId ? (
                        <>
                          <span className={`min-w-0 truncate ${
                            item.license ? 'text-slate-600' : 'text-amber-600'
                          }`} title={licenseSummary}>
                            {licenseSummary}
                          </span>
                          <span className="text-slate-300">-</span>
                        </>
                      ) : null}
                      <span className="flex-shrink-0">السعر</span>
                      <span className="font-mono font-black text-slate-800" dir="ltr">{itemPrice}</span>
                      {Number(item.quantity) > 1 ? (
                        <span className="font-mono text-slate-400" dir="ltr"> x{item.quantity}</span>
                      ) : null}
                    </p>
                    <TrackingUnitPhotosInline item={item} />
                  </>
                )}
                {missingTrackingUnit && attributesText ? (
                  <p className="mt-0.5 truncate text-[11px] font-bold text-slate-600" title={attributesText}>
                    {attributesText}
                  </p>
                ) : null}
              </div>

              <div className="flex w-44 flex-shrink-0 items-center justify-center px-3 py-2 text-center">
                {missingPaperworkRequest ? (
                  <button
                    type="button"
                    onClick={() => onCreatePaperworkRequest?.(item)}
                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-black text-red-600 transition hover:bg-red-50 hover:text-red-700"
                    title="إنشاء طلب أوراق لهذا المنتج"
                  >
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                    <span className="truncate">لم يتم طلب عمل الأوراق</span>
                  </button>
                ) : (
                  <span
                    className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-black text-emerald-700"
                    title="تم طلب عمل الأوراق"
                  >
                    <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="truncate">تم طلب عمل الأوراق</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function buildPaperProductCards(sales) {
  return sales.flatMap((sale) => {
    const saleItems = Array.isArray(sale.items) ? sale.items : [];

    return saleItems.filter((item) => Boolean(item.trackingUnitId)).map((item, index) => {
      const itemName = item.displayName || item.name || item.description || `منتج ${index + 1}`;

      return {
        id: `${sale.id}-${item.id || index}`,
        productName: itemName,
        saleLineId: item.id,
        productProductId: item.productProductId,
        trackingUnitId: item.trackingUnitId,
        attributes: item.trackingUnitId && Array.isArray(item.trackingUnitAttributes) ? item.trackingUnitAttributes : [],
        attributesText: item.trackingUnitId ? formatPaperAttributesText(item.trackingUnitAttributes) : '',
        trackingUnit: item.trackingUnit || null,
        trackingIdentifiers: Array.isArray(item.trackingIdentifiers) ? item.trackingIdentifiers : [],
        license: item.license || null,
        attachments: item.attachments || {},
      };
    });
  });
}

function buildPaperProductDetails(item) {
  const identifiers = (item.trackingIdentifiers || []).map((identifier) => ({
    label: identifier.label || 'رقم تتبع',
    value: identifier.isNotAvailable ? 'لا يوجد' : (identifier.value || ''),
    isMissing: Boolean(identifier.isMissing),
  }));

  return identifiers;
}

function PaperProductDetailsGrid({ item, onEditTracking }) {
  const details = buildPaperProductDetails(item);
  const hasTrackingFields = Array.isArray(item.trackingIdentifiers) && item.trackingIdentifiers.length > 0;

  if (!details.length && !hasTrackingFields) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => onEditTracking(item)}
      className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-right text-[11px] font-bold leading-5 text-slate-400 transition hover:text-slate-600"
    >
      {details.map((detail, index) => (
        <span
          key={`${detail.label}-${index}`}
          className={`inline-flex max-w-full items-baseline gap-1.5 ${detail.isMissing ? 'text-red-600' : 'text-slate-400'}`}
          title={`${detail.label}: ${detail.value || 'فارغ'}`}
        >
          <span>{detail.label}</span>
          <span className={`max-w-[180px] truncate font-mono ${detail.isMissing ? 'text-red-700' : 'text-slate-600'}`} dir="ltr">
            {detail.value || 'فارغ'}
            {detail.isMissing ? <span className="mr-1 font-black text-red-500">!</span> : null}
          </span>
        </span>
      ))}
    </button>
  );
}

function PaperProductPlaceholderCard() {
  return (
    <div className="rounded-xl border border-white/80 bg-white/60 px-3 py-2.5 text-xs font-black text-slate-400 shadow-sm backdrop-blur">
      لم يحدد بعد
    </div>
  );
}

function AttachmentStatusIcon({ attachment, label, compact = false }) {
  const exists = Boolean(attachment?.signedUrl);
  const Icon = exists ? CircleCheck : CircleAlert;
  const className = `${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} flex-shrink-0 ${
    exists ? 'text-emerald-600' : 'text-red-600'
  }`;

  if (exists) {
    return (
      <a
        href={attachment.signedUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex"
        aria-label={`${label}: موجودة`}
        title={`${label}: موجودة`}
      >
        <Icon className={className} />
      </a>
    );
  }

  return (
    <span className="inline-flex" aria-label={`${label}: غير موجودة`} title={`${label}: غير موجودة`}>
      <Icon className={className} />
    </span>
  );
}

function PaperProductAttachmentStatus({ attachments, compact = false }) {
  return (
    <div className={`mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-slate-500 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>
      <span className="inline-flex items-center gap-1" dir="rtl">
        <AttachmentStatusIcon attachment={attachments?.chassis_photo} label="صورة رقم الشاسيه" compact={compact} />
        <AttachmentStatusIcon attachment={attachments?.engine_photo} label="صورة رقم الموتور" compact={compact} />
      </span>
      <span className="font-bold">صورة رقم الشاسيه والموتور</span>
    </div>
  );
}

function PaperProductActionCards({ item }) {
  const attachments = item.attachments || {};

  return (
    <div className="mr-8 mt-2">
      <PaperProductAttachmentStatus attachments={attachments} />
    </div>
  );
}

function PaperProductCard({ item, onEditTracking, onEditLicense }) {
  const licenseSummary = getPaperLicenseSummary(item.license);

  return (
    <article className="relative bg-white px-4 py-5 transition before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-slate-200 first:before:hidden hover:bg-blue-50/45">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="min-w-0 max-w-full truncate text-sm font-black text-slate-950" title={item.productName}>
            {item.productName}
          </h2>
          <span
            className={`min-w-0 max-w-full truncate border-r pr-2 text-xs font-black leading-5 ${
              item.attributesText ? 'border-slate-300 text-slate-500' : 'border-slate-200 text-slate-400'
            }`}
            title={item.attributesText || 'بدون خصائص'}
          >
            {item.attributesText || 'بدون خصائص'}
          </span>
          <button
            type="button"
            onClick={() => onEditLicense(item)}
            className={`min-w-0 max-w-full truncate border-r pr-2 text-right text-xs font-black leading-5 transition hover:text-slate-900 ${
              item.license ? 'border-slate-300 text-slate-500' : 'border-amber-200 text-amber-600'
            }`}
            title={licenseSummary}
          >
            {licenseSummary}
          </button>
        </div>
        <PaperProductActionCards item={item} />
        <PaperProductDetailsGrid item={item} onEditTracking={onEditTracking} />
      </div>
    </article>
  );
}

function PaperworkRequestCard({ request, onEditTracking, onEditLicense }) {
  const licenseSummary = getPaperLicenseSummary(request.license);
  const stageLabel = request.stage?.name || 'مرحلة غير محددة';
  const statusLabel = PAPERWORK_STATUS_LABELS[request.status] || request.status || '--';
  const priorityLabel = PAPERWORK_PRIORITY_LABELS[request.priority] || request.priority || '--';
  const typeLabel = PAPERWORK_TYPE_LABELS[request.requestType] || request.requestType || 'طلب أوراق';
  const customerName = request.customer?.name || request.documentOwner?.name || 'عميل غير محدد';

  return (
    <article className="relative bg-white px-4 py-5 transition before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-slate-200 first:before:hidden hover:bg-blue-50/45">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="min-w-0 max-w-full truncate text-sm font-black text-slate-950" title={request.productName}>
            {request.productName}
          </h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-600">
            {typeLabel}
          </span>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">
            {stageLabel}
          </span>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">
            {statusLabel}
          </span>
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-700">
            {priorityLabel}
          </span>
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-xs font-black text-slate-500">
          <span className="min-w-0 max-w-full truncate" title={customerName}>{customerName}</span>
          {request.attributesText ? (
            <span className="min-w-0 max-w-full truncate border-r border-slate-300 pr-2" title={request.attributesText}>
              {request.attributesText}
            </span>
          ) : null}
          {request.trackingUnitId ? (
            <button
              type="button"
              onClick={() => onEditLicense(request)}
              className={`min-w-0 max-w-full truncate border-r pr-2 text-right transition hover:text-slate-900 ${
                request.license ? 'border-slate-300 text-slate-500' : 'border-amber-200 text-amber-600'
              }`}
              title={licenseSummary}
            >
              {licenseSummary}
            </button>
          ) : (
            <span className="min-w-0 max-w-full truncate border-r border-red-200 pr-2 text-red-600">
              لم يتم تحديد القطعة الفريدة
          </span>
        )}
      </div>
        {request.trackingUnitId ? (
          <PaperProductActionCards item={request} />
        ) : null}
        {request.trackingUnitId ? (
          <PaperProductDetailsGrid item={request} onEditTracking={onEditTracking} />
        ) : null}
        {request.notes ? (
          <p className="mt-2 line-clamp-2 text-xs font-bold leading-5 text-slate-500">{request.notes}</p>
        ) : null}
      </div>
    </article>
  );
}

function PaperworkDocumentCard({ document }) {
  const statusLabel = PAPERWORK_DOCUMENT_STATUS_LABELS[document.status] || document.status || '--';
  const isInCustody = document.status === 'in_custody';
  const documentTypeLabel = PAPERWORK_DOCUMENT_TYPE_LABELS[document.documentType] || document.documentType || '--';
  const isJawabDocument = document.documentType === 'jawab';
  const itemDescription = document.itemDescription || document.manualItemDescription || 'بدون قطعة مرتبطة';
  const productName = document.productName || itemDescription;
  const documentName = document.documentTitle || document.displayTitle || '--';
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
          <span className="text-sm font-black text-blue-700">
            {documentTypeLabel}
          </span>
          <div className="min-w-0 max-w-full">
            <div className="flex min-w-0 items-stretch gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="min-w-0 truncate text-sm font-black text-slate-950" title={titleText}>
                  <span>{productName}</span>
                  <span className="mx-2 text-slate-300">/</span>
                  <span>{documentName}</span>
                  {noteText && !isInCustody ? <span className="text-slate-500"> ({noteText})</span> : null}
                </h2>
                {trackingValues ? (
                  <p className="mt-0.5 truncate text-[11px] font-bold text-slate-400" title={trackingValues}>
                    {trackingValues}
                  </p>
                ) : null}
              </div>
              <div className="flex flex-shrink-0 items-stretch gap-2">
                {isJawabDocument && isInCustody ? (
                  document.jawabPhoto?.signedUrl ? (
                    <div className="mr-4 h-10 w-10 flex-shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                      <img
                        src={document.jawabPhoto.signedUrl}
                        alt="صورة الجواب"
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <p className="mr-4 max-w-[96px] text-[10px] font-black leading-4 text-slate-400">صورة الجواب: غير موجودة</p>
                  )
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
                {isJawabDocument ? (
                  document.jawabPhoto?.signedUrl ? (
                    <div className="mr-4 h-10 w-10 flex-shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50">
                      <img
                        src={document.jawabPhoto.signedUrl}
                        alt="صورة الجواب"
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <p className="mr-4 max-w-[96px] text-[10px] font-black leading-4 text-slate-400">صورة الجواب: غير موجودة</p>
                  )
                ) : null}
              </div>
            </aside>
          ) : null}

          <div className={`min-w-0 ${isInCustody ? 'px-2' : ''}`}>
            <div className="flex min-w-0 items-start gap-3">
              {isJawabDocument && isInCustody ? (
                <div className="flex flex-shrink-0 items-start gap-2">
                  <div className="space-y-1">
                    <span className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-0.5 text-[11px] font-black text-emerald-700 ring-1 ring-emerald-200/70">
                      هذا الجواب حاليا موجود ومسموح بصرفه
                    </span>
                    {noteText ? (
                      <p className="text-[11px] font-bold text-slate-500">ملاحظة: {noteText}</p>
                    ) : null}
                  </div>
                  <Button type="button" disabled className="min-w-[92px] cursor-not-allowed bg-emerald-600 text-white hover:bg-emerald-600 disabled:opacity-60">
                    صرف
                  </Button>
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
        const directionLabel = PAPERWORK_MOVE_DIRECTION_LABELS[move.moveDirection] || move.moveDirection || 'حركة';
        const movedAtLabel = formatDate(move.movedAt || move.createdAt);
        const partyLabel = `${move.fromLabel || 'غير محدد'} -> ${move.toLabel || 'غير محدد'}`;
        const isOutMove = move.moveDirection === 'out';

        return (
          <div key={move.id} className="max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_6px_16px_rgba(15,23,42,0.05)] transition hover:border-slate-300 hover:shadow-[0_8px_20px_rgba(15,23,42,0.07)]">
            <div className="flex min-w-0 flex-wrap items-stretch divide-x divide-x-reverse divide-slate-200/80" dir="rtl">
              <div className={`flex w-16 flex-shrink-0 items-center justify-center px-3 py-2 ${isOutMove ? 'bg-gradient-to-br from-[#d94865] to-[#9f1239]' : 'bg-gradient-to-br from-[#14b8a6] to-[#0f766e]'}`} title={directionLabel}>
                <PaperworkMoveDirectionGlyph isOutMove={isOutMove} label={directionLabel} />
              </div>

              <div className="min-w-[240px] max-w-[520px] flex-shrink-0 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <p className="min-w-0 max-w-full truncate text-xs font-black text-slate-950" title={directionLabel}>
                    {directionLabel}
                  </p>
                  <span className="text-[11px] font-black text-slate-400">{movedAtLabel}</span>
                </div>
                <p className="mt-0.5 truncate text-[11px] font-bold text-slate-500" title={partyLabel}>
                  <span>من </span>
                  <span className="text-slate-700">{move.fromLabel || 'غير محدد'}</span>
                  <span className="px-1 text-slate-300">إلى</span>
                  <span className="text-slate-700">{move.toLabel || 'غير محدد'}</span>
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PaperworkMoveDirectionGlyph({ isOutMove, label }) {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_18px_rgba(15,23,42,0.16)] backdrop-blur-sm">
      <svg
        aria-label={label}
        className={`h-6 w-6 text-white drop-shadow-[0_1px_1px_rgba(15,23,42,0.2)] ${isOutMove ? '-rotate-45' : 'rotate-[135deg]'}`}
        fill="none"
        role="img"
        viewBox="0 0 24 24"
      >
        <path
          d="M5 12h12.25"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.6"
        />
        <path
          d="M13.25 7.75 17.5 12l-4.25 4.25"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.6"
        />
      </svg>
    </span>
  );
}

function PaperworkDocumentMoveCard({ move }) {
  const directionLabel = PAPERWORK_MOVE_DIRECTION_LABELS[move.moveDirection] || move.moveDirection || 'حركة';
  const sourceLabel = PAPERWORK_MOVE_SOURCE_LABELS[move.sourceType] || move.sourceType || 'غير محدد';
  const moveLabel = `${directionLabel} - ${sourceLabel}`;

  return (
    <article className="relative bg-white px-4 py-5 transition before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-slate-200 first:before:hidden hover:bg-blue-50/45">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <h2 className="min-w-0 max-w-full truncate text-sm font-black text-slate-950" title={move.documentTitle}>
            {move.documentTitle}
          </h2>
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-blue-700">
            {moveLabel}
          </span>
          <span className="text-xs font-black text-slate-400">
            {formatDate(move.movedAt || move.createdAt)}
          </span>
        </div>
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs font-black text-slate-500">
          <span className="min-w-0 max-w-full truncate" title={move.fromLabel}>من: {move.fromLabel}</span>
          <span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
          <span className="min-w-0 max-w-full truncate" title={move.toLabel}>إلى: {move.toLabel}</span>
        </div>
      </div>
    </article>
  );
}

function TrackingLicenseSheet({ item, open, onOpenChange, tenantId, onSaved }) {
  const [status, setStatus] = useState('');
  const [number, setNumber] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !item) {
      setStatus('');
      setNumber('');
      setExpiresAt('');
      setIssuingAuthority('');
      setError('');
      return;
    }

    setStatus(item.license?.status || '');
    setNumber(item.license?.number || '');
    setExpiresAt(item.license?.expiresAt || '');
    setIssuingAuthority(item.license?.issuingAuthority || '');
    setError('');
  }, [item, open]);

  const save = async () => {
    if (!tenantId || !item) return;

    setIsSaving(true);
    setError('');

    try {
      await motoCustomerCareService.saveTrackingUnitLicense({
        tenantId,
        trackingUnitId: item.trackingUnitId,
        license: {
          status,
          number,
          expiresAt,
          issuingAuthority,
        },
      });
      await onSaved?.();
      onOpenChange(false);
    } catch (nextError) {
      setError(nextError.message || 'تعذر حفظ بيانات الترخيص.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-lg" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pl-16 text-right">
          <SheetTitle>بيانات الترخيص</SheetTitle>
          <p className="text-sm font-bold text-slate-500">{item?.productName || '--'}</p>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'jawab', label: 'جواب' },
              { value: 'licensed', label: 'مرخص' },
            ].map((option) => {
              const active = status === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    setStatus(option.value);
                    setError('');
                  }}
                  className={`h-16 rounded-xl border text-sm font-black transition ${
                    active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>

          {status === 'licensed' ? (
            <div className="grid gap-4">
              <label className="block space-y-2">
                <span className="text-sm font-black text-slate-700">رقم الرخصة</span>
                <Input value={number} onChange={(event) => setNumber(event.target.value)} placeholder="رقم الرخصة" />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-black text-slate-700">تاريخ انتهاء الترخيص</span>
                <Input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
              </label>
              <label className="block space-y-2">
                <span className="text-sm font-black text-slate-700">جهة الإصدار</span>
                <Input value={issuingAuthority} onChange={(event) => setIssuingAuthority(event.target.value)} placeholder="مرور ايه" />
              </label>
            </div>
          ) : null}

          {!item?.trackingUnitId ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-700">
              لا توجد وحدة تتبع مرتبطة بهذا المنتج لحفظ الترخيص.
            </div>
          ) : null}

          {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSaving}>
            إلغاء
          </Button>
          <Button type="button" onClick={save} disabled={isSaving || !item?.trackingUnitId}>
            {isSaving ? 'جاري الحفظ...' : 'حفظ'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TrackingIdentifiersSheet({ item, open, onOpenChange, tenantId, onSaved }) {
  const [values, setValues] = useState({});
  const [notAvailable, setNotAvailable] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const identifiers = useMemo(() => {
    return Array.isArray(item?.trackingIdentifiers) ? item.trackingIdentifiers : [];
  }, [item]);

  useEffect(() => {
    if (!open || !item) {
      setValues({});
      setNotAvailable({});
      setError('');
      return;
    }

    setValues(Object.fromEntries(identifiers.map((identifier) => [identifier.identifierTypeId, identifier.value || ''])));
    setNotAvailable(Object.fromEntries(identifiers.map((identifier) => [identifier.identifierTypeId, Boolean(identifier.isNotAvailable)])));
    setError('');
  }, [identifiers, item, open]);

  const updateValue = (identifierTypeId, value) => {
    setValues((current) => ({ ...current, [identifierTypeId]: value }));
    setError('');
  };

  const updateNotAvailable = (identifierTypeId, checked) => {
    setNotAvailable((current) => ({ ...current, [identifierTypeId]: checked }));
    if (checked) {
      setValues((current) => ({ ...current, [identifierTypeId]: '' }));
    }
    setError('');
  };

  const save = async () => {
    if (!tenantId || !item) {
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const missingRequired = identifiers.find((identifier) => {
        const value = String(values[identifier.identifierTypeId] || '').trim();
        const isNotAvailable = Boolean(notAvailable[identifier.identifierTypeId]);
        return identifier.isRequired && !value && !(identifier.allowNotAvailable && isNotAvailable);
      });

      if (missingRequired) {
        setError(`أدخل قيمة "${missingRequired.label || 'رقم تتبع'}" أو اختر لا يوجد.`);
        setIsSaving(false);
        return;
      }

      await motoCustomerCareService.saveSaleLineTrackingIdentifiers({
        tenantId,
        lineId: item.saleLineId,
        productProductId: item.productProductId,
        trackingUnitId: item.trackingUnitId,
        identifiers: identifiers.map((identifier) => ({
          identifierTypeId: identifier.identifierTypeId,
          value: values[identifier.identifierTypeId] || '',
          isNotAvailable: Boolean(notAvailable[identifier.identifierTypeId]),
        })),
      });
      await onSaved?.();
      onOpenChange(false);
    } catch (nextError) {
      setError(nextError.message || 'تعذر حفظ تعريفات التتبع.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-lg" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pl-16 text-right">
          <SheetTitle>تعريفات التتبع</SheetTitle>
          <p className="text-sm font-bold text-slate-500">{item?.productName || '--'}</p>
        </SheetHeader>
        <SheetBody className="space-y-4">
          {identifiers.length ? (
            identifiers.map((identifier) => (
              <label key={identifier.identifierTypeId} className="block space-y-2">
                <span className="flex items-center gap-2 text-sm font-black text-slate-700">
                  {identifier.label || 'رقم تتبع'}
                  {identifier.isRequired ? <span className="text-xs text-red-500">مطلوب</span> : null}
                  {identifier.allowNotAvailable ? (
                    <span className="mr-auto flex items-center gap-1.5 text-xs font-bold text-slate-500">
                      <input
                        type="checkbox"
                        checked={Boolean(notAvailable[identifier.identifierTypeId])}
                        onChange={(event) => updateNotAvailable(identifier.identifierTypeId, event.target.checked)}
                      />
                      لا يوجد
                    </span>
                  ) : null}
                </span>
                <Input
                  value={values[identifier.identifierTypeId] || ''}
                  onChange={(event) => updateValue(identifier.identifierTypeId, event.target.value)}
                  placeholder="اكتب القيمة"
                  disabled={Boolean(notAvailable[identifier.identifierTypeId])}
                  className={identifier.isRequired && !String(values[identifier.identifierTypeId] || '').trim() && !notAvailable[identifier.identifierTypeId] ? 'border-red-200 focus:border-red-300 focus:ring-red-50' : ''}
                  dir="ltr"
                />
              </label>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm font-bold text-slate-400">
              لا توجد تعريفات تتبع مرتبطة بتصنيف هذا المنتج.
            </div>
          )}
          {error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
        </SheetBody>
        <SheetFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSaving}>
            إلغاء
          </Button>
          <Button type="button" onClick={save} disabled={isSaving || !identifiers.length}>
            {isSaving ? 'جاري الحفظ...' : 'حفظ'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function TrackingUnitPickerSheet({ item, open, onOpenChange, tenantId, onAttach, onRegisterNew }) {
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [attachingId, setAttachingId] = useState(null);

  useEffect(() => {
    let mounted = true;

    if (!open || !tenantId || !item?.productProductId) {
      setUnits([]);
      setSearch('');
      setStatus('idle');
      setError('');
      setAttachingId(null);
      return undefined;
    }

    setStatus('loading');
    setError('');
    setUnits([]);
    setAttachingId(null);

    inventoryService
      .getSerialUnits({
        tenantId,
        productProductId: item.productProductId,
        status: 'in_stock',
      })
      .then((rows) => {
        if (!mounted) return;
        setUnits(rows || []);
        setStatus('ready');
      })
      .catch((loadError) => {
        if (!mounted) return;
        setUnits([]);
        setStatus('error');
        setError(loadError.message || 'تعذر تحميل القطع المتاحة.');
      });

    return () => {
      mounted = false;
    };
  }, [item, open, tenantId]);

  const filteredUnits = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return units;

    return units.filter((unit) =>
      [unit.trackingNumber, unit.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [search, units]);

  const attach = async (unit) => {
    setAttachingId(unit.id);
    setError('');

    try {
      await onAttach?.(unit);
      onOpenChange(false);
    } catch (attachError) {
      setError(attachError.message || 'تعذر ربط القطعة بالفاتورة.');
    } finally {
      setAttachingId(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-lg" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pl-16 text-right">
          <SheetTitle>تحديد القطعة المباعة</SheetTitle>
          <p className="text-sm font-bold text-slate-500">{item?.displayName || item?.name || item?.description || '--'}</p>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ابحث برقم السيريال / التتبع"
              className="pr-9"
              dir="ltr"
            />
          </div>

          <Button
            type="button"
            variant="secondary"
            onClick={onRegisterNew}
            className="h-12 w-full justify-center gap-2 rounded-2xl font-black"
          >
            <PackagePlus className="h-4 w-4" />
            تسجيل قطعة جديدة
          </Button>

          <div className="min-h-[220px] rounded-2xl border border-slate-200 bg-slate-50/60">
            {status === 'loading' ? (
              <div className="px-4 py-5 text-sm font-black text-slate-500">جاري تحميل القطع المتاحة...</div>
            ) : status === 'error' ? (
              <div className="px-4 py-5 text-sm font-black text-red-700">{error}</div>
            ) : filteredUnits.length ? (
              <div className="divide-y divide-slate-200">
                {filteredUnits.map((unit) => (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => attach(unit)}
                    disabled={Boolean(attachingId)}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-right transition hover:bg-white disabled:cursor-wait disabled:opacity-70"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-sm font-black text-slate-950" dir="ltr">
                        {unit.trackingNumber || unit.id}
                      </span>
                      <span className="mt-0.5 block text-xs font-bold text-slate-400">متاحة للربط</span>
                    </span>
                    <span className="rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-700">
                      {attachingId === unit.id ? 'جاري الربط...' : 'ربط'}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-4 py-8 text-center text-sm font-black text-slate-400">
                لا توجد قطع متاحة لهذا المنتج.
              </div>
            )}
          </div>

          {status !== 'error' && error ? <p className="text-sm font-bold text-red-600">{error}</p> : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function PaperworkRequestSheet({ item, open, onOpenChange, tenantId, onSaved }) {
  const [requestType, setRequestType] = useState('new_document');
  const [priority, setPriority] = useState('normal');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const itemName = item?.displayName || item?.name || item?.description || 'منتج غير محدد';

  useEffect(() => {
    if (!open) return;
    setRequestType('new_document');
    setPriority('normal');
    setNotes('');
    setError('');
    setIsSaving(false);
  }, [open, item?.id]);

  const save = async () => {
    if (!item) return;
    setIsSaving(true);
    setError('');

    try {
      await motoCustomerCareService.createPaperworkRequest({
        tenantId,
        item,
        requestType,
        priority,
        notes,
      });
      await onSaved?.();
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError?.message || 'تعذر إنشاء طلب الأوراق.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-md" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pl-16 text-right">
          <SheetTitle>إنشاء طلب أوراق</SheetTitle>
        </SheetHeader>

        <SheetBody className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-[11px] font-black text-slate-400">المنتج</p>
            <p className="mt-1 truncate text-sm font-black text-slate-950" title={itemName}>{itemName}</p>
            <p className="mt-1 text-[11px] font-bold text-slate-400">
              سيتم ربط الطلب بسطر المنتج في الفاتورة.
            </p>
          </div>

          <label className="block space-y-1.5">
            <span className="text-xs font-black text-slate-500">نوع الطلب</span>
            <select
              value={requestType}
              onChange={(event) => setRequestType(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
            >
              {Object.entries(PAPERWORK_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-black text-slate-500">الأولوية</span>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
            >
              {Object.entries(PAPERWORK_PRIORITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-black text-slate-500">ملاحظات</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
              placeholder="اكتب أي ملاحظة تخص طلب الأوراق"
            />
          </label>

          {error ? (
            <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-black text-red-700">
              {error}
            </div>
          ) : null}
        </SheetBody>

        <SheetFooter>
          <Button type="button" onClick={save} disabled={isSaving} className="w-full">
            {isSaving ? 'جاري إنشاء الطلب...' : 'إنشاء طلب الأوراق'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function PaperworkImagePicker({ value, onChange, tenantId }) {
  const uploadInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryStatus, setLibraryStatus] = useState('idle');
  const [libraryImages, setLibraryImages] = useState([]);
  const [libraryError, setLibraryError] = useState('');
  const [cameraDraftFile, setCameraDraftFile] = useState(null);
  const [cameraPreviewOpen, setCameraPreviewOpen] = useState(false);

  const selectedPreviewUrl = useMemo(() => {
    if (value?.signedUrl) return value.signedUrl;
    if (!value?.file) return '';
    return URL.createObjectURL(value.file);
  }, [value]);

  const cameraPreviewUrl = useMemo(() => {
    if (!cameraDraftFile) return '';
    return URL.createObjectURL(cameraDraftFile);
  }, [cameraDraftFile]);

  useEffect(() => {
    return () => {
      if (selectedPreviewUrl && !value?.signedUrl) URL.revokeObjectURL(selectedPreviewUrl);
    };
  }, [selectedPreviewUrl, value?.signedUrl]);

  useEffect(() => {
    return () => {
      if (cameraPreviewUrl) URL.revokeObjectURL(cameraPreviewUrl);
    };
  }, [cameraPreviewUrl]);

  useEffect(() => {
    let mounted = true;

    if (!libraryOpen) return undefined;

    setLibraryStatus('loading');
    setLibraryError('');
    setLibraryImages([]);

    motoCustomerCareService.listTenantImageFiles({ tenantId })
      .then((images) => {
        if (!mounted) return;
        setLibraryImages(images || []);
        setLibraryStatus('ready');
      })
      .catch((loadError) => {
        if (!mounted) return;
        setLibraryImages([]);
        setLibraryStatus('error');
        setLibraryError(loadError.message || 'تعذر تحميل الصور الموجودة.');
      });

    return () => {
      mounted = false;
    };
  }, [libraryOpen, tenantId]);

  const pickFile = (file, source) => {
    if (!file) return;
    onChange?.({
      source,
      file,
      name: file.name || (source === 'camera' ? 'صورة من الكاميرا' : 'صورة الجواب'),
      size: file.size || null,
    });
    setOptionsOpen(false);
  };

  const selectedTitle = value?.name || value?.originalFileName || value?.path?.split('/').pop() || '';
  const selectedMeta = value?.source === 'existing'
    ? 'صورة موجودة'
    : value?.source === 'camera'
      ? 'صورة من الكاميرا'
      : value?.source === 'upload'
        ? 'صورة جديدة'
        : 'اضغط لاختيار مصدر الصورة';

  return (
    <>
      <div className="space-y-1.5">
        <span className="text-xs font-black text-slate-500">صورة الجواب</span>
        <button
          type="button"
          onClick={() => setOptionsOpen(true)}
          className={`group relative flex min-h-40 w-full overflow-hidden rounded-2xl border-2 border-dashed text-right transition ${
            value ? 'border-blue-200 bg-blue-50/60' : 'border-slate-300 bg-slate-50 hover:border-blue-300 hover:bg-blue-50'
          }`}
        >
          {selectedPreviewUrl ? (
            <img src={selectedPreviewUrl} alt="معاينة صورة الجواب" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          <span className={`relative z-10 flex w-full flex-col items-center justify-center gap-2 p-4 ${
            selectedPreviewUrl ? 'bg-slate-950/42 text-white' : 'text-slate-500'
          }`}>
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${
              selectedPreviewUrl ? 'bg-white/18 text-white' : 'bg-white text-blue-600 shadow-sm ring-1 ring-slate-200'
            }`}>
              <ImagePlus className="h-6 w-6" />
            </span>
            <span className="text-sm font-black">{selectedTitle || 'إضافة صورة الجواب'}</span>
            <span className={`text-xs font-bold ${selectedPreviewUrl ? 'text-white/80' : 'text-slate-400'}`}>
              {selectedMeta}
            </span>
          </span>
        </button>
        {value ? (
          <button
            type="button"
            onClick={() => onChange?.(null)}
            className="text-xs font-black text-slate-400 transition hover:text-red-600"
          >
            إزالة الصورة المختارة
          </button>
        ) : null}
      </div>

      <input
        ref={uploadInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(event) => {
          pickFile(event.target.files?.[0], 'upload');
          event.target.value = '';
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0] || null;
          event.target.value = '';
          if (file) {
            setCameraDraftFile(file);
            setCameraPreviewOpen(true);
            setOptionsOpen(false);
          }
        }}
      />

      <Sheet open={optionsOpen} onOpenChange={setOptionsOpen}>
        <SheetContent side="bottom" className="mx-auto w-full max-w-md rounded-t-[24px]" dir="rtl">
          <SheetDismissButton />
          <SheetHeader className="pl-16 text-right">
            <SheetTitle>اختيار صورة</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-3">
            <button
              type="button"
              onClick={() => uploadInputRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-right transition hover:bg-slate-50"
            >
              <UploadCloud className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-black text-slate-900">رفع صورة جديدة من الجهاز</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOptionsOpen(false);
                setLibraryOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-right transition hover:bg-slate-50"
            >
              <FolderOpen className="h-5 w-5 text-emerald-600" />
              <span className="text-sm font-black text-slate-900">اختيار صورة موجودة من الملفات</span>
            </button>
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 text-right transition hover:bg-slate-50"
            >
              <Camera className="h-5 w-5 text-slate-700" />
              <span className="text-sm font-black text-slate-900">التصوير مباشرة بالكاميرا</span>
            </button>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <SheetContent side="right" className="max-w-lg" dir="rtl">
          <SheetDismissButton />
          <SheetHeader className="pl-16 text-right">
            <SheetTitle>اختيار من الملفات</SheetTitle>
          </SheetHeader>
          <SheetBody>
            {libraryStatus === 'loading' ? (
              <div className="py-8 text-center text-sm font-black text-slate-500">جاري تحميل صور الشركة...</div>
            ) : libraryStatus === 'error' ? (
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-3 text-sm font-black text-red-700">
                {libraryError}
              </div>
            ) : libraryImages.length ? (
              <div className="grid grid-cols-2 gap-3">
                {libraryImages.map((image) => (
                  <button
                    key={image.path}
                    type="button"
                    onClick={() => {
                      onChange?.({ source: 'existing', ...image });
                      setLibraryOpen(false);
                    }}
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-white text-right transition hover:border-blue-300 hover:ring-4 hover:ring-blue-50"
                  >
                    <div className="aspect-square bg-slate-100">
                      {image.signedUrl ? (
                        <img src={image.signedUrl} alt={image.name} className="h-full w-full object-cover" loading="lazy" />
                      ) : null}
                    </div>
                    <div className="space-y-1 px-3 py-2">
                      <p className="truncate text-xs font-black text-slate-800">{image.name}</p>
                      <p className="truncate text-[11px] font-bold text-slate-400">{formatFileSize(image.size) || image.documentType}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="py-10 text-center text-sm font-black text-slate-400">لا توجد صور محفوظة لهذا الـ tenant.</div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <Sheet open={cameraPreviewOpen} onOpenChange={setCameraPreviewOpen}>
        <SheetContent side="bottom" className="mx-auto w-full max-w-md rounded-t-[24px]" dir="rtl">
          <SheetDismissButton />
          <SheetHeader className="pl-16 text-right">
            <SheetTitle>معاينة الصورة</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
              {cameraPreviewUrl ? (
                <img src={cameraPreviewUrl} alt="معاينة صورة الكاميرا" className="max-h-[54vh] w-full object-contain" />
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="secondary" onClick={() => cameraInputRef.current?.click()}>
                إعادة التصوير
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (cameraDraftFile) {
                    pickFile(cameraDraftFile, 'camera');
                  }
                  setCameraPreviewOpen(false);
                  setCameraDraftFile(null);
                }}
              >
                استخدام الصورة
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setCameraPreviewOpen(false);
                  setCameraDraftFile(null);
                }}
              >
                إلغاء
              </Button>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}

function PaperworkDocumentSheet({ open, onOpenChange, tenantId, userId, onSaved }) {
  const [step, setStep] = useState('unit');
  const [documentTitle, setDocumentTitle] = useState('');
  const initialLocation = 'الفرع';
  const [notes, setNotes] = useState('');
  const [jawabPhoto, setJawabPhoto] = useState(null);
  const [units, setUnits] = useState([]);
  const [unitsStatus, setUnitsStatus] = useState('idle');
  const [unitSearch, setUnitSearch] = useState('');
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [quickUnitOpen, setQuickUnitOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const loadUnits = useCallback(async () => {
    if (!tenantId) {
      setUnits([]);
      setUnitsStatus('idle');
      return;
    }

    setUnitsStatus('loading');
    setError('');

    try {
      const rows = await inventoryService.getSerialUnits({ tenantId, status: 'all' });
      setUnits(rows || []);
      setUnitsStatus('ready');
    } catch (loadError) {
      setUnits([]);
      setUnitsStatus('error');
      setError(loadError.message || 'تعذر تحميل القطع المسجلة.');
    }
  }, [tenantId]);

  useEffect(() => {
    if (!open) return;
    setDocumentTitle('');
    setNotes('');
    setJawabPhoto(null);
    setUnitSearch('');
    setSelectedUnit(null);
    setQuickUnitOpen(false);
    setStep('unit');
    setError('');
    setIsSaving(false);
    loadUnits();
  }, [loadUnits, open]);

  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase();
    if (!query) return units;

    return units.filter((unit) => [
      unit.trackingNumber,
      unit.product?.displayName,
      unit.product?.name,
      unit.product?.sku,
      unit.notes,
      unit.status,
    ].filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [unitSearch, units]);

  const canSaveDocument = Boolean(
    selectedUnit?.id
      && documentTitle.trim()
      && jawabPhoto,
  );

  const save = async () => {
    if (!selectedUnit?.id) {
      setError('اختر القطعة المسجلة المرتبطة بالجواب.');
      return;
    }

    if (!documentTitle.trim()) {
      setError('اكتب الجواب باسم مين.');
      return;
    }

    if (!jawabPhoto) {
      setError('اختر صورة الجواب قبل التسجيل.');
      return;
    }

    setIsSaving(true);
    setError('');
    let createdDocumentId = null;

    try {
      createdDocumentId = await motoCustomerCareService.createPaperworkDocument({
        tenantId,
        documentType: 'jawab',
        documentTitle: documentTitle.trim(),
        sourceType: 'manual',
        trackingUnitId: selectedUnit.id,
        initialLocation,
        notes,
      });
      if (jawabPhoto?.source === 'existing') {
        await motoCustomerCareService.linkExistingPaperworkDocumentAttachment({
          tenantId,
          documentId: createdDocumentId,
          documentType: 'jawab_photo',
          source: jawabPhoto,
          userId,
        });
      } else if (jawabPhoto?.file) {
        await motoCustomerCareService.savePaperworkDocumentAttachment({
          tenantId,
          documentId: createdDocumentId,
          documentType: 'jawab_photo',
          file: jawabPhoto.file,
          userId,
        });
      }
      createdDocumentId = null;
      await onSaved?.();
      onOpenChange(false);
    } catch (saveError) {
      if (createdDocumentId) {
        try {
          await motoCustomerCareService.deletePaperworkDocumentRollback({
            tenantId,
            documentId: createdDocumentId,
          });
        } catch (rollbackError) {
          setError(`${saveError?.message || 'تعذر تسجيل الورقة.'} ولم يكتمل التراجع: ${rollbackError?.message || 'خطأ غير معروف'}`);
          return;
        }
      }
      setError(saveError?.message || 'تعذر تسجيل الورقة.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="max-w-md" dir="rtl">
          <SheetDismissButton />
          <SheetHeader className="pl-16 text-right">
            <SheetTitle>تسجيل جواب</SheetTitle>
            <div className="mt-2 flex items-center gap-2 text-[11px] font-black text-slate-500">
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
                step === 'unit' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                1
              </span>
              <span className="h-px w-8 bg-slate-200" aria-hidden="true" />
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${
                step === 'details' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'
              }`}>
                2
              </span>
              <span className="mr-1 text-slate-400">
                {step === 'unit' ? 'تحديد القطعة' : 'بيانات الجواب'}
              </span>
            </div>
          </SheetHeader>

          <SheetBody className="space-y-4">
            {step === 'unit' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs font-black text-slate-500">القطعة المرتبطة</span>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setQuickUnitOpen(true)}
                    className="h-9 gap-2 rounded-full px-3 text-xs font-black"
                  >
                    <PackagePlus className="h-4 w-4" />
                    تسجيل قطعة
                  </Button>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={unitSearch}
                    onChange={(event) => setUnitSearch(event.target.value)}
                    placeholder="ابحث برقم السيريال أو اسم المنتج"
                    className="pr-9"
                  />
                </div>

                <div className="max-h-[420px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/60">
                  {unitsStatus === 'loading' ? (
                    <div className="px-4 py-5 text-sm font-black text-slate-500">جاري تحميل القطع المسجلة...</div>
                  ) : unitsStatus === 'error' ? (
                    <div className="px-4 py-5 text-sm font-black text-red-700">{error}</div>
                  ) : filteredUnits.length ? (
                    <div className="divide-y divide-slate-200">
                      {filteredUnits.map((unit) => {
                        const isSelected = selectedUnit?.id === unit.id;
                        const productName = unit.product?.displayName || unit.product?.name || 'منتج غير محدد';

                        return (
                          <button
                            key={unit.id}
                            type="button"
                          onClick={() => {
                            setSelectedUnit(unit);
                            setError('');
                            setStep('details');
                          }}
                            className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-right transition ${
                              isSelected ? 'bg-blue-50' : 'hover:bg-white'
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-black text-slate-950">{productName}</span>
                              <span className="mt-0.5 block truncate font-mono text-xs font-bold text-slate-500" dir="ltr">
                                {unit.trackingNumber || unit.id}
                              </span>
                            </span>
                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${
                              isSelected ? 'bg-blue-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'
                            }`}>
                              {isSelected ? 'مختارة' : unit.status || 'مسجلة'}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center text-sm font-black text-slate-400">
                      لا توجد قطع مطابقة. سجل قطعة جديدة ثم اخترها للجواب.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div className="min-w-0">
                  <p className="truncate text-sm font-black text-slate-950">
                    {selectedUnit?.product?.displayName || selectedUnit?.product?.name || 'منتج غير محدد'}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs font-bold text-slate-500" dir="ltr">
                    {selectedUnit?.trackingNumber || selectedUnit?.id}
                  </p>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs font-black text-slate-500">الجواب باسم</span>
                  <Input value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} placeholder="اكتب الجواب باسم مين" />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-black text-slate-500">ملاحظات</span>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={3}
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                  />
                </label>

                <PaperworkImagePicker
                  value={jawabPhoto}
                  onChange={(nextValue) => {
                    setJawabPhoto(nextValue);
                    setError('');
                  }}
                  tenantId={tenantId}
                />
              </>
            )}

            {error && unitsStatus !== 'error' ? (
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-black text-red-700">
                {error}
              </div>
            ) : null}
          </SheetBody>

          <SheetFooter>
            {step === 'unit' ? (
              <div className="w-full" />
            ) : (
              <div className="grid w-full grid-cols-2 gap-2">
                <Button type="button" variant="secondary" onClick={() => setStep('unit')} disabled={isSaving}>
                  السابق
                </Button>
                <Button type="button" onClick={save} disabled={isSaving || !canSaveDocument}>
                  {isSaving ? 'جاري التسجيل...' : 'تسجيل الجواب'}
                </Button>
              </div>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <QuickStockUnitSheet
        open={quickUnitOpen}
        onOpenChange={setQuickUnitOpen}
        tenantId={tenantId}
        userId={userId}
        registrationMode="jawab"
        onSaved={async (result) => {
          const createdUnit = result?.units?.[0] || null;
          if (createdUnit) {
            setSelectedUnit(createdUnit);
            setStep('details');
          }
          setQuickUnitOpen(false);
          await loadUnits();
        }}
      />
    </>
  );
}

function InvoiceAmountStatus({ sale }) {
  const hasRemaining = sale.remainingAmount > 0;

  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black ring-1 ${
        hasRemaining
          ? 'bg-red-50 text-red-700 ring-red-100'
          : 'bg-emerald-50 text-emerald-700 ring-emerald-100'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${hasRemaining ? 'bg-red-500' : 'bg-emerald-500'}`} aria-hidden="true" />
      <span>{hasRemaining ? 'متبقي' : 'لا يوجد متبقي'}</span>
      {hasRemaining ? <span className="font-mono" dir="ltr">{formatMoney(sale.remainingAmount)}</span> : null}
    </div>
  );
}

function InvoiceInfoLine({ label, value, dir, muted = false }) {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 ${muted ? 'text-[11px] leading-4' : 'text-xs leading-5'}`}>
      <span className={`flex-shrink-0 ${muted ? 'font-bold text-slate-400' : 'font-black text-slate-500'}`}>{label} :</span>
      <span className={`min-w-0 truncate ${muted ? 'font-semibold text-slate-400' : 'font-black text-slate-950'}`} dir={dir}>{value}</span>
    </div>
  );
}

function InvoicePaymentsTimeline({ sale }) {
  const payments = Array.isArray(sale.payments) ? sale.payments : [];

  if (!payments.length) {
    return null;
  }

  return (
    <div className="mr-1.5 mt-1.5 space-y-1.5 border-r border-slate-100 pr-2">
      {payments.map((payment, index) => {
        const paymentDate = formatDate(payment.paymentDate || payment.createdAt);
        const paymentMethod = payment.paymentMethod || 'طريقة دفع غير محددة';
        const label = payment.notes || paymentMethod;

        return (
          <div key={payment.id || index} className="relative min-w-0 pr-2">
            <span className="absolute -right-[0.7rem] top-2 h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
            <p className="min-w-0 truncate text-[10px] font-semibold leading-4 text-slate-400">
              <span className="font-mono font-bold text-emerald-600" dir="ltr">
                {formatMoney(payment.amount)}
              </span>
              <span className="mx-1 text-slate-300">-</span>
              <span>{paymentDate}</span>
              <span className="mx-1 text-slate-300">-</span>
              <span className="text-slate-500">{label}</span>
            </p>
          </div>
        );
      })}
    </div>
  );
}

function InvoiceInfo({ sale, invoiceDate }) {
  return (
    <div className="space-y-1.5">
      <InvoiceInfoLine label="تاريخ الفاتورة" value={invoiceDate} muted />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <InvoiceInfoLine label="إجمالي الفاتورة" value={formatMoney(sale.totalAmount)} dir="ltr" />
      </div>
      <InvoicePaymentsTimeline sale={sale} />
      <div className="pt-1">
        <InvoiceAmountStatus sale={sale} />
      </div>
    </div>
  );
}

function SalesFollowUpCard({ sale, paperworkRequests = [], onRegisterTrackingUnit, onCreatePaperworkRequest }) {
  const customerPhone = sale.customer?.phone || sale.customer?.phone1 || sale.customer?.phone2 || '--';
  const customerAddress = sale.customer?.address || '--';
  const invoiceDate = formatDate(sale.saleDate || sale.createdAt);

  return (
    <article className="relative bg-white px-4 pb-5 pt-5 transition before:absolute before:inset-x-5 before:top-0 before:h-px before:bg-slate-200 first:before:hidden hover:bg-blue-50/45">
      <div className="min-w-0 space-y-4">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-black leading-6 text-slate-950">{sale.customer?.name || 'عميل غير محدد'}</h2>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] font-semibold leading-4 text-slate-400">
            <span className="truncate font-mono font-black text-slate-600" dir="ltr">{customerPhone}</span>
            <span className="h-0.5 w-0.5 flex-shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
            <span className="truncate">{customerAddress}</span>
          </div>
        </div>

        <div className="grid min-w-0 gap-4 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="px-1 py-1">
            <InvoiceInfo sale={sale} invoiceDate={invoiceDate} />
          </aside>

          <div className="min-w-0">
            <SaleProductsCards
              items={sale.items}
              paperworkRequests={paperworkRequests}
              onRegisterTrackingUnit={onRegisterTrackingUnit}
              onCreatePaperworkRequest={(item) => onCreatePaperworkRequest?.({
                ...item,
                branchId: sale.branchId,
                customerId: sale.customerId,
              })}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

export function MotoCustomerCareSalesFollowUpListPage() {
  const [activeSection, setActiveSection] = useState('sales');
  const [paperworkFilter, setPaperworkFilter] = useState('all');
  const [trackingSheetItem, setTrackingSheetItem] = useState(null);
  const [licenseSheetItem, setLicenseSheetItem] = useState(null);
  const [trackingUnitPickerItem, setTrackingUnitPickerItem] = useState(null);
  const [stockUnitSheetItem, setStockUnitSheetItem] = useState(null);
  const [paperworkRequestItem, setPaperworkRequestItem] = useState(null);
  const [paperworkDocumentSheetOpen, setPaperworkDocumentSheetOpen] = useState(false);
  const { tenant_user: tenantUser } = useAuth();
  const {
    tenantId,
    sales,
    paperworkRequests,
    paperworkDocuments,
    paperworkDocumentMoves,
    isLoading,
    error,
    refresh,
  } = useMotoCustomerCareSales({ limit: 250 });
  const displayedSales = useMemo(() => {
    if (activeSection === 'papers') {
      return sales;
    }

    return sales;
  }, [activeSection, sales]);
  const displayedPaperworkDocuments = useMemo(() => {
    if (activeSection !== 'papers') {
      return [];
    }

    if (paperworkFilter === 'current') {
      return paperworkDocuments.filter(isCurrentPaperworkDocument);
    }

    return paperworkDocuments;
  }, [activeSection, paperworkDocuments, paperworkFilter]);
  const displayedPaperworkMoves = useMemo(() => {
    if (activeSection !== 'papers' || paperworkFilter !== 'moves') {
      return [];
    }

    return paperworkDocumentMoves;
  }, [activeSection, paperworkDocumentMoves, paperworkFilter]);

  const activeSectionLabel = followUpSections.find((section) => section.id === activeSection)?.label || 'المبيعات';
  const attachTrackingUnitToPickerItem = async (unit) => {
    await motoCustomerCareService.attachSaleLineTrackingUnit({
      tenantId,
      lineId: trackingUnitPickerItem?.id,
      productProductId: trackingUnitPickerItem?.productProductId,
      trackingUnitId: unit?.id,
    });
    setTrackingUnitPickerItem(null);
    await refresh();
  };
  const handleStockUnitSaved = async (result) => {
    const trackingUnitId = result?.units?.[0]?.id;
    if (!trackingUnitId) {
      throw new Error('تم التسجيل، لكن تعذر تحديد القطعة الجديدة لربطها بالفاتورة.');
    }

    await motoCustomerCareService.attachSaleLineTrackingUnit({
      tenantId,
      lineId: stockUnitSheetItem?.id,
      productProductId: stockUnitSheetItem?.productProductId,
      trackingUnitId,
    });
    setStockUnitSheetItem(null);
    await refresh();
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden" dir="rtl">
      {isLoading ? (
        <LoadingSpinner title="جاري تحميل مبيعات الشو روم" description="يتم تجهيز كروت المتابعة من عمليات البيع الحالية." />
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div>
      ) : null}

      {!isLoading && !error ? (
        <div className="grid min-h-0 flex-1 gap-6 overflow-hidden lg:grid-cols-[430px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
          <FollowUpSectionsPanel
            activeSection={activeSection}
            onSectionChange={setActiveSection}
            sales={sales}
            paperworkDocuments={paperworkDocuments}
          />

          <section className="flex min-h-0 flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-white/85 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.16)] lg:fixed lg:bottom-0 lg:left-4 lg:right-[500px] lg:top-5 lg:z-20 lg:h-auto">
            <div className="relative z-10 flex items-center justify-between gap-4 border-b border-slate-300 bg-slate-200 px-6 py-6 text-slate-950 shadow-[0_10px_18px_-16px_rgba(15,23,42,0.75)] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-[-1px] after:h-px after:bg-white/80">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-sm">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-2xl font-black leading-8 text-slate-950">{activeSectionLabel}</h3>
                </div>
              </div>
              {activeSection === 'papers' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    onClick={() => setPaperworkDocumentSheetOpen(true)}
                    className="h-9 rounded-full px-4 text-xs font-black"
                  >
                    تسجيل جواب
                  </Button>
                  {paperworkDocumentFilters.map((filter) => {
                    const isActiveFilter = paperworkFilter === filter.id;

                    return (
                      <button
                        key={filter.id}
                        type="button"
                        onClick={() => setPaperworkFilter(filter.id)}
                        className={`rounded-full px-3.5 py-2 text-xs font-black transition ${
                          isActiveFilter
                            ? 'bg-slate-950 text-white shadow-sm'
                            : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {filter.label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-white">
              {activeSection === 'papers' && paperworkFilter === 'moves' && displayedPaperworkMoves.length ? (
                displayedPaperworkMoves.map((move) => (
                  <PaperworkDocumentMoveCard key={move.id} move={move} />
                ))
              ) : activeSection === 'papers' && paperworkFilter !== 'moves' && displayedPaperworkDocuments.length ? (
                displayedPaperworkDocuments.map((document) => (
                  <PaperworkDocumentCard key={document.id} document={document} />
                ))
              ) : activeSection !== 'papers' && displayedSales.length ? (
                displayedSales.map((sale) => (
                  <SalesFollowUpCard
                    key={sale.id}
                    sale={sale}
                    paperworkRequests={paperworkRequests}
                    onRegisterTrackingUnit={setTrackingUnitPickerItem}
                    onCreatePaperworkRequest={setPaperworkRequestItem}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
                  {activeSection === 'papers' ? (
                    <>
                      <h2 className="text-lg font-black text-slate-950">لا توجد أوراق</h2>
                      <p className="mt-2 text-sm font-semibold text-slate-500">قسم الأوراق يعرض مستندات paperwork_documents وحركاتها من paperwork_document_moves.</p>
                    </>
                  ) : (
                    <>
                      <h2 className="text-lg font-black text-slate-950">لا توجد عمليات في {activeSectionLabel}</h2>
                      <p className="mt-2 text-sm font-semibold text-slate-500">اختر تقريرا آخر من القائمة الجانبية لعرض عملياته.</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      <TrackingIdentifiersSheet
        item={trackingSheetItem}
        open={Boolean(trackingSheetItem)}
        onOpenChange={(open) => {
          if (!open) setTrackingSheetItem(null);
        }}
        tenantId={tenantId}
        onSaved={refresh}
      />
      <TrackingLicenseSheet
        item={licenseSheetItem}
        open={Boolean(licenseSheetItem)}
        onOpenChange={(open) => {
          if (!open) setLicenseSheetItem(null);
        }}
        tenantId={tenantId}
        onSaved={refresh}
      />
      <TrackingUnitPickerSheet
        item={trackingUnitPickerItem}
        open={Boolean(trackingUnitPickerItem)}
        onOpenChange={(open) => {
          if (!open) setTrackingUnitPickerItem(null);
        }}
        tenantId={tenantId}
        onAttach={attachTrackingUnitToPickerItem}
        onRegisterNew={() => {
          setStockUnitSheetItem(trackingUnitPickerItem);
          setTrackingUnitPickerItem(null);
        }}
      />
      <QuickStockUnitSheet
        open={Boolean(stockUnitSheetItem)}
        onOpenChange={(open) => {
          if (!open) setStockUnitSheetItem(null);
        }}
        tenantId={tenantId}
        userId={tenantUser?.id}
        initialProductProductId={stockUnitSheetItem?.productProductId}
        lockProductSelection
        onSaved={handleStockUnitSaved}
      />
      <PaperworkRequestSheet
        item={paperworkRequestItem}
        open={Boolean(paperworkRequestItem)}
        onOpenChange={(open) => {
          if (!open) setPaperworkRequestItem(null);
        }}
        tenantId={tenantId}
        onSaved={refresh}
      />

      <PaperworkDocumentSheet
        open={paperworkDocumentSheetOpen}
        onOpenChange={setPaperworkDocumentSheetOpen}
        tenantId={tenantId}
        userId={tenantUser?.id}
        onSaved={refresh}
      />
    </section>
  );
}
