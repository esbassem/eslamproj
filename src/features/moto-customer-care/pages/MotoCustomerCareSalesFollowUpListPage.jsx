import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useReducedMotion } from 'framer-motion';
import { ArrowRight, Building2, Camera, Check, CircleAlert, CircleCheck, FileText, FolderOpen, ImagePlus, PackagePlus, PhoneCall, Search, UploadCloud, UserPlus } from 'lucide-react';
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
import { PartnerFormSheet } from '@/features/contacts/components/PartnerFormSheet';
import { partnersService } from '@/features/contacts/services/partners.service';
import { QuickStockUnitSheet } from '@/features/dashboard/components/QuickStockUnitSheet';
import { inventoryService } from '@/features/inventory/api/inventory.api';
import { PaperworkRequestDetailsDrawer } from '@/features/moto-customer-care/components/PaperworkRequestDetailsDrawer';
import { PendingProcessorPaperworkDrawer } from '@/features/moto-customer-care/components/PendingProcessorPaperworkDrawer';
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
  transferred: 'تم التحويل',
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

const PAPERWORK_NEW_CUSTOMER_INITIAL_VALUES = {
  isCustomer: true,
  isSupplier: false,
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

const followUpSections = [
  { id: 'requests', label: 'طلبات الأوراق', description: 'متابعة طلبات تنفيذ الأوراق ومراحلها.' },
  { id: 'sales', label: 'المبيعات', description: 'متابعة عمليات البيع بعد التسليم.' },
  { id: 'papers', label: 'الأوراق', description: 'إدارة الجوابات والحركات والتسليم.' },
];

function buildPaperworkSidebarReports(sales = [], paperworkRequests = []) {
  return (Array.isArray(sales) ? sales : []).reduce(
    (accumulator, sale) => {
      const items = Array.isArray(sale?.items) ? sale.items : [];

      items.forEach((item) => {
        const request = getPaperworkRequestForItem(item, paperworkRequests);

        if (!request) {
          accumulator.missing += 1;
          return;
        }

        if (['sent_to_processor', 'processor_ready'].includes(request.currentStage)) {
          accumulator.sentPendingReceipt += 1;
          return;
        }

        if (isVaultPaperworkRequest(request)) {
          accumulator.vault += 1;
        }
      });

      return accumulator;
    },
    { missing: 0, vault: 0, sentPendingReceipt: 0 },
  );
}

function saleMatchesPaperworkReportFilter(sale, paperworkRequests = [], filterId) {
  if (!filterId) {
    return true;
  }

  const items = Array.isArray(sale?.items) ? sale.items : [];

  return items.some((item) => {
    const request = getPaperworkRequestForItem(item, paperworkRequests);

    if (filterId === 'missing') {
      return !request;
    }

    if (filterId === 'vault') {
      return Boolean(request && isVaultPaperworkRequest(request));
    }

    return true;
  });
}

function filterSalesByPaperworkReport(sales = [], paperworkRequests = [], filterId) {
  if (!filterId) {
    return sales;
  }

  return (Array.isArray(sales) ? sales : []).filter((sale) => saleMatchesPaperworkReportFilter(sale, paperworkRequests, filterId));
}

function LatestMobilePaperworkRequestsList({
  sales = [],
  paperworkRequests = [],
  paperworkDocuments = [],
  isLoading = false,
  isFiltering = false,
  onRegisterTrackingUnit,
  onCreatePaperworkRequest,
  onOpenPaperworkRequest,
  onViewAll,
}) {
  const latestRequests = (Array.isArray(paperworkRequests) ? paperworkRequests : []).slice(0, 10);

  return (
    <div className="mt-8 lg:hidden">
      <div className="mb-2 flex items-center justify-between gap-3 px-4 text-white sm:px-10">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-black leading-5">آخر طلبات الأوراق</h2>
          <span className="flex items-center gap-1" aria-hidden="true">
            <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
            <span className="h-1.5 w-1.5 rounded-full bg-sky-200/70" />
          </span>
        </div>
        <button
          type="button"
          onClick={onViewAll}
          className="rounded-full border border-white/18 bg-white/[0.10] px-3 py-1 text-[11px] font-black text-white/92 shadow-[0_8px_18px_rgba(15,23,42,0.08)] backdrop-blur-md transition hover:bg-white/[0.16] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25"
        >
          عرض الكل
        </button>
      </div>
      <div className="relative grid gap-0 pt-2 before:absolute before:inset-x-0 before:top-0 before:h-2 before:rounded-t-[1.35rem] before:bg-white before:shadow-[0_-10px_24px_rgba(255,255,255,0.10)]">
        {isLoading || isFiltering ? (
          <div className="mx-4 rounded-2xl border border-white/12 bg-white/[0.08] px-3.5 py-3 text-xs font-black text-blue-50/80 backdrop-blur-md sm:mx-10 lg:mx-0">
            جاري تجهيز طلبات الأوراق...
          </div>
        ) : latestRequests.length ? (
          latestRequests.map((request, index) => (
            <div
              key={request.id}
              className="customer-care-mobile-sale-entry overflow-hidden bg-white shadow-[0_16px_34px_rgba(15,23,42,0.12)]"
              style={{ animationDelay: `${index * 22}ms` }}
            >
              <PaperworkRequestCard request={request} onOpen={onOpenPaperworkRequest} />
            </div>
          ))
        ) : (
          <div className="mx-4 rounded-2xl border border-white/12 bg-white/[0.08] px-3.5 py-3 text-xs font-black text-blue-50/80 backdrop-blur-md sm:mx-10 lg:mx-0">
            لا توجد طلبات أوراق حديثة.
          </div>
        )}
      </div>
    </div>
  );
}

function FollowUpSectionsPanel({
  activeSection,
  activeReportFilter,
  onSectionChange,
  onReportFilterChange,
  paperworkReports,
  isReportsLoading = false,
  sales = [],
  paperworkRequests = [],
  paperworkDocuments = [],
  isMobileContentOpen,
  isLoading = false,
  isFiltering = false,
  onRegisterTrackingUnit,
  onCreatePaperworkRequest,
  onOpenPaperworkRequest,
}) {
  const resolvedPaperworkReports = paperworkReports || buildPaperworkSidebarReports(sales, paperworkRequests);
  const filteredMobileSales = useMemo(
    () => filterSalesByPaperworkReport(sales, paperworkRequests, activeReportFilter),
    [activeReportFilter, paperworkRequests, sales],
  );
  const reportItems = [
    { id: 'missing', label: 'لم يتم تحديد حالة الورق', value: resolvedPaperworkReports.missing, color: '#ef4444' },
    { id: 'vault', label: 'أوراق موجودة', value: resolvedPaperworkReports.vault, color: '#38bdf8' },
    {
      id: 'sent_pending_receipt',
      label: 'أوراق بانتظار استلامها من الجهات',
      value: resolvedPaperworkReports.sentPendingReceipt,
      color: '#3b82f6',
    },
  ];

  return (
    <aside className={`${isMobileContentOpen ? 'hidden lg:flex' : 'flex'} mt-5 min-h-0 flex-col gap-0 overflow-y-auto px-0 py-1 sm:mt-6`}>
      <div className="grid grid-cols-[max-content_max-content] gap-1.5 px-4 pr-7 sm:px-10 sm:pr-14 lg:px-0 lg:pr-3 xl:pr-4">
        {reportItems.map((report) => {
          const isActiveReport = activeReportFilter === report.id;

          return (
            <button
              type="button"
              key={report.id}
              onClick={() => onReportFilterChange?.(isActiveReport ? null : report.id)}
              className={`group inline-flex min-h-9 items-center gap-1.5 rounded-xl border px-2 py-1 text-right text-white backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/34 hover:bg-white/[0.18] hover:shadow-[0_12px_24px_rgba(15,23,42,0.11)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/30 ${
                isActiveReport
                  ? 'border-white/45 bg-white/[0.22] shadow-[0_12px_26px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.20)]'
                  : 'border-white/20 bg-white/[0.12] shadow-[0_8px_18px_rgba(15,23,42,0.08)]'
              }`}
              aria-label={`${report.label}: ${report.value}`}
              aria-pressed={isActiveReport}
            >
              <span
                className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md px-1.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                style={{ backgroundColor: report.color }}
              >
                {isReportsLoading ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/45 border-t-white" aria-hidden="true" />
                ) : (
                  <span className="font-mono text-[9px] font-black leading-none" dir="ltr">{report.value}</span>
                )}
              </span>
              <span className="min-w-0 text-[10px] font-black leading-3 text-white sm:text-[11px]">
                {report.label}
              </span>
            </button>
          );
        })}
      </div>

      <LatestMobilePaperworkRequestsList
        sales={filteredMobileSales}
        paperworkRequests={paperworkRequests}
        paperworkDocuments={paperworkDocuments}
        isLoading={isLoading}
        isFiltering={isFiltering}
        onRegisterTrackingUnit={onRegisterTrackingUnit}
        onCreatePaperworkRequest={onCreatePaperworkRequest}
        onOpenPaperworkRequest={onOpenPaperworkRequest}
        onViewAll={() => {
          onReportFilterChange?.(null);
          onSectionChange('requests');
        }}
      />

      <div className="mt-8 hidden lg:block">
        <div className="mb-3 inline-flex rounded-xl border border-white/16 bg-white/[0.10] px-4 py-2 text-xs font-black text-white shadow-[0_14px_30px_rgba(15,23,42,0.08)] backdrop-blur-md">
          أقسام المتابعة
        </div>
        <div className="grid gap-2.5">
        {followUpSections.map((section) => {
          const isActive = activeSection === section.id;

          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onSectionChange(section.id)}
              className={`group relative flex w-full items-center justify-between gap-3 rounded-2xl border px-3.5 py-3 text-right shadow-[0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur-md transition hover:-translate-y-0.5 active:scale-[0.99] ${
                isActive
                  ? 'border-white/40 bg-white/[0.20] text-white'
                  : 'border-white/12 bg-white/[0.08] text-blue-50 hover:border-white/25 hover:bg-white/[0.14]'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span className={`h-2 w-2 flex-shrink-0 rounded-full ${isActive ? 'bg-white' : 'bg-blue-100/55'}`} aria-hidden="true" />
                <span className="truncate text-sm font-black">{section.label}</span>
              </div>
              <span className={`h-px w-8 flex-shrink-0 ${isActive ? 'bg-white/80' : 'bg-white/20'}`} aria-hidden="true" />
            </button>
          );
        })}
        </div>
      </div>
    </aside>
  );
}

function hasPaperworkRequestForItem(item, paperworkRequests) {
  return Boolean(getPaperworkRequestForItem(item, paperworkRequests));
}

function getPaperworkRequestForItem(item, paperworkRequests) {
  return (Array.isArray(paperworkRequests) ? paperworkRequests : []).find((request) => {
    if (item?.id && request.saleLineId === item.id) {
      return true;
    }

    return Boolean(item?.trackingUnitId && request.trackingUnitId === item.trackingUnitId);
  }) || null;
}

function getCurrentPaperworkDocumentForItem(item, paperworkDocuments) {
  if (!item?.trackingUnitId) {
    return null;
  }

  return (Array.isArray(paperworkDocuments) ? paperworkDocuments : []).find((document) => {
    if (!isCurrentPaperworkDocument(document)) {
      return false;
    }

    return document.trackingUnitId === item.trackingUnitId;
  }) || null;
}

function getPaperworkDocumentLastInDate(document) {
  const moves = Array.isArray(document?.moves) ? document.moves : [];
  const lastInMove = moves.find((move) => move.moveDirection === 'in');

  return lastInMove?.movedAt || document?.createdAt || '';
}

function getPaperworkStatusLabel(request) {
  if (!request) return 'لم يتم تحديد حالة الأوراق';
  if (request.status === 'done') return 'تم تسليم الأوراق';
  if (isVaultPaperworkRequest(request)) {
    return 'الورق موجود بالخزنة';
  }
  return 'تم تحديد حالة الأوراق';
}

function isVaultPaperworkRequest(request) {
  return Boolean(
    request?.stage?.code === 'received_from_processor'
      || String(request?.notes || '').includes('الورق موجود بالفعل في الخزنة')
      || (Array.isArray(request?.events) && request.events.some((event) => String(event.notes || '').includes('الورق موجود بالفعل في الخزنة'))),
  );
}

function getPaperworkEventLabel(event) {
  if (!event) return 'حدث';
  if (event.eventType === 'done' || event.newStatus === 'done') return 'تسليم الأوراق';
  if (event.eventType === 'created') return 'إنشاء الطلب';
  if (event.eventType === 'stage_changed') return 'تغيير المرحلة';
  if (event.eventType === 'status_changed') return 'تغيير الحالة';
  return event.eventType || event.newStatus || 'حدث';
}

function TrackingIdentifiersInline({ item }) {
  if (!item?.trackingUnitId) {
    return null;
  }

  const identifiers = buildPaperProductDetails(item);

  if (!identifiers.length && !item?.trackingUnit?.trackingNumber) {
    return null;
  }

  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-500">
      {identifiers.length ? identifiers.map((identifier, index) => (
        <span
          key={`${identifier.label}-${index}`}
          className={`inline-flex max-w-full items-baseline gap-1 ${identifier.isMissing ? 'text-red-600' : 'text-slate-500'}`}
          title={`${identifier.label}: ${identifier.value || 'فارغ'}`}
        >
          <span className="flex-shrink-0">{identifier.label}</span>
          <span className={`max-w-[150px] truncate font-mono font-black ${identifier.isMissing ? 'text-red-700' : 'text-slate-800'}`} dir="ltr">
            {identifier.value || 'فارغ'}
          </span>
        </span>
      )) : (
        <span className="inline-flex max-w-full items-baseline gap-1" title={`رقم التتبع: ${item.trackingUnit.trackingNumber}`}>
          <span className="flex-shrink-0">رقم التتبع</span>
          <span className="max-w-[150px] truncate font-mono font-black text-slate-800" dir="ltr">{item.trackingUnit.trackingNumber}</span>
        </span>
      )}
    </div>
  );
}

function SaleProductsCards({
  items,
  paperworkRequests = [],
  paperworkDocuments = [],
  onRegisterTrackingUnit,
  onCreatePaperworkRequest,
  onOpenPaperworkRequest,
}) {
  const saleItems = Array.isArray(items) ? items : [];

  if (!saleItems.length) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-3 py-2 text-xs font-black text-slate-400">
        لا توجد منتجات مسجلة
      </div>
    );
  }

  return (
    <div className="grid w-full justify-items-stretch gap-2 lg:justify-items-start">
      {saleItems.map((item, index) => {
        const attributes = item.trackingUnitId && Array.isArray(item.trackingUnitAttributes) ? item.trackingUnitAttributes : [];
        const attributesText = formatAttributesText(attributes);
        const itemName = item.displayName || item.name || item.description || `منتج ${index + 1}`;
        const missingTrackingUnit = item.tracking === 'serial' && !item.trackingUnitId;
        const licenseSummary = getPaperLicenseSummary(item.license);
        const paperworkRequest = getPaperworkRequestForItem(item, paperworkRequests);
        const missingPaperworkRequest = !paperworkRequest;
        const currentPaperworkDocument = getCurrentPaperworkDocumentForItem(item, paperworkDocuments);
        const vaultPaperworkRequest = isVaultPaperworkRequest(paperworkRequest);
        const currentPaperworkDocumentName = currentPaperworkDocument?.documentTitle
          || currentPaperworkDocument?.displayTitle
          || '';
        const deliveryEventCreator = paperworkRequest?.deliveryEventCreatedByName || '';
        const deliveryEventDate = paperworkRequest?.deliveryEventCreatedAt ? formatDate(paperworkRequest.deliveryEventCreatedAt) : '';
        const deliveryEventNote = typeof paperworkRequest?.deliveryEventNotes === 'string'
          ? paperworkRequest.deliveryEventNotes.trim()
          : '';
        const deliveryEventTitle = [
          deliveryEventCreator ? `بواسطة: ${deliveryEventCreator}` : '',
          deliveryEventDate,
          deliveryEventNote ? `ملاحظة: ${deliveryEventNote}` : '',
        ].filter(Boolean).join(' - ');
        const itemPrice = formatMoney(item.total || item.unitPrice);

        return (
          <div key={item.id || index} className="w-full max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_6px_16px_rgba(15,23,42,0.05)] transition hover:border-slate-300 hover:shadow-[0_8px_20px_rgba(15,23,42,0.07)] lg:w-auto">
            <div className="flex min-w-0 flex-wrap items-stretch divide-x divide-x-reverse divide-slate-200/80" dir="rtl">
              <div className="min-w-0 flex-1 basis-full px-3 py-2 sm:min-w-[280px] sm:basis-auto lg:max-w-[560px]">
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
                    <TrackingIdentifiersInline item={item} />
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
                    <TrackingIdentifiersInline item={item} />
                  </>
                )}
                {missingTrackingUnit && attributesText ? (
                  <p className="mt-0.5 truncate text-[11px] font-bold text-slate-600" title={attributesText}>
                    {attributesText}
                  </p>
                ) : null}
              </div>

              <div className="flex w-full flex-shrink-0 items-center justify-center px-3 py-2 text-center sm:w-44">
                {missingPaperworkRequest ? (
                  <div className="grid min-w-0 justify-items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onCreatePaperworkRequest?.(item)}
                      className="inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-black text-red-600 transition hover:bg-red-50 hover:text-red-700"
                      title="تحديد حالة الأوراق لهذا المنتج"
                    >
                      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-red-500" aria-hidden="true" />
                      <span className="truncate">لم يتم تحديد حالة الأوراق</span>
                    </button>
                    {currentPaperworkDocument ? (
                      <span
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-500 ring-1 ring-slate-200"
                        title={currentPaperworkDocument.displayTitle || currentPaperworkDocument.documentTitle || 'ورق موجود حاليا'}
                      >
                        <FileText className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">تم العثور على ورق لهذه القطعة في الخزنة</span>
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenPaperworkRequest?.(paperworkRequest)}
                    className={`grid min-w-0 justify-items-center gap-1 rounded-xl px-2 py-1 text-center transition focus:outline-none focus:ring-2 ${
                      vaultPaperworkRequest
                        ? 'hover:bg-sky-50 focus:ring-sky-200'
                        : 'hover:bg-emerald-50 focus:ring-emerald-200'
                    }`}
                    title={deliveryEventTitle || 'عرض طلب الأوراق والأحداث'}
                  >
                    <span
                      className={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-black ${
                        vaultPaperworkRequest ? 'text-sky-700' : 'text-emerald-700'
                      }`}
                    >
                      <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                        vaultPaperworkRequest ? 'bg-sky-500' : 'bg-emerald-500'
                      }`} aria-hidden="true" />
                      <span className="truncate">{getPaperworkStatusLabel(paperworkRequest)}</span>
                    </span>
                    {vaultPaperworkRequest && currentPaperworkDocumentName ? (
                      <span className="max-w-full truncate text-[10px] font-bold text-slate-500" title={currentPaperworkDocumentName}>
                        باسم: {currentPaperworkDocumentName}
                      </span>
                    ) : null}
                    {deliveryEventCreator ? (
                      <span className="max-w-full truncate text-[10px] font-black text-slate-500" title={deliveryEventTitle}>
                        بواسطة: {deliveryEventCreator}
                      </span>
                    ) : null}
                    {deliveryEventNote ? (
                      <span className="max-w-full truncate text-[10px] font-bold text-slate-500" title={deliveryEventNote}>
                        ملاحظة: {deliveryEventNote}
                      </span>
                    ) : null}
                  </button>
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

const PAPERWORK_JOURNEY_STATIONS = [
  {
    id: 'preparation',
    label: 'إعداد الأوراق',
    icon: FileText,
    stages: ['preparation', 'owner_confirmation'],
  },
  {
    id: 'processor',
    label: 'عند الجهة',
    icon: Building2,
    stages: ['sent_to_processor', 'processor_ready', 'received_from_processor'],
  },
  {
    id: 'customer',
    label: 'بانتظار العميل',
    icon: PhoneCall,
    stages: ['client_notified'],
  },
  {
    id: 'finished',
    label: 'منتهي',
    icon: CircleCheck,
    stages: ['delivered', 'cancelled'],
  },
];

const PAPERWORK_INTERNAL_STAGE_LABELS = {
  preparation: 'تجهيز بيانات الورق',
  owner_confirmation: 'تحديد صاحب الورق',
  sent_to_processor: 'تم الإرسال للجهة',
  processor_ready: 'الورق جاهز عند الجهة',
  received_from_processor: 'تم استلام الورق من الجهة',
  client_notified: 'تم إبلاغ العميل',
  delivered: 'تم التسليم للعميل',
  cancelled: 'ملغي',
};

function PaperworkJourneyStations({ currentStage }) {
  const currentStationIndex = PAPERWORK_JOURNEY_STATIONS.findIndex((station) => station.stages.includes(currentStage));
  const currentStageLabel = PAPERWORK_INTERNAL_STAGE_LABELS[currentStage] || currentStage || '';

  return (
    <div
      className="mt-3 min-w-0 pt-3 lg:mt-0 lg:flex lg:h-full lg:items-center lg:border-r lg:border-slate-200 lg:pr-5 lg:pt-0"
      aria-label="مراحل طلب الأوراق"
    >
      <div className="grid min-w-0 flex-1 grid-cols-4 gap-1 rounded-xl border border-slate-200/80 bg-slate-50 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
        {PAPERWORK_JOURNEY_STATIONS.map((station, index) => {
          const Icon = station.icon;
          const isCompleted = currentStationIndex > index;
          const isCurrent = currentStationIndex === index;

          return (
            <div
              key={station.id}
              className={`relative flex min-w-0 flex-col items-center justify-center rounded-lg px-1 py-2 text-center transition ${
                isCompleted
                  ? 'bg-emerald-50 text-emerald-800'
                  : isCurrent
                    ? 'bg-blue-600 text-white shadow-[0_5px_14px_rgba(37,99,235,0.24)]'
                    : 'text-slate-400'
              }`}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isCurrent ? (
                <span
                  className="absolute inset-x-2 -top-px h-0.5 rounded-full bg-sky-300"
                  aria-hidden="true"
                />
              ) : null}
              <span
                className={`mb-1 flex h-5 w-5 items-center justify-center rounded-md ${
                  isCompleted
                    ? 'bg-emerald-600 text-white'
                    : isCurrent
                      ? 'bg-white/16 text-white'
                      : 'bg-slate-200/70 text-slate-400'
                }`}
              >
                {isCompleted ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
              </span>
              <span className="max-w-full truncate text-[9px] font-black leading-3 sm:text-[10px]">
                {station.label}
              </span>
              {isCurrent && currentStageLabel ? (
                <span className="mt-1 hidden max-w-full truncate text-[8px] font-bold leading-3 text-blue-100 sm:block">
                  {currentStageLabel}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {currentStageLabel ? (
        <p className="mt-1.5 truncate text-[9px] font-bold text-slate-400 sm:hidden">
          الحالية: <span className="font-black text-blue-700">{currentStageLabel}</span>
        </p>
      ) : null}
    </div>
  );
}

function getPaperworkCurrentStation(currentStage) {
  const index = PAPERWORK_JOURNEY_STATIONS.findIndex((station) => station.stages.includes(currentStage));
  return {
    station: index >= 0 ? PAPERWORK_JOURNEY_STATIONS[index] : null,
    stageLabel: PAPERWORK_INTERNAL_STAGE_LABELS[currentStage] || currentStage || '',
  };
}

function PaperworkRequestCard({ request, onOpen }) {
  const processorName = request.processor?.name || '';
  const licenseSummary = request.license?.status === 'jawab'
    ? `جواب تاجر: ${processorName || 'لم تحدد جهة الإصدار'}`
    : getPaperLicenseSummary(request.license);
  const currentStage = request.currentStage || request.stage?.code || '';
  const documentOwnerName = request.documentOwnerName
    || request.documentOwner?.name
    || (request.documentOwnerStatus === 'later' ? 'يُحدد لاحقًا' : 'غير محدد');
  const identifiers = Array.isArray(request.trackingIdentifiers) ? request.trackingIdentifiers : [];
  const chassis = identifiers.find((identifier) => (
    /chassis|شاسيه/i.test(`${identifier.code || ''} ${identifier.label || ''}`)
  ));
  const engine = identifiers.find((identifier) => (
    /engine|motor|موتور|محرك/i.test(`${identifier.code || ''} ${identifier.label || ''}`)
  ));
  const identifiersText = [
    chassis?.value ? `شاسيه ${chassis.value}` : '',
    engine?.value ? `موتور ${engine.value}` : '',
  ].filter(Boolean).join(' · ') || 'لا توجد أرقام تعريف';
  const guardianshipCode = String(request.documentOwnerNote || '').match(/حالة الوصاية:\s*([^\n]+)/)?.[1]?.trim();
  const guardianshipLabel = {
    father_guardian: 'وصاية والده',
    mother_guardian: 'وصاية والدته',
    none: 'بدون وصاية',
  }[guardianshipCode] || guardianshipCode || '';
  const currentStation = getPaperworkCurrentStation(currentStage);

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(request)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.(request);
        }
      }}
      className="relative cursor-pointer bg-white px-4 py-5 outline-none transition before:absolute before:inset-x-4 before:top-0 before:h-[2px] before:bg-slate-300 first:before:hidden hover:bg-blue-50/55 focus-visible:bg-blue-50/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 lg:before:inset-x-5 lg:before:h-px lg:before:bg-slate-200"
      aria-label={`عرض تفاصيل طلب أوراق ${request.productName || ''}`}
    >
      <div className="flex min-w-0 flex-col lg:min-h-[5.75rem] lg:flex-row lg:items-stretch lg:gap-5">
        <div className="min-w-0 lg:w-[18rem] lg:shrink-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 truncate text-sm font-black text-slate-950" title={request.productName}>
              {request.productName}
            </h2>
            <span className="shrink-0 text-[10px] font-bold text-slate-500">
              باسم: {documentOwnerName}
            </span>
            {request.documentOwnerStatus !== 'later' && guardianshipLabel ? (
              <span className="shrink-0 text-[9px] font-bold text-slate-400">· {guardianshipLabel}</span>
            ) : null}
          </div>
          <div className="mt-2 flex min-w-0 items-start gap-2 lg:mt-1 lg:block">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10px] font-bold text-slate-400" title={identifiersText}>
                {identifiersText}
              </p>
              <div className="mt-1">
                <span
                  className={`inline-flex max-w-full truncate rounded-md border px-2 py-0.5 text-xs font-black leading-5 shadow-sm ${
                    request.license
                      ? 'border-blue-200 bg-blue-50 text-blue-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                  title={licenseSummary}
                >
                  {licenseSummary}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-bold text-slate-400">
                ضمن الفاتورة
                <span className="mr-1 font-black text-slate-600">
                  {request.customer?.name || 'عميل غير محدد'}
                </span>
              </p>
            </div>
            {currentStation.station ? (
              <div className="-mt-1 flex aspect-square w-[5.9rem] shrink-0 items-center justify-center rounded-2xl bg-blue-600 px-2 text-center text-white shadow-[0_12px_26px_rgba(37,99,235,0.24)] lg:hidden">
                <div className="min-w-0">
                  <p className="mb-1 text-[8px] font-black leading-3 text-white/65">
                    مرحلة الطلب
                  </p>
                  <p className="line-clamp-2 text-[11px] font-black leading-3 text-white">
                    {currentStation.station.label}
                  </p>
                  {currentStation.stageLabel ? (
                    <p className="mt-1 line-clamp-2 text-[8px] font-bold leading-3 text-white/78">
                      {currentStation.stageLabel}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 lg:block">
          <PaperworkJourneyStations currentStage={currentStage} />
        </div>
      </div>
    </article>
  );
}

function PaperworkDocumentCard({ document, onMoveOut }) {
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
                  <Button type="button" onClick={() => onMoveOut?.(document)} className="min-w-[92px] bg-emerald-600 text-white hover:bg-emerald-700">
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
        const creatorLabel = move.createdByName || 'مستخدم غير محدد';
        const noteText = typeof move.notes === 'string' ? move.notes.trim() : '';

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
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-bold text-slate-400">
                  <span className="min-w-0 max-w-full truncate" title={creatorLabel}>بواسطة: {creatorLabel}</span>
                  {noteText ? (
                    <>
                      <span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
                      <span className="min-w-0 max-w-full truncate text-slate-500" title={noteText}>ملاحظة: {noteText}</span>
                    </>
                  ) : null}
                </div>
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
  const creatorLabel = move.createdByName || 'مستخدم غير محدد';
  const noteText = typeof move.notes === 'string' ? move.notes.trim() : '';

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
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
          <span className="min-w-0 max-w-full truncate" title={creatorLabel}>بواسطة: {creatorLabel}</span>
          {noteText ? (
            <>
              <span className="h-1 w-1 rounded-full bg-slate-300" aria-hidden="true" />
              <span className="min-w-0 max-w-full truncate" title={noteText}>ملاحظة: {noteText}</span>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function PaperworkDocumentOutMoveSheet({ document, open, onOpenChange, tenantId, onSaved }) {
  const [step, setStep] = useState('customer');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [notes, setNotes] = useState('');
  const [isCustomersLoading, setIsCustomersLoading] = useState(false);
  const [isCustomerSheetOpen, setIsCustomerSheetOpen] = useState(false);
  const [isCustomerSubmitting, setIsCustomerSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const documentName = document?.documentTitle || document?.displayTitle || 'ورقة بدون عنوان';
  const canSave = Boolean(
    document?.id
      && !isSaving
      && selectedCustomer?.id,
  );

  useEffect(() => {
    if (!open) {
      setStep('customer');
      setCustomerSearch('');
      setSelectedCustomer(null);
      setCustomers([]);
      setNotes('');
      setError('');
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !tenantId) {
      setCustomers([]);
      setIsCustomersLoading(false);
      return;
    }

    let active = true;
    const timeoutId = window.setTimeout(() => {
      setIsCustomersLoading(true);
      setError('');

      partnersService.getPartners({
        tenantId,
        filterType: 'customer',
        search: customerSearch,
        status: 'active',
      })
        .then((rows) => {
          if (!active) return;
          setCustomers(rows);
        })
        .catch((loadError) => {
          if (!active) return;
          setError(loadError?.message || 'تعذر تحميل العملاء.');
        })
        .finally(() => {
          if (!active) return;
          setIsCustomersLoading(false);
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [customerSearch, open, tenantId]);

  const selectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setCustomerSearch(customer.name || '');
    setError('');
    setStep('confirm');
  };

  const createCustomer = async (payload) => {
    if (!tenantId) {
      return { ok: false, error: 'لا توجد شركة نشطة.' };
    }

    try {
      setIsCustomerSubmitting(true);
      const createdCustomer = await partnersService.createPartner({
        tenantId,
        ...payload,
        isCustomer: true,
        customerRank: 1,
        isSupplier: Boolean(payload.isSupplier),
        supplierRank: payload.isSupplier ? 1 : 0,
      });
      setCustomers((current) => [createdCustomer, ...current.filter((item) => item.id !== createdCustomer.id)]);
      selectCustomer(createdCustomer);
      setIsCustomerSheetOpen(false);
      return { ok: true };
    } catch (createError) {
      return { ok: false, error: createError.message || 'تعذر إضافة العميل.' };
    } finally {
      setIsCustomerSubmitting(false);
    }
  };

  const save = async () => {
    if (!canSave) return;

    setIsSaving(true);
    setError('');

    try {
      await motoCustomerCareService.createPaperworkDocumentOutMove({
        tenantId,
        documentId: document?.id,
        sourceType: 'to_customer',
        targetPartnerId: selectedCustomer.id,
        notes,
      });
      onOpenChange(false);
      await onSaved?.();
    } catch (saveError) {
      setError(saveError?.message || 'تعذر صرف الورقة.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="max-w-md" dir="rtl">
          <SheetDismissButton />
          <SheetHeader className="space-y-3 bg-white px-5 py-4 pl-16 text-right">
            <div className="min-w-0">
              <SheetTitle className="text-lg font-black">صرف ورقة</SheetTitle>
              <p className="mt-1 truncate text-sm font-bold text-slate-500" title={documentName}>{documentName}</p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <p className="min-w-0 flex-1 truncate text-xs font-black text-slate-400">
                {step === 'customer' ? 'اختيار العميل' : 'مراجعة الصرف'}
              </p>
              <div className="flex flex-shrink-0 items-center gap-2">
                {step === 'customer' ? (
                  <Button type="button" size="sm" onClick={() => setStep('confirm')} disabled={!selectedCustomer?.id}>
                    التالي
                  </Button>
                ) : (
                  <>
                    <Button type="button" size="sm" variant="secondary" onClick={() => setStep('customer')}>رجوع</Button>
                    <Button type="button" size="sm" onClick={save} disabled={!canSave}>
                      {isSaving ? 'جاري الصرف...' : 'تأكيد الصرف'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </SheetHeader>

          <SheetBody className="space-y-4">
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</div>
            ) : null}

            {step === 'customer' ? (
              <div className="space-y-4">
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={customerSearch}
                      onChange={(event) => {
                        setCustomerSearch(event.target.value);
                        setSelectedCustomer(null);
                        setError('');
                      }}
                      placeholder="ابحث عن عميل"
                      className="h-[52px] pr-11 text-base font-bold"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCustomerSheetOpen(true)}
                    className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200"
                    aria-label="إضافة عميل جديد"
                    title="إضافة عميل جديد"
                  >
                    <UserPlus className="h-5 w-5" />
                  </button>
                </div>

                {isCustomersLoading ? (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold text-slate-500">
                    جاري تحميل العملاء...
                  </div>
                ) : customers.length > 0 ? (
                  <div className="max-h-[360px] overflow-y-auto rounded-xl border border-slate-200 bg-white">
                    {customers.map((customer) => {
                      const isSelected = selectedCustomer?.id === customer.id;

                      return (
                        <button
                          key={customer.id}
                          type="button"
                          onClick={() => selectCustomer(customer)}
                          className={`grid w-full grid-cols-[1fr_auto] items-center gap-4 border-b border-slate-100 px-4 py-3 text-right transition last:border-b-0 hover:bg-slate-50 ${
                            isSelected ? 'bg-slate-100 text-slate-950' : 'text-slate-900'
                          }`}
                        >
                          <span className="min-w-0">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm font-black">{customer.name}</span>
                              {isSelected ? (
                                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black text-white">مختار</span>
                              ) : null}
                            </span>
                            <span className="mt-1 grid grid-cols-[70px_1fr] gap-2 text-xs font-bold text-slate-500">
                              <span className="text-slate-400">الهاتف</span>
                              <span className="truncate">{customer.phone || 'بدون رقم هاتف'}</span>
                            </span>
                            {customer.notes ? (
                              <span className="mt-1 grid grid-cols-[70px_1fr] gap-2 text-[11px] font-bold text-slate-400">
                                <span>ملاحظة</span>
                                <span className="truncate">{customer.notes}</span>
                              </span>
                            ) : null}
                          </span>
                          <span className={`flex h-8 w-8 items-center justify-center rounded-full border ${
                            isSelected ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-slate-50 text-transparent'
                          }`}>
                            <Check className="h-4 w-4" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-4 text-sm font-bold text-slate-500">
                    لا يوجد عملاء مطابقون.
                  </div>
                )}
              </div>
            ) : null}

            {step === 'confirm' ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-xs font-black text-slate-400">سيتم صرف الورقة إلى</p>
                  <p className="mt-1 truncate text-base font-black text-slate-950">{selectedCustomer?.name || '--'}</p>
                  <p className="mt-0.5 truncate text-xs font-bold text-slate-500">{selectedCustomer?.phone || 'بدون رقم هاتف'}</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-black text-slate-500">ملاحظات</label>
                  <textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={4}
                    placeholder="اكتب ملاحظة اختيارية"
                    className="w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                  />
                </div>
              </div>
            ) : null}
          </SheetBody>

        </SheetContent>
      </Sheet>

      <PartnerFormSheet
        open={isCustomerSheetOpen}
        onOpenChange={setIsCustomerSheetOpen}
        initialValues={PAPERWORK_NEW_CUSTOMER_INITIAL_VALUES}
        onSubmit={createCustomer}
        isSubmitting={isCustomerSubmitting}
        side="right"
        hideTypeFields
        hideAccountingFields
        hideFooterNote
        hideCancelButton
        accentHeader
        hideDismissButton
        inlineSubmit
      />
    </>
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

const PAPERWORK_STATUS_OPTIONS = [
  { id: 'delivered', label: 'تم تسليم الأوراق للعميل بالفعل', enabled: true },
  { id: 'vault', label: 'الأوراق موجودة في الخزنة', enabled: true },
  { id: 'in_progress', label: 'تم إرسال طلب تنفيذ الأوراق إلى جهة الإصدار', enabled: true },
  { id: 'not_requested_now', label: 'العميل لم يطلب الأوراق الآن', enabled: false },
  { id: 'unknown', label: 'لا توجد معلومات كافية', enabled: false },
];

function PaperworkStatusSheet({ item, open, onOpenChange, tenantId, paperworkDocuments = [], onSaved }) {
  const [step, setStep] = useState('status');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedProcessor, setSelectedProcessor] = useState(null);
  const [resolvedProcessor, setResolvedProcessor] = useState(null);
  const [processorOptions, setProcessorOptions] = useState([]);
  const [isProcessorConfirmOpen, setIsProcessorConfirmOpen] = useState(false);
  const [isProcessorOptionsLoading, setIsProcessorOptionsLoading] = useState(false);
  const [isProcessorSaving, setIsProcessorSaving] = useState(false);
  const [selectedDocumentOwner, setSelectedDocumentOwner] = useState(null);
  const [documentOwnerMode, setDocumentOwnerMode] = useState('');
  const [documentOwnerSearch, setDocumentOwnerSearch] = useState('');
  const [documentOwnerOptions, setDocumentOwnerOptions] = useState([]);
  const [isDocumentOwnersLoading, setIsDocumentOwnersLoading] = useState(false);
  const [isDocumentOwnerSheetOpen, setIsDocumentOwnerSheetOpen] = useState(false);
  const [isDocumentOwnerSubmitting, setIsDocumentOwnerSubmitting] = useState(false);
  const [confirmationNote, setConfirmationNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const itemName = item?.displayName || item?.name || item?.description || 'منتج غير محدد';
  const customerName = item?.customerName || 'عميل غير محدد';
  const customerPhone = item?.customerPhone || '';
  const invoiceCustomerOwnerOption = item?.customerId
    ? {
        id: item.customerId,
        name: customerName,
        phone: customerPhone,
        subtitle: 'عميل الفاتورة',
      }
    : null;
  const processorPartnerId = selectedProcessor?.id
    || item?.trackingUnit?.paperworkProcessorPartnerId
    || item?.trackingUnit?.paperwork_processor_partner_id
    || item?.paperworkProcessorPartnerId
    || item?.paperwork_processor_partner_id
    || null;
  const displayedProcessor = selectedProcessor || resolvedProcessor;
  const currentPaperworkDocument = useMemo(
    () => getCurrentPaperworkDocumentForItem(item, paperworkDocuments),
    [item, paperworkDocuments],
  );
  const currentPaperworkDocumentTitle = currentPaperworkDocument?.documentTitle
    || currentPaperworkDocument?.displayTitle
    || 'ورقة بدون عنوان';
  const currentPaperworkDocumentLastInDate = getPaperworkDocumentLastInDate(currentPaperworkDocument);
  const hasPaperworkProcessor = Boolean(
    processorPartnerId,
  );
  const missingPaperworkProcessor = selectedStatus === 'in_progress' && !hasPaperworkProcessor;
  const missingDocumentOwner = selectedStatus === 'in_progress' && !selectedDocumentOwner?.id;
  const displayedDocumentOwnerOptions = useMemo(() => {
    const ownerSearchText = documentOwnerSearch.trim().toLocaleLowerCase('ar-EG');
    const invoiceOwnerMatchesSearch = !ownerSearchText
      || String(invoiceCustomerOwnerOption?.name || '').toLocaleLowerCase('ar-EG').includes(ownerSearchText)
      || String(invoiceCustomerOwnerOption?.phone || '').includes(ownerSearchText);
    const rows = invoiceCustomerOwnerOption && invoiceOwnerMatchesSearch
      ? [invoiceCustomerOwnerOption]
      : [];
    documentOwnerOptions.forEach((owner) => {
      if (owner.id && owner.id !== invoiceCustomerOwnerOption?.id) {
        rows.push(owner);
      }
    });
    return rows;
  }, [documentOwnerOptions, documentOwnerSearch, invoiceCustomerOwnerOption]);
  const confirmationPlaceholder = selectedStatus === 'vault'
    ? 'مثال: تم العثور على الورق في الخزنة وسيتم ربطه بحالة الأوراق لهذا المنتج.'
    : selectedStatus === 'in_progress'
      ? 'مثال: تم إرسال طلب تنفيذ الأوراق إلى جهة الإصدار وجاري المتابعة.'
      : 'مثال: تم التأكيد هاتفيًا مع العميل أنه استلم الأوراق.';

  useEffect(() => {
    if (!open) return;
    setStep('status');
    setSelectedStatus('');
    setSelectedProcessor(null);
    setResolvedProcessor(null);
    setIsProcessorConfirmOpen(false);
    setProcessorOptions([]);
    setSelectedDocumentOwner(null);
    setDocumentOwnerMode('');
    setDocumentOwnerSearch('');
    setDocumentOwnerOptions([]);
    setIsDocumentOwnerSheetOpen(false);
    setConfirmationNote('');
    setError('');
    setIsSaving(false);
    setIsProcessorSaving(false);
    setIsProcessorOptionsLoading(false);
    setIsDocumentOwnersLoading(false);
    setIsDocumentOwnerSubmitting(false);
  }, [open, item?.id]);

  const loadProcessorOptions = useCallback(async () => {
    if (!tenantId) return;

    setIsProcessorOptionsLoading(true);
    setError('');

    try {
      const suppliers = await partnersService.getPartners({
        tenantId,
        filterType: 'supplier',
        status: 'active',
      });
      const childrenMap = await partnersService.getChildContacts({
        tenantId,
        parentIds: suppliers.map((partner) => partner.id),
        status: 'active',
      });
      const options = suppliers.flatMap((supplier) => {
        const children = childrenMap.get(supplier.id) || [];
        return [
          {
            id: supplier.id,
            name: supplier.name || 'مورد بدون اسم',
            phone: supplier.phone || '',
            subtitle: 'المورد الرئيسي',
            parentName: '',
          },
          ...children.map((child) => ({
            id: child.id,
            name: child.name || 'جهة تابعة بدون اسم',
            phone: child.phone || '',
            subtitle: child.functionTitle || 'جهة اتصال تابعة',
            parentName: supplier.name || '',
          })),
        ];
      });

      setProcessorOptions(options);
    } catch (loadError) {
      setProcessorOptions([]);
      setError(loadError?.message || 'تعذر تحميل جهات إصدار الأوراق.');
    } finally {
      setIsProcessorOptionsLoading(false);
    }
  }, [tenantId]);

  const loadDocumentOwnerOptions = useCallback(async (search = '') => {
    if (!tenantId) return;

    setIsDocumentOwnersLoading(true);
    setError('');

    try {
      const partners = await partnersService.getPartners({
        tenantId,
        filterType: 'all',
        search,
        status: 'active',
      });
      setDocumentOwnerOptions(partners.map((partner) => ({
        id: partner.id,
        name: partner.name || 'جهة بدون اسم',
        phone: partner.phone || partner.phone1 || partner.phone2 || '',
        subtitle: partner.parentName ? `تابع لـ ${partner.parentName}` : partner.isCompany ? 'شركة / جهة رئيسية' : 'شخص',
      })));
    } catch (loadError) {
      setDocumentOwnerOptions([]);
      setError(loadError?.message || 'تعذر تحميل أسماء أصحاب الورق.');
    } finally {
      setIsDocumentOwnersLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    if (!open || step !== 'owner' || documentOwnerMode !== 'other') return undefined;

    const timeoutId = window.setTimeout(() => {
      loadDocumentOwnerOptions(documentOwnerSearch);
    }, 220);

    return () => window.clearTimeout(timeoutId);
  }, [documentOwnerMode, documentOwnerSearch, loadDocumentOwnerOptions, open, step]);

  useEffect(() => {
    if (!open || step !== 'owner' || !tenantId || !processorPartnerId || selectedProcessor?.id === processorPartnerId) {
      return undefined;
    }

    let active = true;

    partnersService.getPartnerById({ tenantId, id: processorPartnerId })
      .then((partner) => {
        if (!active) return;
        setResolvedProcessor(partner ? {
          id: partner.id,
          name: partner.name || 'جهة إصدار غير محددة الاسم',
          phone: partner.phone || partner.phone1 || partner.phone2 || '',
          subtitle: partner.functionTitle || (partner.parentName ? 'جهة اتصال تابعة' : 'جهة إصدار'),
          parentName: partner.parentName || '',
        } : null);
      })
      .catch(() => {
        if (!active) return;
        setResolvedProcessor(null);
      });

    return () => {
      active = false;
    };
  }, [open, processorPartnerId, selectedProcessor?.id, step, tenantId]);

  const save = async () => {
    if (!item) return;
    if (selectedStatus === 'vault' && !currentPaperworkDocument?.id) {
      setError('لا توجد ورقة حالية مرتبطة بنفس القطعة الفريدة في الخزنة.');
      return;
    }
    if (selectedStatus === 'in_progress' && !hasPaperworkProcessor) {
      setError('لم يتم تحديد جهة إصدار الأوراق لهذه القطعة. حدد جهة الإصدار أولا من بيانات القطعة.');
      return;
    }
    if (selectedStatus === 'in_progress' && !selectedDocumentOwner?.id) {
      setError('حدد اسم صاحب الورق أولا.');
      return;
    }
    if (!['delivered', 'vault', 'in_progress'].includes(selectedStatus)) return;

    setIsSaving(true);
    setError('');

    try {
      if (selectedStatus === 'vault') {
        await motoCustomerCareService.createVaultPaperworkRequest({
          tenantId,
          item,
          confirmationNote,
        });
      } else if (selectedStatus === 'delivered') {
        await motoCustomerCareService.createLegacyDeliveredPaperworkRequest({
          tenantId,
          item,
          confirmationNote,
        });
      } else {
        await motoCustomerCareService.createPaperworkRequest({
          tenantId,
          item,
          requestType: 'new_document',
          priority: 'normal',
          documentOwnerPartnerId: selectedDocumentOwner.id,
          processorPartnerId,
          notes: [
            'تم إرسال طلب تنفيذ الأوراق إلى جهة الإصدار.',
            selectedDocumentOwner?.name ? `اسم صاحب الورق: ${selectedDocumentOwner.name}` : '',
            String(confirmationNote || '').trim() ? `ملاحظة: ${String(confirmationNote || '').trim()}` : '',
          ].filter(Boolean).join('\n'),
        });
      }
      await onSaved?.();
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError?.message || 'تعذر تحديد حالة الأوراق.');
    } finally {
      setIsSaving(false);
    }
  };

  const confirmProcessorSelection = async () => {
    if (!selectedProcessor?.id) {
      setError('اختر جهة إصدار الأوراق أولا.');
      return;
    }
    if (!item?.trackingUnitId) {
      setError('تعذر تحديد القطعة الفريدة المرتبطة بهذا المنتج.');
      return;
    }

    setIsProcessorSaving(true);
    setError('');

    try {
      await motoCustomerCareService.updateTrackingUnitPaperworkProcessor({
        tenantId,
        trackingUnitId: item.trackingUnitId,
        processorPartnerId: selectedProcessor.id,
      });
      setIsProcessorConfirmOpen(false);
      setStep('owner');
      loadDocumentOwnerOptions(documentOwnerSearch);
    } catch (saveError) {
      setError(saveError?.message || 'تعذر ربط جهة إصدار الأوراق بالقطعة.');
    } finally {
      setIsProcessorSaving(false);
    }
  };

  const startVaultLink = () => {
    if (!currentPaperworkDocument?.id) {
      setError('لا يوجد ورق مسجل بالخزنة لهذا المنتج.');
      return;
    }

    setError('');
    setSelectedStatus('vault');
    setStep('confirmation');
  };

  const selectDocumentOwner = (owner) => {
    setSelectedDocumentOwner(owner);
    setError('');
    setStep('confirmation');
  };

  const createDocumentOwner = async (payload) => {
    if (!tenantId) {
      return { ok: false, error: 'لا توجد شركة نشطة.' };
    }

    try {
      setIsDocumentOwnerSubmitting(true);
      const createdPartner = await partnersService.createPartner({
        tenantId,
        ...payload,
      });
      const owner = {
        id: createdPartner.id,
        name: createdPartner.name || 'جهة بدون اسم',
        phone: createdPartner.phone || createdPartner.phone1 || createdPartner.phone2 || '',
        subtitle: createdPartner.parentName ? `تابع لـ ${createdPartner.parentName}` : createdPartner.isCompany ? 'شركة / جهة رئيسية' : 'شخص',
      };
      setDocumentOwnerOptions((current) => [owner, ...current.filter((itemOption) => itemOption.id !== owner.id)]);
      setDocumentOwnerMode('other');
      selectDocumentOwner(owner);
      setIsDocumentOwnerSheetOpen(false);
      return { ok: true };
    } catch (createError) {
      return { ok: false, error: createError?.message || 'تعذر إضافة الشريك.' };
    } finally {
      setIsDocumentOwnerSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-md" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="bg-gradient-to-br from-[#0f5f9f] via-[#0d76b7] to-[#0b4f86] px-5 py-5 pl-16 text-right text-white">
          <p className="text-[11px] font-black uppercase text-blue-100/85">Paperwork Status</p>
          <SheetTitle className="mt-1 text-xl font-black text-white">تحديد حالة الأوراق</SheetTitle>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-400">العميل صاحب الفاتورة</p>
              <p className="mt-1 truncate text-sm font-black text-white" title={customerName}>{customerName}</p>
              {customerPhone ? (
                <p className="mt-0.5 truncate font-mono text-xs font-bold text-slate-300" dir="ltr">{customerPhone}</p>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black text-slate-400">المنتج</p>
              <p className="mt-1 truncate text-sm font-black text-white" title={itemName}>{itemName}</p>
            </div>
          </div>
        </SheetHeader>

        <SheetBody className="space-y-5 px-5 py-5">
          {step === 'status' ? (
            <div className="space-y-4">
              {currentPaperworkDocument ? (
                <div className="border-y border-slate-200 bg-slate-50 px-1 py-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
                    <div className="min-w-0">
                      <p className="text-xs font-black text-slate-700">تم العثور على ورق يمكن ربطه بحالة الأوراق.</p>
                      <p className="mt-1 truncate text-xs font-bold text-slate-500" title={currentPaperworkDocumentTitle}>
                        الاسم: <span className="font-black text-slate-700">{currentPaperworkDocumentTitle}</span>
                      </p>
                      <p className="mt-0.5 text-xs font-bold text-slate-500">
                        آخر دخول: <span className="font-black text-slate-700">{formatDate(currentPaperworkDocumentLastInDate)}</span>
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={startVaultLink}
                        disabled={isSaving}
                        className="mt-3 h-8 rounded-full px-3 text-xs font-black"
                      >
                        ربط
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="border-y border-slate-200">
                {PAPERWORK_STATUS_OPTIONS.map((option) => {
                  const optionEnabled = option.id === 'vault' ? Boolean(currentPaperworkDocument) : option.enabled;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        if (optionEnabled) {
                          setSelectedStatus(option.id);
                          setSelectedDocumentOwner(null);
                          setDocumentOwnerMode('');
                          setDocumentOwnerSearch('');
                          setError('');
                          if (option.id === 'in_progress' && !hasPaperworkProcessor) {
                            setStep('processor');
                            loadProcessorOptions();
                          } else if (option.id === 'in_progress') {
                            setStep('owner');
                            loadDocumentOwnerOptions('');
                          } else {
                            setStep('confirmation');
                          }
                        }
                      }}
                      disabled={!optionEnabled || isSaving}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-200 bg-white px-1 py-4 text-right text-slate-700 transition last:border-b-0 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-white disabled:text-slate-400"
                    >
                      <span className="min-w-0 text-sm font-black">{option.label}</span>
                      {!optionEnabled ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-400">
                          {option.id === 'vault' ? 'لا يوجد ورق' : 'قريبًا'}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : step === 'processor' ? (
            <div className="space-y-4">
              <div className="border-y border-red-200 bg-red-50 px-1 py-3 text-xs font-black leading-5 text-red-700">
                لم يتم تحديد جهة إصدار الأوراق لهذه القطعة. اختر المورد أو الموظف التابع المسؤول عن إصدار الأوراق.
              </div>

              <div className="border-y border-slate-200">
                {isProcessorOptionsLoading ? (
                  <div className="px-1 py-5 text-sm font-black text-slate-500">جاري تحميل الموردين وجهات الاتصال التابعة...</div>
                ) : processorOptions.length ? (
                  processorOptions.map((option) => {
                    const isSelected = selectedProcessor?.id === option.id;

                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          setSelectedProcessor(option);
                          setError('');
                          setIsProcessorConfirmOpen(true);
                        }}
                        className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-200 px-1 py-3 text-right transition last:border-b-0 ${
                          isSelected ? 'bg-blue-50 text-blue-900' : 'bg-white text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-black">{option.name}</span>
                          <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">
                            {[option.subtitle, option.parentName ? `تابع لـ ${option.parentName}` : '', option.phone].filter(Boolean).join(' - ')}
                          </span>
                        </span>
                        {isSelected ? (
                          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-black text-white">مختار</span>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-1 py-6 text-center text-sm font-black text-slate-400">
                    لا توجد موردون متاحون لاختيار جهة إصدار الأوراق.
                  </div>
                )}
              </div>
            </div>
          ) : step === 'owner' ? (
            <div className="space-y-4">
              {displayedProcessor?.name ? (
                <div className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-sky-50 px-4 py-3 shadow-[0_12px_28px_rgba(14,116,144,0.10)]">
                  <p className="text-[10px] font-black text-blue-600">جهة إصدار الأوراق المختارة</p>
                  <p className="mt-1 truncate text-base font-black text-slate-950" title={displayedProcessor.name}>
                    {displayedProcessor.name}
                  </p>
                  {displayedProcessor.parentName || displayedProcessor.phone || displayedProcessor.subtitle ? (
                    <p className="mt-1 truncate text-xs font-bold text-slate-500">
                      {[displayedProcessor.subtitle, displayedProcessor.parentName ? `تابع لـ ${displayedProcessor.parentName}` : '', displayedProcessor.phone].filter(Boolean).join(' - ')}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <div className="border-y border-blue-200 bg-blue-50 px-1 py-3 text-xs font-black leading-5 text-blue-800">
                هل سيتم عمل الورق بنفس اسم عميل الفاتورة أم باسم شخص آخر؟
              </div>

              <div className="border-y border-slate-200">
                {invoiceCustomerOwnerOption ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDocumentOwnerMode('invoice_customer');
                      selectDocumentOwner(invoiceCustomerOwnerOption);
                    }}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-200 bg-white px-1 py-3 text-right text-slate-700 transition hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-black">نفس عميل الفاتورة</span>
                      <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">
                        {[invoiceCustomerOwnerOption.name, invoiceCustomerOwnerOption.phone].filter(Boolean).join(' - ')}
                      </span>
                    </span>
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-700">
                      اختيار
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    setDocumentOwnerMode('other');
                    setSelectedDocumentOwner(null);
                    setError('');
                    loadDocumentOwnerOptions(documentOwnerSearch);
                  }}
                  className={`grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-200 px-1 py-3 text-right transition last:border-b-0 ${
                    documentOwnerMode === 'other' ? 'bg-blue-50 text-blue-900' : 'bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black">شخص آخر</span>
                    <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">
                      ابحث واختر صاحب الورق من جهات الاتصال
                    </span>
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                    بحث
                  </span>
                </button>
              </div>

              {documentOwnerMode === 'other' ? (
                <>
                  <div className="flex gap-2">
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        value={documentOwnerSearch}
                        onChange={(event) => {
                          setDocumentOwnerSearch(event.target.value);
                          setError('');
                        }}
                        placeholder="ابحث باسم صاحب الورق"
                        className="h-11 pr-10 text-sm font-bold"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsDocumentOwnerSheetOpen(true)}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200"
                      aria-label="إضافة شريك جديد"
                      title="إضافة شريك جديد"
                    >
                      <UserPlus className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="border-y border-slate-200">
                    {isDocumentOwnersLoading ? (
                      <div className="px-1 py-5 text-sm font-black text-slate-500">جاري تحميل أصحاب الورق...</div>
                    ) : displayedDocumentOwnerOptions.length ? (
                      displayedDocumentOwnerOptions.map((owner) => (
                    <button
                      key={owner.id}
                      type="button"
                      onClick={() => {
                        setDocumentOwnerMode('other');
                        selectDocumentOwner(owner);
                      }}
                      className="grid w-full grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-200 bg-white px-1 py-3 text-right text-slate-700 transition last:border-b-0 hover:bg-slate-50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black">{owner.name}</span>
                        <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">
                          {[owner.subtitle, owner.phone].filter(Boolean).join(' - ')}
                        </span>
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
                        اختيار
                      </span>
                    </button>
                      ))
                    ) : (
                      <div className="px-1 py-6 text-center text-sm font-black text-slate-400">
                        لا توجد جهات مطابقة.
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              {missingPaperworkProcessor ? (
                <div className="border-y border-red-200 bg-red-50 px-1 py-3 text-xs font-black leading-5 text-red-700">
                  لم يتم تحديد جهة إصدار الأوراق لهذه القطعة. حدد جهة الإصدار أولا من بيانات القطعة.
                </div>
              ) : null}
              {missingDocumentOwner ? (
                <div className="border-y border-red-200 bg-red-50 px-1 py-3 text-xs font-black leading-5 text-red-700">
                  حدد اسم صاحب الورق أولا.
                </div>
              ) : null}
              {selectedStatus === 'in_progress' && selectedDocumentOwner?.name ? (
                <div className="border-y border-slate-200 bg-slate-50 px-1 py-3 text-xs font-black leading-5 text-slate-700">
                  سيتم عمل الورق باسم: <span className="text-slate-950">{selectedDocumentOwner.name}</span>
                </div>
              ) : null}
              <label className="block space-y-2">
                <span className="text-xs font-black text-slate-500">ملحوظة التأكيد</span>
                <textarea
                  value={confirmationNote}
                  onChange={(event) => {
                    setConfirmationNote(event.target.value);
                    setError('');
                  }}
                  rows={6}
                  className="w-full resize-none border-0 border-y border-slate-200 bg-white px-0 py-3 text-sm font-bold text-slate-900 outline-none placeholder:text-slate-300 focus:border-slate-400"
                  placeholder={confirmationPlaceholder}
                />
              </label>
            </div>
          )}

          {error ? (
            <div className="border-y border-red-200 bg-red-50 px-1 py-2 text-xs font-black text-red-700">
              {error}
            </div>
          ) : null}
        </SheetBody>

        {step === 'processor' ? null : (
          <SheetFooter className="border-t border-slate-200 px-5 py-4">
          {step !== 'status' ? (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setStep(step === 'confirmation' && selectedStatus === 'in_progress' ? 'owner' : 'status')}
              disabled={isSaving}
            >
              رجوع
            </Button>
          ) : null}
          {step === 'confirmation' ? (
            <Button
              type="button"
              onClick={save}
              disabled={isSaving || missingPaperworkProcessor || missingDocumentOwner || !['delivered', 'vault', 'in_progress'].includes(selectedStatus)}
              className="flex-1"
            >
              {isSaving ? 'جاري الحفظ...' : 'تأكيد'}
            </Button>
          ) : null}
          </SheetFooter>
        )}
      </SheetContent>
      <Dialog.Root open={isProcessorConfirmOpen} onOpenChange={setIsProcessorConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-slate-950/35 backdrop-blur-sm" />
          <Dialog.Content
            dir="rtl"
            className="fixed left-1/2 top-1/2 z-[71] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-slate-200 bg-white p-5 text-right shadow-[0_24px_70px_rgba(15,23,42,0.24)] outline-none"
          >
            <Dialog.Title className="text-base font-black text-slate-950">تأكيد جهة إصدار الأوراق</Dialog.Title>
            <Dialog.Description className="mt-3 text-sm font-bold leading-6 text-slate-600">
              سيتم ربط جهة إصدار الأوراق بهذه القطعة على اسم{' '}
              <span className="font-black text-slate-950">{selectedProcessor?.name || 'جهة غير محددة'}</span>
              {selectedProcessor?.parentName ? (
                <span> — تابع لـ {selectedProcessor.parentName}</span>
              ) : null}
            </Dialog.Description>
            <div className="mt-5 flex items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setIsProcessorConfirmOpen(false)}
                disabled={isProcessorSaving}
              >
                إلغاء
              </Button>
              <Button
                type="button"
                onClick={confirmProcessorSelection}
                disabled={isProcessorSaving || !selectedProcessor?.id}
                className="flex-1"
              >
                {isProcessorSaving ? 'جاري الربط...' : 'تأكيد والمتابعة'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <PartnerFormSheet
        open={isDocumentOwnerSheetOpen}
        onOpenChange={setIsDocumentOwnerSheetOpen}
        initialValues={{
          name: documentOwnerSearch,
          phone: '',
          notes: 'تم الإضافة بغرض استخراج أوراق.',
          isCustomer: true,
          isSupplier: false,
          isCompany: false,
          contactType: 'person',
        }}
        onSubmit={createDocumentOwner}
        isSubmitting={isDocumentOwnerSubmitting}
        side="right"
        hideTypeFields
        hideCompanyFields
        hideNotesField
        hideAccountingFields
        hideFooterNote
        hideCancelButton
        accentHeader
        hideDismissButton
        inlineSubmit
      />
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

function SalesFollowUpCard({
  sale,
  paperworkRequests = [],
  paperworkDocuments = [],
  onRegisterTrackingUnit,
  onCreatePaperworkRequest,
  onOpenPaperworkRequest,
}) {
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
              paperworkDocuments={paperworkDocuments}
              onRegisterTrackingUnit={onRegisterTrackingUnit}
              onOpenPaperworkRequest={onOpenPaperworkRequest}
              onCreatePaperworkRequest={(item) => onCreatePaperworkRequest?.({
                ...item,
                tenantId: sale.tenantId,
                branchId: sale.branchId,
                customerId: sale.customerId,
                customerName: sale.customer?.name || 'عميل غير محدد',
                customerPhone: sale.customer?.phone || sale.customer?.phone1 || sale.customer?.phone2 || '',
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
  const [isMobileContentOpen, setIsMobileContentOpen] = useState(false);
  const [isMobileContentClosing, setIsMobileContentClosing] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.matchMedia('(max-width: 1023px)').matches;
  });
  const [hasRequestedMobileData, setHasRequestedMobileData] = useState(false);
  const [paperworkFilter, setPaperworkFilter] = useState('all');
  const [activeReportFilter, setActiveReportFilter] = useState(null);
  const [isReportFilterLoading, setIsReportFilterLoading] = useState(false);
  const [trackingSheetItem, setTrackingSheetItem] = useState(null);
  const [licenseSheetItem, setLicenseSheetItem] = useState(null);
  const [trackingUnitPickerItem, setTrackingUnitPickerItem] = useState(null);
  const [stockUnitSheetItem, setStockUnitSheetItem] = useState(null);
  const [paperworkRequestItem, setPaperworkRequestItem] = useState(null);
  const [paperworkRequestDetails, setPaperworkRequestDetails] = useState(null);
  const [pendingProcessorPaperworkOpen, setPendingProcessorPaperworkOpen] = useState(false);
  const [paperworkDocumentSheetOpen, setPaperworkDocumentSheetOpen] = useState(false);
  const [paperworkOutMoveDocument, setPaperworkOutMoveDocument] = useState(null);
  const prefersReducedMotion = useReducedMotion();
  const mobileCloseTimeoutRef = useRef(null);
  const reportFilterTimeoutRef = useRef(null);
  const { tenant_user: tenantUser } = useAuth();
  const salesLimit = isMobileViewport && !hasRequestedMobileData ? 10 : 250;
  const {
    tenantId,
    sales,
    paperworkRequests,
    paperworkDocuments,
    paperworkDocumentMoves,
    paperworkReports,
    isReportsLoading,
    isLoading,
    error,
    refresh,
    updatePaperworkRequestLocally,
    ensurePaperworkLoaded,
  } = useMotoCustomerCareSales({ limit: salesLimit, enabled: true, activeSection });
  const displayedSales = useMemo(() => {
    if (activeSection !== 'sales') {
      return [];
    }

    return filterSalesByPaperworkReport(sales, paperworkRequests, activeReportFilter);
  }, [activeReportFilter, activeSection, paperworkRequests, sales]);
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
  const hasOpenSheet = Boolean(
    trackingSheetItem
      || licenseSheetItem
      || trackingUnitPickerItem
      || stockUnitSheetItem
      || paperworkRequestItem
      || paperworkRequestDetails
      || pendingProcessorPaperworkOpen
      || paperworkDocumentSheetOpen
      || paperworkOutMoveDocument,
  );

  const activeSectionLabel = followUpSections.find((section) => section.id === activeSection)?.label || 'المبيعات';
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);

    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);

    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const shouldHideAppBackButton = hasOpenSheet
      || (isMobileViewport && (isMobileContentOpen || isMobileContentClosing));
    document.documentElement.classList.toggle('customer-care-section-open', shouldHideAppBackButton);
    document.body.classList.toggle('customer-care-section-open', shouldHideAppBackButton);

    return () => {
      document.documentElement.classList.remove('customer-care-section-open');
      document.body.classList.remove('customer-care-section-open');
    };
  }, [hasOpenSheet, isMobileContentClosing, isMobileContentOpen, isMobileViewport]);

  const handleSectionChange = (sectionId) => {
    if (mobileCloseTimeoutRef.current) {
      window.clearTimeout(mobileCloseTimeoutRef.current);
      mobileCloseTimeoutRef.current = null;
    }

    setIsMobileContentClosing(false);
    setActiveSection(sectionId);
    setHasRequestedMobileData(true);
    setIsMobileContentOpen(true);
  };
  const handleReportFilterChange = (filterId) => {
    if (filterId === 'sent_pending_receipt') {
      setPendingProcessorPaperworkOpen(true);
      ensurePaperworkLoaded();
      return;
    }

    if (reportFilterTimeoutRef.current) {
      window.clearTimeout(reportFilterTimeoutRef.current);
      reportFilterTimeoutRef.current = null;
    }

    setActiveReportFilter(filterId);
    setHasRequestedMobileData(true);
    setActiveSection('sales');
    setIsReportFilterLoading(true);

    reportFilterTimeoutRef.current = window.setTimeout(() => {
      setIsReportFilterLoading(false);
      reportFilterTimeoutRef.current = null;
    }, 260);
  };
  const handleOpenPaperworkStatus = (item) => {
    setPaperworkRequestItem(item);
    ensurePaperworkLoaded();
  };
  const handleCloseMobileSection = () => {
    if (prefersReducedMotion) {
      setIsMobileContentOpen(false);
      setIsMobileContentClosing(false);
      return;
    }

    setIsMobileContentClosing(true);
    mobileCloseTimeoutRef.current = window.setTimeout(() => {
      setIsMobileContentOpen(false);
      setIsMobileContentClosing(false);
      mobileCloseTimeoutRef.current = null;
    }, 220);
  };
  useEffect(
    () => () => {
      if (mobileCloseTimeoutRef.current) {
        window.clearTimeout(mobileCloseTimeoutRef.current);
      }
      if (reportFilterTimeoutRef.current) {
        window.clearTimeout(reportFilterTimeoutRef.current);
      }
    },
    [],
  );
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
    <section className="relative flex min-h-0 flex-1 flex-col items-stretch overflow-hidden text-white" dir="rtl">
      <style>{`
        @keyframes customerCareMobilePageIn {
          from { opacity: 0; transform: translateY(10px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes customerCareMobilePageOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(8px) scale(0.99); }
        }
        @keyframes customerCareMobileSaleEntryIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @media (max-width: 1023px) {
          .customer-care-mobile-page-in {
            animation: customerCareMobilePageIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) both;
          }
          .customer-care-mobile-page-out {
            animation: customerCareMobilePageOut 0.14s cubic-bezier(0.7, 0, 0.84, 0) both;
          }
          .customer-care-mobile-sale-entry {
            animation: customerCareMobileSaleEntryIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
          }
        }
        .customer-care-operations-window {
          font-size: 0.94rem;
        }
        .customer-care-operations-window .text-xs {
          font-size: 0.72rem;
          line-height: 1.1rem;
        }
        .customer-care-operations-window .text-sm {
          font-size: 0.82rem;
          line-height: 1.25rem;
        }
        .customer-care-operations-window .text-lg {
          font-size: 1rem;
          line-height: 1.5rem;
        }
        .customer-care-operations-window .text-xl {
          font-size: 1.08rem;
          line-height: 1.55rem;
        }
        .customer-care-operations-window .sm\\:text-2xl {
          font-size: 1.2rem;
          line-height: 1.7rem;
        }
      `}</style>
      <div className="relative z-10 grid min-h-0 w-full max-w-none flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(18rem,0.72fr)_minmax(34rem,1.28fr)] lg:items-stretch lg:bg-[radial-gradient(circle_at_28%_18%,rgba(56,189,248,0.30)_0%,rgba(37,99,235,0.16)_32%,transparent_58%),linear-gradient(145deg,#164f86_0%,#123f72_52%,#0c2f59_100%)]">
        <div className="customer-care-fade-up relative z-[45] h-full min-h-0 overflow-x-hidden overflow-y-auto border-l border-white/12 bg-[radial-gradient(circle_at_45%_22%,rgba(56,189,248,0.30)_0%,rgba(37,99,235,0.18)_34%,transparent_58%),linear-gradient(145deg,#164f86_0%,#123f72_52%,#0c2f59_100%)] px-0 pb-8 pt-16 text-right text-white shadow-[-18px_0_44px_rgba(15,23,42,0.16)] [-webkit-overflow-scrolling:touch] sm:px-0 sm:pt-20 lg:overflow-hidden lg:border-l-0 lg:bg-none lg:px-8 lg:pb-0 lg:pt-14 lg:shadow-none xl:px-10" style={{ animationDelay: '0s' }}>
          <div className="pointer-events-none absolute inset-0 hidden sm:block">
            <span className="absolute left-[10%] top-[11%] h-7 w-7 rounded-md bg-white/12 shadow-[92px_98px_0_rgba(255,255,255,0.08),148px_32px_0_rgba(125,211,252,0.12)]" />
            <span className="absolute right-[13%] top-[34%] h-12 w-12 rounded-lg bg-white/10 shadow-[-38px_142px_0_rgba(125,211,252,0.10),92px_238px_0_rgba(255,255,255,0.08)]" />
            <span className="absolute left-[27%] top-[22%] h-px w-36 rotate-12 bg-gradient-to-r from-transparent via-sky-200/30 to-transparent" />
          </div>
          <div className="pointer-events-none absolute inset-y-10 left-0 w-px bg-white/20" />
          <div className="relative mt-4 px-4 sm:px-10 lg:mt-5 lg:px-0">
            <p className="mb-2 text-xs font-semibold text-blue-100/80 sm:mb-3 sm:text-sm">Customer Care</p>
            <h1 className="max-w-sm text-3xl font-bold leading-tight text-white sm:text-5xl">
              خدمة عملاء الموتوسيكلات
            </h1>
            <p className="mt-3 max-w-md text-sm font-semibold leading-6 text-blue-50/74 sm:text-base sm:leading-7">
              متابعة البيع، الأوراق، وحالة القطع بعد التسليم.
            </p>
          </div>
          <div className="relative mt-6 min-h-0">
            <FollowUpSectionsPanel
              activeSection={activeSection}
              activeReportFilter={activeReportFilter}
              onSectionChange={handleSectionChange}
              onReportFilterChange={handleReportFilterChange}
              paperworkReports={paperworkReports}
              isReportsLoading={isReportsLoading}
              sales={sales}
              paperworkRequests={paperworkRequests}
              paperworkDocuments={paperworkDocuments}
              isMobileContentOpen={isMobileContentOpen}
              isLoading={isLoading}
              isFiltering={isReportFilterLoading}
              onRegisterTrackingUnit={setTrackingUnitPickerItem}
              onCreatePaperworkRequest={handleOpenPaperworkStatus}
              onOpenPaperworkRequest={setPaperworkRequestDetails}
            />
          </div>
        </div>

          <section className={`${isMobileContentOpen || isMobileContentClosing ? `fixed inset-0 z-[120] flex h-[100dvh] w-screen max-w-none rounded-none border-0 shadow-none ${isMobileContentClosing ? 'customer-care-mobile-page-out' : 'customer-care-mobile-page-in'}` : 'hidden'} customer-care-operations-window customer-care-fade-up min-h-0 flex-col overflow-hidden bg-white lg:relative lg:z-[80] lg:m-0 lg:flex lg:h-full lg:w-full lg:max-w-none lg:justify-self-stretch lg:rounded-none lg:border-0 lg:border-r lg:border-white/70 lg:bg-white lg:shadow-[16px_0_34px_rgba(8,47,73,0.16),0_0_0_1px_rgba(255,255,255,0.36)] lg:before:pointer-events-none lg:before:absolute lg:before:inset-y-0 lg:before:right-0 lg:before:z-20 lg:before:w-px lg:before:bg-white/85 lg:animate-none`} style={{ animationDelay: '0.06s' }}>
            <div className="relative z-10 flex min-h-[3.35rem] items-center justify-between gap-3 border-b border-slate-300 bg-gradient-to-b from-slate-50 to-slate-100 px-3 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] text-slate-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.95)] after:pointer-events-none after:absolute after:inset-x-0 after:bottom-[-1px] after:h-px after:bg-white/80 sm:px-4 sm:py-3 lg:bg-gradient-to-b lg:from-slate-50 lg:to-slate-100">
              <div className="flex min-w-0 items-center gap-4">
                <button
                  type="button"
                  onClick={handleCloseMobileSection}
                  className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200 lg:hidden"
                  aria-label="رجوع للأقسام"
                >
                  <ArrowRight className="h-5 w-5" />
                </button>
                <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700 shadow-sm">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg font-black leading-7 text-slate-950 sm:text-xl sm:leading-7">{activeSectionLabel}</h3>
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
              {isLoading || (['sales', 'requests'].includes(activeSection) && isReportFilterLoading) ? (
                <LoadingSpinner title="جاري تحميل العمليات" description="يتم تجهيز بيانات القسم الحالي." />
              ) : error ? (
                <div className="m-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm font-bold text-red-700">{error}</div>
              ) : activeSection === 'requests' && paperworkRequests.length ? (
                paperworkRequests.map((request) => (
                  <PaperworkRequestCard
                    key={request.id}
                    request={request}
                    onOpen={setPaperworkRequestDetails}
                  />
                ))
              ) : activeSection === 'papers' && paperworkFilter === 'moves' && displayedPaperworkMoves.length ? (
                displayedPaperworkMoves.map((move) => (
                  <PaperworkDocumentMoveCard key={move.id} move={move} />
                ))
              ) : activeSection === 'papers' && paperworkFilter !== 'moves' && displayedPaperworkDocuments.length ? (
                displayedPaperworkDocuments.map((document) => (
                  <PaperworkDocumentCard key={document.id} document={document} onMoveOut={setPaperworkOutMoveDocument} />
                ))
              ) : activeSection === 'sales' && displayedSales.length ? (
                displayedSales.map((sale) => (
                  <SalesFollowUpCard
                    key={sale.id}
                    sale={sale}
                    paperworkRequests={paperworkRequests}
                    paperworkDocuments={paperworkDocuments}
                    onRegisterTrackingUnit={setTrackingUnitPickerItem}
                    onCreatePaperworkRequest={handleOpenPaperworkStatus}
                    onOpenPaperworkRequest={setPaperworkRequestDetails}
                  />
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center">
                  {activeSection === 'papers' ? (
                    <>
                      <h2 className="text-lg font-black text-slate-950">لا توجد أوراق</h2>
                      <p className="mt-2 text-sm font-semibold text-slate-500">قسم الأوراق يعرض مستندات paperwork_documents وحركاتها من paperwork_document_moves.</p>
                    </>
                  ) : activeSection === 'requests' ? (
                    <>
                      <h2 className="text-lg font-black text-slate-950">لا توجد طلبات أوراق</h2>
                      <p className="mt-2 text-sm font-semibold text-slate-500">ستظهر هنا طلبات تنفيذ الأوراق ومراحل متابعتها.</p>
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
      <PaperworkStatusSheet
        item={paperworkRequestItem}
        open={Boolean(paperworkRequestItem)}
        onOpenChange={(open) => {
          if (!open) setPaperworkRequestItem(null);
        }}
        tenantId={tenantId}
        paperworkDocuments={paperworkDocuments}
        onSaved={refresh}
      />
      <PaperworkRequestDetailsDrawer
        request={paperworkRequestDetails}
        open={Boolean(paperworkRequestDetails)}
        onOpenChange={(open) => {
          if (!open) setPaperworkRequestDetails(null);
        }}
        tenantId={tenantId}
        onCustomerConfirmed={(confirmation) => {
          if (!paperworkRequestDetails?.id || !confirmation) return;

          const confirmationPatch = {
            customerConfirmed: true,
            customerConfirmedAt: confirmation.customerConfirmedAt,
            customerConfirmedBy: confirmation.customerConfirmedBy,
            customerConfirmedByName: confirmation.customerConfirmedByName,
          };

          updatePaperworkRequestLocally(paperworkRequestDetails.id, confirmationPatch);
          setPaperworkRequestDetails((current) => (
            current?.id === paperworkRequestDetails.id
              ? {
                ...current,
                ...confirmationPatch,
                events: confirmation.event
                  ? [...(current.events || []), confirmation.event]
                  : current.events,
              }
              : current
          ));
        }}
        onRequestSent={(result) => {
          if (!paperworkRequestDetails?.id || !result) return;

          const sentPatch = {
            currentStage: result.currentStage,
            stage: {
              code: result.currentStage,
              name: 'تم الإرسال للجهة',
            },
            updatedAt: result.updatedAt,
          };

          updatePaperworkRequestLocally(paperworkRequestDetails.id, sentPatch);
          setPaperworkRequestDetails((current) => (
            current?.id === paperworkRequestDetails.id
              ? {
                ...current,
                ...sentPatch,
                events: result.event
                  ? [...(current.events || []), result.event]
                  : current.events,
              }
              : current
          ));
        }}
        onSaved={(processor) => {
          if (!paperworkRequestDetails?.id || !processor) return;

          const nextProcessor = {
            id: processor.id,
            name: processor.name,
            phone: processor.phone,
            phone1: processor.phone,
            parentName: processor.parentName || '',
            functionTitle: processor.subtitle || '',
            subtitle: processor.subtitle || '',
          };

          updatePaperworkRequestLocally(paperworkRequestDetails.id, {
            processorPartnerId: processor.id,
            processor: nextProcessor,
          });
          setPaperworkRequestDetails((current) => (
            current?.id === paperworkRequestDetails.id
              ? {
                ...current,
                processorPartnerId: processor.id,
                processor: nextProcessor,
              }
              : current
          ));
        }}
      />
      <PendingProcessorPaperworkDrawer
        open={pendingProcessorPaperworkOpen}
        onOpenChange={setPendingProcessorPaperworkOpen}
        requests={paperworkRequests}
        tenantId={tenantId}
        onReceived={(receivedItems) => {
          receivedItems.forEach((item) => {
            updatePaperworkRequestLocally(item.requestId, {
              currentStage: 'received_from_processor',
              stage: {
                code: 'received_from_processor',
                name: 'تم استلام الورق من الجهة',
              },
              updatedAt: item.updatedAt,
            });
          });
          refresh();
        }}
      />

      <PaperworkDocumentSheet
        open={paperworkDocumentSheetOpen}
        onOpenChange={setPaperworkDocumentSheetOpen}
        tenantId={tenantId}
        userId={tenantUser?.id}
        onSaved={refresh}
      />
      <PaperworkDocumentOutMoveSheet
        document={paperworkOutMoveDocument}
        open={Boolean(paperworkOutMoveDocument)}
        onOpenChange={(open) => {
          if (!open) setPaperworkOutMoveDocument(null);
        }}
        tenantId={tenantId}
        onSaved={refresh}
      />
    </section>
  );
}
