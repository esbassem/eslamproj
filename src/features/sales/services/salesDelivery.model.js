const text = (value) => typeof value === 'string' ? value.trim() : '';
const quantity = (value) => Math.round(Number(value) * 10000) / 10000;

const FULFILLMENT_STATUSES = new Set([
  'unreserved',
  'reserved',
  'partially_delivered',
  'delivered',
  'not_required',
]);

const DELIVERY_REASON_MESSAGES = Object.freeze({
  SALE_NOT_CONFIRMED: 'لا يمكن التسليم لأن البيع غير مؤكد.',
  SALE_CONFIRMATION_LINK_INVALID: 'ربط تأكيد البيع غير مكتمل. أعد تحميل البيع ثم حاول مرة أخرى.',
  SALE_DELIVERY_NOT_REQUIRED: 'بنود هذا البيع لا تحتاج إلى تسليم مخزني.',
  SALE_INVENTORY_RESERVATION_MISSING: 'لا يوجد حجز مخزون صالح لهذا البيع.',
  SALE_INVENTORY_RESERVATION_INVALID: 'حجز المخزون لم يعد صالحًا للتسليم.',
  SALE_FULFILLMENT_STATE_INCONSISTENT: 'تغيرت حالة تنفيذ البيع. أعد تحميل البيانات قبل التسليم.',
  SALE_ALREADY_DELIVERED: 'تم تسليم جميع بنود البيع بالفعل.',
});

function normalizeTrackingUnit(value = {}) {
  return {
    id: text(value.tracking_unit_id),
    trackingNumber: text(value.tracking_number),
    state: text(value.state),
    deliverable: value.deliverable === true,
  };
}

function normalizeDeliveryLine(value = {}) {
  const trackingRequirement = text(value.tracking_requirement);
  return {
    saleLineId: text(value.sale_line_id),
    productId: text(value.product_id),
    productName: text(value.product_name),
    trackingRequirement: trackingRequirement === 'serial' ? 'serial' : 'none',
    orderedQuantity: quantity(value.ordered_quantity || 0),
    deliveredQuantity: quantity(value.delivered_quantity || 0),
    remainingQuantity: Math.max(quantity(value.remaining_quantity || 0), 0),
    trackingUnits: Array.isArray(value.tracking_units)
      ? value.tracking_units.map(normalizeTrackingUnit).filter((unit) => unit.id)
      : [],
  };
}

export function normalizeSaleDeliveryEligibility(value = {}) {
  const fulfillmentStatus = text(value.fulfillment_status);
  return {
    saleId: text(value.sale_id),
    saleNumber: text(value.sale_number),
    commercialStatus: text(value.commercial_status),
    version: Number.isInteger(Number(value.version)) ? Number(value.version) : null,
    eligible: value.eligible === true,
    fulfillmentStatus: FULFILLMENT_STATUSES.has(fulfillmentStatus) ? fulfillmentStatus : 'unreserved',
    requiredQuantity: quantity(value.required_quantity || 0),
    deliveredQuantity: quantity(value.delivered_quantity || 0),
    remainingQuantity: Math.max(quantity(value.remaining_quantity || 0), 0),
    location: value.location?.id ? { id: text(value.location.id), name: text(value.location.name) } : null,
    deliverableLines: Array.isArray(value.deliverable_lines)
      ? value.deliverable_lines.map(normalizeDeliveryLine).filter((line) => line.saleLineId)
      : [],
    blockingReasons: Array.isArray(value.blocking_reasons)
      ? value.blocking_reasons.map(text).filter(Boolean)
      : [],
  };
}

export function normalizeSaleDeliveryResult(value = {}) {
  return {
    saleId: text(value.sale_id),
    saleNumber: text(value.sale_number),
    commercialStatus: text(value.commercial_status),
    version: Number(value.version || 0),
    fulfillmentStatus: text(value.fulfillment_status),
    deliveredQuantity: quantity(value.delivered_quantity || 0),
    remainingQuantity: Math.max(quantity(value.remaining_quantity || 0), 0),
    idempotentReplay: value.idempotent_replay === true,
  };
}

export function getSaleDeliveryReasonMessage(reason) {
  return DELIVERY_REASON_MESSAGES[text(reason)] || 'لا توجد عناصر قابلة للتسليم حاليًا.';
}

