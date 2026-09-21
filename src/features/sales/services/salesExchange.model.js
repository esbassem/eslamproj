import {
  buildSaleReturnLines,
  createInitialReturnSelection,
  normalizeSaleReturnEligibility,
} from './salesReturn.model.js';
import { createDraftLine, draftLineTotal } from './salesDraft.model.js';

const text = (value) => typeof value === 'string' ? value.trim() : '';
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const SALE_EXCHANGE_MESSAGES = Object.freeze({
  SALE_NOT_CONFIRMED: 'يمكن استبدال بيع مؤكد فقط.',
  SALES_EXCHANGE_DENIED: 'ليس لديك صلاحية بدء استبدال.',
  SALES_EXCHANGE_VIEW_DENIED: 'ليس لديك صلاحية عرض البيع المطلوب استبداله.',
  SALE_EXCHANGE_SCOPE_DENIED: 'البيع خارج نطاق الفرع المسموح لك.',
  SALE_EXCHANGE_DEPENDENT_PERMISSION_MISSING: 'صلاحيات المرتجع وإنشاء المسودة المطلوبة للاستبدال غير مكتملة.',
  SALE_EXCHANGE_INPUT_INVALID: 'بيانات طلب الاستبدال غير مكتملة أو غير صحيحة.',
  SALE_EXCHANGE_LINES_INVALID: 'بنود المرتجع المطلوبة غير صحيحة.',
  SALE_EXCHANGE_REPLACEMENT_LINE_INVALID: 'أحد بنود البيع البديل غير صحيح.',
  SALE_EXCHANGE_PRODUCT_NOT_SELLABLE: 'أحد المنتجات البديلة غير نشط أو غير صالح للبيع.',
  SALE_EXCHANGE_SERVICE_HAS_NO_INVENTORY: 'الخدمة لا تقبل بيانات مخزون أو قطعة متسلسلة.',
  SALE_EXCHANGE_QUANTITY_TRACKING_INVALID: 'الكمية أو بيانات تتبع المنتج البديل غير صحيحة.',
  SALE_EXCHANGE_SERVICE_LOCATION_NOT_ALLOWED: 'لا يُحدد موقع مخزون عندما تكون كل بنود البديل خدمات.',
  SALE_HAS_NO_RETURNABLE_LINES: 'لا توجد بنود مسلّمة متبقية قابلة للاستبدال.',
  SALES_VERSION_CONFLICT: 'تم تحديث البيع من مستخدم آخر. راجع البيانات ثم أعد المحاولة.',
  SALE_EXCHANGE_REPLACEMENT_LOCATION_DENIED: 'موقع المنتج البديل غير مسموح لهذا الفرع.',
  SALE_EXCHANGE_SERIAL_SELECTION_REQUIRED: 'اختر القطعة الفعلية للمنتج البديل المتسلسل.',
  SALE_EXCHANGE_IDEMPOTENCY_CONFLICT: 'مفتاح المحاولة مستخدم لطلب استبدال مختلف.',
  SALES_IDEMPOTENCY_IN_PROGRESS: 'طلب الاستبدال نفسه قيد التنفيذ الآن. حاول بعد لحظات.',
});

export function getSaleExchangeMessage(code) {
  return SALE_EXCHANGE_MESSAGES[text(code)] || 'لا يمكن بدء الاستبدال في الحالة الحالية.';
}

function normalizeRelationship(value = {}) {
  return {
    id: text(value.id),
    status: text(value.status),
    reason: text(value.reason),
    createdAt: text(value.created_at),
    returnId: text(value.return_id),
    returnNumber: text(value.return_number),
    returnAmount: number(value.return_amount),
    originalSaleId: text(value.original_sale_id),
    originalSaleNumber: text(value.original_sale_number),
    replacementSaleId: text(value.replacement_sale_id),
    replacementSaleNumber: text(value.replacement_sale_number),
    replacementStatus: text(value.replacement_status),
    replacementTotal: number(value.replacement_total),
    returnedItems: Array.isArray(value.returned_items) ? value.returned_items.map((item) => ({
      description: text(item.description),
      quantity: number(item.quantity),
      trackingNumber: text(item.tracking_number),
      chassisNumber: text(item.chassis_number) || text(item.tracking_number),
      engineNumber: text(item.engine_number),
    })) : [],
  };
}

export function normalizeSaleExchangeEligibility(value = {}) {
  const blockers = Array.isArray(value.blocking_reasons)
    ? value.blocking_reasons.map(text).filter(Boolean)
    : [];
  return {
    saleId: text(value.sale_id),
    saleNumber: text(value.sale_number),
    expectedVersion: number(value.expected_version),
    currencyCode: text(value.currency_code).toUpperCase() || 'EGP',
    customer: { id: text(value.customer?.id), name: text(value.customer?.name) },
    branch: { id: text(value.branch?.id), name: text(value.branch?.name) },
    permissionGranted: value.permission_granted === true,
    dependentPermissionsGranted: value.dependent_permissions_granted === true,
    canExchange: value.can_exchange === true,
    blockers,
    reasonMessage: blockers.length ? getSaleExchangeMessage(blockers[0]) : '',
    returnEligibility: value.return_eligibility
      ? normalizeSaleReturnEligibility(value.return_eligibility)
      : null,
    replacementLocations: Array.isArray(value.replacement_locations)
      ? value.replacement_locations.map((item) => ({
          id: text(item.id), name: text(item.name), code: text(item.code),
        })).filter((item) => item.id)
      : [],
    sourceExchange: value.source_exchange ? normalizeRelationship(value.source_exchange) : null,
    exchanges: Array.isArray(value.exchanges)
      ? value.exchanges.map(normalizeRelationship).filter((item) => item.id)
      : [],
  };
}

