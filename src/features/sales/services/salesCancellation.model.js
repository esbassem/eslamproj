const text = (value) => typeof value === 'string' ? value.trim() : '';

export const SALE_CANCELLATION_REASON_MESSAGES = Object.freeze({
  SALE_ALREADY_CANCELLED: 'تم إلغاء هذا البيع بالفعل.',
  SALE_NOT_CONFIRMED: 'يمكن إلغاء المبيعات المؤكدة فقط.',
  SALE_HAS_DELIVERY: 'تم تسليم جزء من هذا البيع بالفعل. استخدم إجراء المرتجع بدل الإلغاء.',
  SALE_CANCELLATION_HAS_DELIVERY: 'تم تسليم جزء من هذا البيع بالفعل. استخدم إجراء المرتجع بدل الإلغاء.',
  SALE_HAS_SETTLEMENT: 'يوجد تحصيل مسجل على هذا البيع. يجب معالجة رد المبلغ قبل إلغاء البيع.',
  SALE_CANCELLATION_HAS_SETTLEMENT: 'يوجد تحصيل مسجل على هذا البيع. يجب معالجة رد المبلغ قبل إلغاء البيع.',
  SALE_CANONICAL_CONFIRMATION_INVALID: 'تعذر التحقق من آثار تأكيد البيع الحالية.',
  SALE_FINANCIAL_REVERSAL_UNAVAILABLE: 'تعذر عكس الأثر المالي لهذا البيع بأمان.',
  SALE_INVENTORY_RELEASE_UNAVAILABLE: 'تعذر تحرير حجز البضاعة لهذا البيع بأمان.',
});

export function getSaleCancellationReasonMessage(code) {
  return SALE_CANCELLATION_REASON_MESSAGES[text(code)] || 'لا يمكن إلغاء هذا البيع في حالته الحالية.';
}

export function normalizeSaleCancellationEligibility(value = {}) {
  const reasonIfBlocked = text(value.reason_if_blocked) || null;
  const cancellation = value.cancellation && typeof value.cancellation === 'object'
    ? {
        reason: text(value.cancellation.reason),
        cancelledAt: text(value.cancellation.cancelled_at),
        cancelledByName: text(value.cancellation.cancelled_by?.name),
        financialReversalReference: text(value.cancellation.financial_reversal_reference),
        inventoryReleaseState: text(value.cancellation.inventory_release_state),
      }
    : null;
  return {
    saleId: text(value.sale_id),
    canCancel: value.can_cancel === true,
    hasDelivery: value.has_delivery === true,
    hasSettlement: value.has_settlement === true,
    financialReversalAvailable: value.financial_reversal_available === true,
    inventoryReleaseAvailable: value.inventory_release_available === true,
    reasonIfBlocked,
    reasonMessage: reasonIfBlocked ? getSaleCancellationReasonMessage(reasonIfBlocked) : '',
    cancellation,
  };
}

export function normalizeSaleCancellationResult(value = {}) {
  return {
    saleId: text(value.sale_id),
    saleNumber: text(value.sale_number),
    status: text(value.status),
    version: Math.max(Number(value.version) || 0, 0),
    cancelledAt: text(value.cancelled_at),
    financialReversalReference: text(value.financial_reversal_reference),
    inventoryReleaseState: text(value.inventory_release_state),
    idempotentReplay: value.idempotent_replay === true,
  };
}

export function saleCancellationFingerprint({ saleId, expectedVersion, reason } = {}) {
  return JSON.stringify({
    saleId: text(saleId),
    expectedVersion: Number(expectedVersion) || 0,
    reason: text(reason),
  });
}

function randomKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function resolveSaleCancellationAttempt(previous, payload) {
  const fingerprint = saleCancellationFingerprint(payload);
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, idempotencyKey: `sales-cancel-${randomKey()}` };
}

export function isAuthoritativeSaleCancellationError(code) {
  return new Set([
    'SALE_ALREADY_CANCELLED',
    'SALE_NOT_CONFIRMED',
    'SALE_CANCELLATION_HAS_DELIVERY',
    'SALE_CANCELLATION_HAS_SETTLEMENT',
    'SALE_FINANCIAL_REVERSAL_UNAVAILABLE',
    'SALE_INVENTORY_RELEASE_UNAVAILABLE',
  ]).has(text(code));
}
