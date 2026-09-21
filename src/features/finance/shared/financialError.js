const DOMAIN_MESSAGES = Object.freeze({
  FINANCIAL_AUTHORIZATION_REQUIRED: 'ليس لديك صلاحية لتنفيذ هذه العملية المالية.',
  FINANCIAL_AUTHORIZATION_DENIED: 'ليس لديك صلاحية لتنفيذ هذه العملية المالية.',
  MONEY_DESTINATION_NOT_ALLOWED_FOR_ACTION: 'مكان الأموال غير متاح لك لهذه العملية.',
  PAYMENT_DESTINATION_NOT_ALLOWED: 'مكان استلام الأموال غير متاح لهذه العملية.',
  NO_ALLOWED_PAYMENT_DESTINATION: 'لا يوجد مكان أموال متاح لطريقة الدفع المختارة.',
  PAYMENT_DESTINATION_SELECTION_REQUIRED: 'اختر مكان استلام الأموال.',
  PAYMENT_METHOD_INVALID_OR_INACTIVE: 'طريقة الدفع غير متاحة أو تم تعطيلها.',
  PAYMENT_METHOD_REFERENCE_REQUIRED: 'المرجع مطلوب لطريقة الدفع المختارة.',
  FINANCIAL_PAYMENT_AMOUNT_MUST_BE_POSITIVE: 'أدخل مبلغًا صحيحًا أكبر من صفر.',
  ALLOCATION_AMOUNT_INVALID: 'أدخل مبلغ تخصيص صحيحًا.',
  ALLOCATION_EXCEEDS_SOURCE_RESIDUAL: 'مبلغ التخصيص أكبر من المتاح في الدفعة.',
  ALLOCATION_EXCEEDS_TARGET_RESIDUAL: 'مبلغ التخصيص أكبر من المتبقي على المستند.',
  ALLOCATION_EXCEEDS_AVAILABLE_RESIDUAL: 'مبلغ التخصيص أكبر من المتاح في الدفعة أو المستند.',
  INTERNAL_TRANSFER_AMOUNT_MUST_BE_POSITIVE: 'أدخل مبلغ تحويل صحيحًا.',
  INTERNAL_TRANSFER_SAME_DESTINATION_FORBIDDEN: 'يجب أن يختلف مكان التحويل منه عن مكان التحويل إليه.',
  INTERNAL_TRANSFER_DESTINATION_NOT_ALLOWED: 'أحد مكاني الأموال غير متاح لهذا التحويل.',
  MONEY_DESTINATION_NEGATIVE_BALANCE_NOT_ALLOWED: 'الرصيد غير كافٍ لإتمام العملية.',
  FINANCIAL_PERIOD_CLOSED: 'الفترة المحاسبية مغلقة لهذه العملية.',
  FINANCIAL_PAYMENT_IDEMPOTENCY_PAYLOAD_MISMATCH: 'تم إرسال نفس الطلب مسبقًا ببيانات مختلفة. أغلق النموذج وحاول مجددًا.',
  ALLOCATION_IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: 'تعارض طلب التخصيص مع طلب سابق. أعد فتح النموذج.',
  INTERNAL_TRANSFER_IDEMPOTENCY_PAYLOAD_MISMATCH: 'تعارض طلب التحويل مع طلب سابق. أعد فتح النموذج.',
});

export function normalizeFinancialError(error, fallback = 'تعذر تنفيذ العملية المالية. حاول مرة أخرى.') {
  if (error?.isFinancialError) return error;
  const diagnostic = String(error?.message ?? error ?? '');
  const knownCode = Object.keys(DOMAIN_MESSAGES).find((code) => diagnostic.includes(code));
  const denied = error?.code === '42501' || /AUTHORIZATION|ACCESS_DENIED|NOT_ALLOWED/.test(diagnostic);
  const insufficient = /INSUFFICIENT|NEGATIVE_BALANCE/.test(diagnostic);
  const periodClosed = /PERIOD.*CLOSED|CLOSED.*PERIOD/.test(diagnostic);
  const code = knownCode
    ?? (denied ? 'FINANCIAL_AUTHORIZATION_DENIED' : null)
    ?? (insufficient ? 'MONEY_DESTINATION_NEGATIVE_BALANCE_NOT_ALLOWED' : null)
    ?? (periodClosed ? 'FINANCIAL_PERIOD_CLOSED' : null)
    ?? 'FINANCIAL_OPERATION_FAILED';
  const wrapped = new Error(DOMAIN_MESSAGES[code] ?? fallback);
  wrapped.name = 'FinancialOperationError';
  wrapped.code = code;
  wrapped.diagnostic = diagnostic;
  wrapped.cause = error;
  wrapped.isFinancialError = true;
  return wrapped;
}

export function requireFinancialTenant(tenantId) {
  if (!tenantId) throw normalizeFinancialError(null, 'لا توجد شركة نشطة.');
}