export function normalizeSaleExchangeResult(value = {}) {
  return {
    exchangeId: text(value.exchange_id),
    status: text(value.status),
    originalSaleId: text(value.original_sale_id),
    originalSaleNumber: text(value.original_sale_number),
    originalSaleVersion: number(value.original_sale_version),
    returnId: text(value.return_id),
    returnNumber: text(value.return_number),
    returnedAmount: number(value.returned_amount),
    customerCreditAmount: number(value.customer_credit_amount),
    replacementSaleId: text(value.replacement_sale_id),
    replacementSaleVersion: number(value.replacement_sale_version),
    replacementTotal: number(value.replacement_total),
    estimatedDifference: number(value.estimated_difference),
    idempotentReplay: value.idempotent_replay === true,
  };
}

export function createExchangeDraftLine(product) {
  return createDraftLine(product);
}

export function createExchangeReturnSelection(eligibility) {
  return createInitialReturnSelection(eligibility?.returnEligibility || {});
}

export function buildExchangePayload({
  eligibility,
  returnSelection,
  returnDestinationId,
  replacementLocationId,
  replacementLines,
  reason,
}) {
  const hasGoods = replacementLines.some((line) => line.product?.productType === 'goods');
  return {
    originalSaleId: eligibility?.saleId,
    expectedVersion: eligibility?.expectedVersion,
    returnLines: buildSaleReturnLines(eligibility?.returnEligibility || { lines: [] }, returnSelection),
    replacementLines: replacementLines.map((line) => ({
      product_id: line.product.id,
      description: text(line.description) || line.product.name,
      quantity: number(line.quantity),
      unit_price: Math.round(number(line.unitPrice) * 100) / 100,
      tracking_unit_id: line.trackingUnit?.id || null,
    })),
    returnDestinationLocationId: returnDestinationId || null,
    replacementLocationId: hasGoods ? replacementLocationId || null : null,
    reason: text(reason),
  };
}

export function getExchangeInputIssue(input) {
  const { eligibility, returnSelection, returnDestinationId, replacementLocationId, replacementLines, reason } = input;
  if (!eligibility?.canExchange) return eligibility?.reasonMessage || 'الاستبدال غير متاح.';
  const returnEligibility = eligibility.returnEligibility;
  const returnLines = buildSaleReturnLines(returnEligibility || { lines: [] }, returnSelection);
  if (!returnLines.length) return 'اختر بندًا واحدًا على الأقل لإرجاعه.';
  if (returnLines.some((selected) => selected.quantity > (returnEligibility.lines.find((line) => line.saleLineId === selected.sale_line_id)?.returnableQuantity || 0))) {
    return 'إحدى الكميات أكبر من المتاح للاستبدال.';
  }
  const needsReturnDestination = returnLines.some((selected) => returnEligibility.lines.find((line) => line.saleLineId === selected.sale_line_id)?.kind !== 'service');
  if (needsReturnDestination && !returnDestinationId) return 'اختر موقع استلام المنتج المرتجع.';
  if (!text(reason)) return 'سبب الاستبدال مطلوب.';
  if (text(reason).length > 1000) return 'سبب الاستبدال يجب ألا يتجاوز 1000 حرف.';
  if (!replacementLines.length) return 'أضف منتجًا بديلًا واحدًا على الأقل.';
  if (replacementLines.some((line) => !line.product?.id || number(line.quantity) <= 0 || number(line.unitPrice) < 0)) {
    return 'بيانات أحد بنود البيع البديل غير صحيحة.';
  }
  const goods = replacementLines.filter((line) => line.product.productType === 'goods');
  if (goods.length && !replacementLocationId) return 'اختر موقع مخزون المنتج البديل.';
  if (goods.some((line) => line.product.tracking === 'serial' && !line.trackingUnit?.id)) {
    return 'اختر القطعة الفعلية لكل منتج بديل متسلسل.';
  }
  if (replacementLines.reduce((sum, line) => sum + draftLineTotal(line), 0) <= 0) {
    return 'إجمالي البيع البديل يجب أن يكون أكبر من صفر.';
  }
  return '';
}

export function selectedReturnTotal(eligibility, selection) {
  return buildSaleReturnLines(eligibility?.returnEligibility || { lines: [] }, selection)
    .reduce((sum, selected) => {
      const line = eligibility.returnEligibility.lines.find((candidate) => candidate.saleLineId === selected.sale_line_id);
      return sum + selected.quantity * number(line?.unitPrice);
    }, 0);
}

export function replacementDraftTotal(lines) {
  return lines.reduce((sum, line) => sum + draftLineTotal(line), 0);
}

export function resolveSaleExchangeAttempt(previous, payload) {
  const fingerprint = JSON.stringify(payload);
  if (previous?.fingerprint === fingerprint) return previous;
  return {
    fingerprint,
    idempotencyKey: `sales-exchange-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`,
  };
}
