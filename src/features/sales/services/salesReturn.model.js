const text = (value) => typeof value === 'string' ? value.trim() : '';
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export const SALE_RETURN_REASON_MESSAGES = Object.freeze({
  SALE_NOT_CONFIRMED: 'يمكن إرجاع المبيعات المؤكدة فقط.',
  SALES_RETURN_DENIED: 'ليس لديك صلاحية تسجيل مرتجع.',
  SALE_HAS_NO_RETURNABLE_LINES: 'لا توجد بنود مسلّمة متبقية قابلة للإرجاع.',
  SALE_RETURN_EXCEEDS_DELIVERED_QUANTITY: 'الكمية المطلوبة أكبر من الكمية المسلّمة غير المرتجعة.',
  SALE_RETURN_SERIAL_NOT_RETURNABLE: 'القطعة المحددة لم تُسلّم أو سبق إرجاعها.',
  SALE_RETURN_DESTINATION_DENIED: 'موقع استلام المرتجع غير مسموح لهذا الفرع.',
});

export function getSaleReturnReasonMessage(code) {
  return SALE_RETURN_REASON_MESSAGES[text(code)] || 'لا يمكن تنفيذ المرتجع في الحالة الحالية.';
}

function normalizeReturnLine(value = {}) {
  return {
    saleLineId: text(value.sale_line_id),
    position: number(value.position),
    description: text(value.description),
    productName: text(value.product_name) || text(value.description),
    kind: ['service', 'serial', 'quantity'].includes(text(value.kind)) ? text(value.kind) : 'quantity',
    deliveredQuantity: number(value.delivered_quantity),
    alreadyReturnedQuantity: number(value.already_returned_quantity),
    returnableQuantity: number(value.returnable_quantity),
    unitPrice: number(value.unit_price),
    returnableAmount: number(value.returnable_amount),
    serializedUnits: Array.isArray(value.serialized_units) ? value.serialized_units.map((unit) => ({
      trackingUnitId: text(unit.tracking_unit_id),
      trackingNumber: text(unit.tracking_number),
      chassisNumber: text(unit.chassis_number) || text(unit.tracking_number),
      engineNumber: text(unit.engine_number),
    })).filter((unit) => unit.trackingUnitId) : [],
  };
}

function normalizeReturn(value = {}) {
  return {
    id: text(value.id),
    returnNumber: text(value.return_number),
    createdAt: text(value.created_at),
    reason: text(value.reason),
    amount: number(value.amount),
    refundedAmount: number(value.refunded_amount),
    remainingRefundableAmount: number(value.remaining_refundable_amount),
    lines: Array.isArray(value.lines) ? value.lines.map((line) => ({
      saleLineId: text(line.sale_line_id),
      description: text(line.description),
      quantity: number(line.quantity),
      trackingUnitId: text(line.tracking_unit_id),
      returnAmount: number(line.return_amount),
    })) : [],
  };
}

export function normalizeSaleReturnEligibility(value = {}) {
  const blockingReasons = Array.isArray(value.blocking_reasons) ? value.blocking_reasons.map(text).filter(Boolean) : [];
  return {
    saleId: text(value.sale_id),
    saleNumber: text(value.sale_number),
    customer: { id: text(value.customer?.id), name: text(value.customer?.name) },
    branchId: text(value.branch_id),
    currencyCode: text(value.currency_code).toUpperCase(),
    expectedVersion: number(value.expected_version),
    canReturn: value.can_return === true,
    blockingReasons,
    reasonMessage: blockingReasons.length ? getSaleReturnReasonMessage(blockingReasons[0]) : '',
    returnStatus: ['no_return', 'partially_returned', 'fully_returned'].includes(text(value.return_status)) ? text(value.return_status) : 'no_return',
    lines: Array.isArray(value.lines) ? value.lines.map(normalizeReturnLine).filter((line) => line.saleLineId) : [],
    destinations: Array.isArray(value.destinations) ? value.destinations.map((item) => ({ id: text(item.id), name: text(item.name) })).filter((item) => item.id) : [],
    financial: {
      saleAmount: number(value.financial?.sale_amount),
      settledAmount: number(value.financial?.settled_amount),
      outstandingAmount: number(value.financial?.outstanding_amount),
      returnedAmount: number(value.financial?.returned_amount),
      refundableAmount: number(value.financial?.refundable_amount),
      currencyCode: text(value.financial?.currency_code).toUpperCase(),
    },
    returns: Array.isArray(value.returns) ? value.returns.map(normalizeReturn).filter((item) => item.id) : [],
  };
}