export function createInitialSaleDeliverySelection(eligibility = {}) {
  const quantities = {};
  const trackingUnits = {};
  for (const line of eligibility.deliverableLines ?? []) {
    if (line.remainingQuantity <= 0) continue;
    if (line.trackingRequirement === 'serial') {
      for (const unit of line.trackingUnits.filter((item) => item.deliverable)) {
        trackingUnits[`${line.saleLineId}:${unit.id}`] = true;
      }
    } else {
      quantities[line.saleLineId] = String(line.remainingQuantity);
    }
  }
  return { quantities, trackingUnits };
}

export function buildSaleDeliveryLines(eligibility = {}, selection = {}) {
  const deliveryLines = [];
  for (const line of eligibility.deliverableLines ?? []) {
    if (line.remainingQuantity <= 0) continue;
    if (line.trackingRequirement === 'serial') {
      for (const unit of line.trackingUnits.filter((item) => item.deliverable)) {
        if (selection.trackingUnits?.[`${line.saleLineId}:${unit.id}`]) {
          deliveryLines.push({ sale_line_id: line.saleLineId, tracking_unit_id: unit.id, quantity: 1 });
        }
      }
      continue;
    }
    const selectedQuantity = quantity(selection.quantities?.[line.saleLineId]);
    if (selectedQuantity > 0) deliveryLines.push({ sale_line_id: line.saleLineId, quantity: selectedQuantity });
  }
  return deliveryLines;
}

export function getSaleDeliverySelectionIssue(eligibility = {}, selection = {}) {
  if (!eligibility.eligible) {
    return getSaleDeliveryReasonMessage(eligibility.blockingReasons?.[0]);
  }
  for (const line of eligibility.deliverableLines ?? []) {
    if (line.trackingRequirement === 'serial') continue;
    const rawValue = selection.quantities?.[line.saleLineId];
    if (rawValue == null || rawValue === '') continue;
    const selectedQuantity = quantity(rawValue);
    if (!Number.isFinite(Number(rawValue)) || selectedQuantity < 0) return `كمية ${line.productName} غير صحيحة.`;
    if (selectedQuantity > line.remainingQuantity) return `كمية ${line.productName} أكبر من المتبقي القابل للتسليم.`;
  }
  if (!buildSaleDeliveryLines(eligibility, selection).length) return 'اختر بندًا واحدًا على الأقل للتسليم.';
  return '';
}

export function saleDeliveryFingerprint(payload = {}) {
  const lines = [...(payload.deliveryLines ?? [])].sort((left, right) =>
    `${left.sale_line_id}:${left.tracking_unit_id ?? ''}`.localeCompare(`${right.sale_line_id}:${right.tracking_unit_id ?? ''}`));
  return JSON.stringify({
    saleId: text(payload.saleId),
    expectedVersion: Number(payload.expectedVersion),
    deliveryLines: lines,
  });
}

export function createSaleDeliveryIdempotencyKey(saleId) {
  return `sales-deliver:${text(saleId)}:${crypto.randomUUID()}`;
}

export function resolveSaleDeliveryAttempt(currentAttempt, payload, createKey = createSaleDeliveryIdempotencyKey) {
  const fingerprint = saleDeliveryFingerprint(payload);
  if (currentAttempt?.fingerprint === fingerprint) return currentAttempt;
  return { fingerprint, idempotencyKey: createKey(payload.saleId) };
}

export function isAuthoritativeSaleDeliveryError(code) {
  return new Set([
    'SALE_DELIVERY_NOT_ELIGIBLE',
    'SALE_DELIVERY_LINE_NOT_DELIVERABLE',
    'SALE_DELIVERY_RESERVATION_MAPPING_INVALID',
    'SALE_DELIVERY_INVENTORY_STATE_INVALID',
    'SALE_DELIVERY_FINAL_STATE_INVALID',
    'INVENTORY_RESERVATION_NOT_DELIVERABLE',
    'INVENTORY_OVER_DELIVERY',
    'INVENTORY_TRACKING_STATE_INVALID',
    'SALES_VERSION_CONFLICT',
  ]).has(text(code));
}