export function normalizeSaleReturnResult(value = {}) {
  return {
    saleId: text(value.sale_id), returnId: text(value.return_id),
    returnNumber: text(value.return_number), returnStatus: text(value.return_status),
    amount: number(value.amount), arAppliedAmount: number(value.ar_applied_amount),
    refundableAmount: number(value.refundable_amount), version: number(value.version),
    idempotentReplay: value.idempotent_replay === true,
  };
}

export function createInitialReturnSelection(eligibility = {}) {
  return Object.fromEntries(eligibility.lines.map((line) => [line.saleLineId, { quantity: '', units: {} }]));
}

export function buildSaleReturnLines(eligibility, selection) {
  return eligibility.lines.flatMap((line) => {
    if (line.kind === 'serial') return line.serializedUnits.filter((unit) => selection[line.saleLineId]?.units?.[unit.trackingUnitId]).map((unit) => ({ sale_line_id: line.saleLineId, tracking_unit_id: unit.trackingUnitId, quantity: 1 }));
    const quantity = number(selection[line.saleLineId]?.quantity);
    return quantity > 0 ? [{ sale_line_id: line.saleLineId, tracking_unit_id: null, quantity }] : [];
  });
}

export function getSaleReturnSelectionIssue(eligibility, selection, destinationId, reason) {
  if (!eligibility?.canReturn) return eligibility?.reasonMessage || 'المرتجع غير متاح.';
  const selected = buildSaleReturnLines(eligibility, selection);
  if (!selected.length) return 'اختر بندًا واحدًا على الأقل.';
  for (const item of selected) {
    const line = eligibility.lines.find((candidate) => candidate.saleLineId === item.sale_line_id);
    if (!line || item.quantity > line.returnableQuantity) return 'إحدى الكميات أكبر من المتاح للإرجاع.';
  }
  const needsDestination = selected.some((item) => eligibility.lines.find((line) => line.saleLineId === item.sale_line_id)?.kind !== 'service');
  if (needsDestination && !destinationId) return 'اختر موقع استلام المرتجع.';
  if (!text(reason)) return 'سبب المرتجع مطلوب.';
  if (text(reason).length > 1000) return 'سبب المرتجع يجب ألا يتجاوز 1000 حرف.';
  return '';
}

export function saleReturnFingerprint(payload = {}) { return JSON.stringify(payload); }
function randomKey(prefix) { return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
export function resolveSaleReturnAttempt(previous, payload) {
  const fingerprint = saleReturnFingerprint(payload);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, idempotencyKey: randomKey('sales-return') };
}

export function normalizeSaleRefundOptions(value = {}) {
  return {
    saleId: text(value.sale_id), canRefund: value.can_refund === true,
    permissionGranted: value.permission_granted === true,
    blockingReason: text(value.blocking_reason),
    credits: Array.isArray(value.credits) ? value.credits.map((item) => ({
      saleReturnId: text(item.sale_return_id), returnNumber: text(item.return_number),
      returnAmount: number(item.return_amount), refundedAmount: number(item.refunded_amount),
      refundableAmount: number(item.refundable_amount), currencyCode: text(item.currency_code).toUpperCase(),
    })) : [],
    methods: Array.isArray(value.methods) ? value.methods.map((method) => ({
      id: text(method.id), name: text(method.name), semanticKey: text(method.semantic_key),
      requiresReference: method.requires_reference === true,
      destinations: Array.isArray(method.destinations) ? method.destinations.map((item) => ({ id: text(item.id), name: text(item.name), type: text(item.type) })) : [],
    })) : [],
  };
}

export function normalizeSaleRefundResult(value = {}) {
  return { saleId: text(value.sale_id), saleReturnId: text(value.sale_return_id), returnNumber: text(value.return_number), refundNumber: text(value.refund_number), amount: number(value.amount), remainingRefundableAmount: number(value.remaining_refundable_amount), version: number(value.version), status: text(value.status), idempotentReplay: value.idempotent_replay === true };
}

export function resolveSaleRefundAttempt(previous, payload) {
  const fingerprint = JSON.stringify(payload);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, idempotencyKey: randomKey('sales-refund') };
}
