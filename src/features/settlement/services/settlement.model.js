const SETTLEMENT_ERROR_MESSAGES = Object.freeze({
  ACTIVE_TENANT_MEMBERSHIP_REQUIRED: 'يجب تسجيل الدخول بعضوية نشطة لإتمام التحصيل.',
  SETTLEMENT_VIEW_DENIED: 'ليست لديك صلاحية عرض بيانات التحصيل.',
  SETTLEMENT_COLLECT_DENIED: 'ليست لديك صلاحية تحصيل هذا المبلغ.',
  SETTLEMENT_BRANCH_ACCESS_DENIED: 'هذا المستند خارج نطاق الفروع المسموح لك بها.',
  SETTLEMENT_TARGET_NOT_FOUND: 'لم يعد المستند متاحًا أو أنه خارج نطاقك.',
  SETTLEMENT_TARGET_NOT_CONFIRMED: 'المستند لم يعد جاهزًا للتحصيل.',
  SETTLEMENT_CANONICAL_OBLIGATION_INVALID: 'المستند لا يملك التزامًا ماليًا صالحًا للتحصيل.',
  SETTLEMENT_EXCEEDS_OUTSTANDING: 'تغيّر الرصيد المستحق، والمبلغ أكبر من المتبقي حاليًا.',
  OBLIGATION_ALREADY_SETTLED: 'تم سداد الرصيد بالكامل بالفعل.',
  PAYMENT_METHOD_INVALID_OR_INACTIVE: 'طريقة الدفع لم تعد متاحة لهذه العملية.',
  PAYMENT_CLEARING_CONFIGURATION_UNAVAILABLE: 'طريقة الدفع لم تعد جاهزة للتحصيل حاليًا.',
  PAYMENT_SETTLEMENT_MODE_INVALID: 'طريقة الدفع غير متاحة لهذه العملية.',
  PAYMENT_METHOD_REFERENCE_REQUIRED: 'رقم المرجع مطلوب لطريقة الدفع المختارة.',
  SETTLEMENT_DESTINATION_NOT_ALLOWED: 'مكان التحصيل غير مسموح لهذه العملية.',
  SETTLEMENT_MONEY_DESTINATION_REQUIRED: 'اختر مكان التحصيل.',
  CLEARING_PAYMENT_MUST_NOT_HAVE_DIRECT_DESTINATION: 'طريقة الدفع المختارة لا تستخدم مكان تحصيل مباشرًا.',
  SETTLEMENT_AMOUNT_INVALID: 'أدخل مبلغ تحصيل صحيحًا.',
  SETTLEMENT_PAYMENT_METHOD_REQUIRED: 'اختر طريقة الدفع.',
  SETTLEMENT_IDEMPOTENCY_PAYLOAD_MISMATCH: 'تغيّرت بيانات محاولة التحصيل. راجع البيانات ثم أعد المحاولة.',
  SETTLEMENT_IDEMPOTENT_STATE_INCOMPLETE: 'تعذر تأكيد نتيجة المحاولة السابقة. أعد المحاولة بنفس البيانات.',
  SETTLEMENT_TARGET_TYPE_UNSUPPORTED: 'هذا النوع من المستندات غير مدعوم للتحصيل حاليًا.',
  SETTLEMENT_TARGET_INVALID: 'بيانات المستند غير صالحة للتحصيل.',
  SETTLEMENT_TARGET_ID_INVALID: 'مرجع المستند غير صالح.',
});

const AUTHORITATIVE_STATE_ERROR_CODES = new Set([
  'SETTLEMENT_EXCEEDS_OUTSTANDING',
  'OBLIGATION_ALREADY_SETTLED',
  'PAYMENT_METHOD_INVALID_OR_INACTIVE',
  'PAYMENT_CLEARING_CONFIGURATION_UNAVAILABLE',
  'PAYMENT_SETTLEMENT_MODE_INVALID',
  'SETTLEMENT_DESTINATION_NOT_ALLOWED',
  'SETTLEMENT_MONEY_DESTINATION_REQUIRED',
  'CLEARING_PAYMENT_MUST_NOT_HAVE_DIRECT_DESTINATION',
  'SETTLEMENT_TARGET_NOT_FOUND',
  'SETTLEMENT_TARGET_NOT_CONFIRMED',
  'SETTLEMENT_CANONICAL_OBLIGATION_INVALID',
  'SETTLEMENT_BRANCH_ACCESS_DENIED',
  'SETTLEMENT_VIEW_DENIED',
  'SETTLEMENT_COLLECT_DENIED',
]);

const REASON_MESSAGES = Object.freeze({
  TARGET_NOT_CONFIRMED: 'المستند لم يُعتمد بعد ولا يمكن تحصيله.',
  OBLIGATION_ALREADY_SETTLED: 'تم سداد الرصيد بالكامل.',
  SETTLEMENT_COLLECT_PERMISSION_REQUIRED: 'ليست لديك صلاحية تحصيل هذا المبلغ.',
  NO_ALLOWED_MONEY_PAYMENT_OPTION: 'لا توجد طريقة دفع متاحة ومهيأة لهذه العملية.',
});

const toText = (value) => String(value ?? '').trim();
const toNullableText = (value) => toText(value) || null;
const toMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function normalizeMoneyDestination(destination) {
  return {
    id: toText(destination?.id),
    name: toText(destination?.name),
    type: toText(destination?.type),
    isOwnCustody: destination?.is_own_custody === true,
  };
}

function normalizePaymentMethod(method) {
  return {
    id: toText(method?.id),
    name: toText(method?.name),
    code: toText(method?.code),
    type: toText(method?.type),
    requiresReference: method?.requires_reference === true,
    requiresMoneyDestination: method?.requires_money_destination === true,
    moneyDestinations: Array.isArray(method?.money_destinations)
      ? method.money_destinations
        .map(normalizeMoneyDestination)
        .filter((destination) => destination.id && destination.name)
      : [],
  };
}

function normalizeMechanism(mechanism) {
  return {
    code: toText(mechanism?.code),
    paymentMethods: Array.isArray(mechanism?.payment_methods)
      ? mechanism.payment_methods
        .map(normalizePaymentMethod)
        .filter((method) => method.id && method.name)
      : [],
  };
}

export function normalizeSettlementOptions(payload, requestedTarget = {}) {
  const target = payload?.target ?? {};
  const party = payload?.party ?? {};
  const branch = payload?.branch ?? {};

  return {
    target: {
      type: toText(target.type || requestedTarget.targetType),
      id: toText(target.id || requestedTarget.targetId),
      reference: toText(target.reference),
      status: toText(target.status),
    },
    party: {
      type: toText(party.type),
      id: toText(party.id),
      name: toText(party.name),
    },
    branch: {
      id: toText(branch.id),
      name: toText(branch.name),
    },
    currencyCode: toText(payload?.currency_code) || 'EGP',
    originalObligation: toMoney(payload?.original_obligation),
    outstandingAmount: toMoney(payload?.outstanding_amount),
    settleableAmount: toMoney(payload?.settleable_amount) ?? 0,
    canSettle: payload?.can_settle === true,
    reasonCodes: Array.isArray(payload?.reason_codes)
      ? payload.reason_codes.map(toText).filter(Boolean)
      : [],
    settlementMechanisms: Array.isArray(payload?.settlement_mechanisms)
      ? payload.settlement_mechanisms
        .map(normalizeMechanism)
        .filter((mechanism) => mechanism.code)
      : [],
  };
}

export function normalizeSettlementResult(payload) {
  return {
    success: payload?.success === true,
    settlementId: toText(payload?.settlement_id),
    target: {
      type: toText(payload?.target?.type),
      id: toText(payload?.target?.id),
      reference: toText(payload?.target?.reference),
    },
    mechanism: toText(payload?.mechanism),
    amount: toMoney(payload?.amount) ?? 0,
    currencyCode: toText(payload?.currency_code) || 'EGP',
    outstandingBefore: toMoney(payload?.outstanding_before) ?? 0,
    outstandingAfter: toMoney(payload?.outstanding_after) ?? 0,
    paymentNumber: toText(payload?.payment?.number),
    idempotentReplay: payload?.idempotent_replay === true,
  };
}

export function buildSettlementOptionsRpcArgs({ targetType, targetId } = {}) {
  const normalizedTargetType = toText(targetType).toLowerCase();
  const normalizedTargetId = toText(targetId);
  if (!normalizedTargetType || !normalizedTargetId) {
    throw new Error('تعذر تحديد المستند المطلوب تحصيله.');
  }
  return {
    p_target_type: normalizedTargetType,
    p_target_id: normalizedTargetId,
  };
}

export function buildSettleObligationRpcArgs({
  targetType,
  targetId,
  mechanism,
  amount,
  paymentMethodId,
  idempotencyKey,
  moneyDestinationId = null,
  referenceNumber = null,
  notes = null,
} = {}) {
  const targetArgs = buildSettlementOptionsRpcArgs({ targetType, targetId });
  return {
    ...targetArgs,
    p_mechanism: toText(mechanism).toLowerCase(),
    p_amount: Number(amount),
    p_payment_method_id: toNullableText(paymentMethodId),
    p_idempotency_key: toText(idempotencyKey),
    p_money_destination_id: toNullableText(moneyDestinationId),
    p_reference_number: toNullableText(referenceNumber),
    p_notes: toNullableText(notes),
  };
}

function extractSemanticErrorCode(error) {
  if (error?.settlementCode) return error.settlementCode;
  const diagnosticText = [error?.message, error?.details, error?.hint]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  const mappedCode = Object.keys(SETTLEMENT_ERROR_MESSAGES)
    .find((code) => diagnosticText.includes(code));
  if (mappedCode) return mappedCode;

  return diagnosticText
    .match(/[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+/g)
    ?.find((code) => /^(SETTLEMENT|OBLIGATION|PAYMENT|CLEARING|ACTIVE_TENANT)_/.test(code)) || null;
}

export function getSettlementErrorDescriptor(error, fallbackMessage = 'تعذر إتمام التحصيل. يمكنك إعادة المحاولة بأمان.') {
  const settlementCode = extractSemanticErrorCode(error);
  return {
    code: settlementCode || toText(error?.code) || 'SETTLEMENT_REQUEST_FAILED',
    message: SETTLEMENT_ERROR_MESSAGES[settlementCode] || fallbackMessage,
    shouldRefreshOptions: settlementCode ? AUTHORITATIVE_STATE_ERROR_CODES.has(settlementCode) : false,
  };
}

export function normalizeSettlementError(error, fallbackMessage) {
  if (error?.isSettlementError) return error;
  const descriptor = getSettlementErrorDescriptor(error, fallbackMessage);
  const normalized = new Error(descriptor.message);
  normalized.name = 'SettlementError';
  normalized.code = descriptor.code;
  normalized.settlementCode = descriptor.code;
  normalized.sqlState = toText(error?.code) || null;
  normalized.shouldRefreshOptions = descriptor.shouldRefreshOptions;
  normalized.isSettlementError = true;
  normalized.originalError = error;
  return normalized;
}

export function getSettlementReasonMessage(reasonCode) {
  return REASON_MESSAGES[toText(reasonCode)] || 'المستند غير قابل للتحصيل حاليًا.';
}

export function createSettlementAttemptKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();

  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    const seed = `${Date.now()}-${Math.random()}-${Math.random()}`;
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = seed.charCodeAt(index % seed.length) ^ Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

export function createSettlementPayloadFingerprint(payload = {}) {
  const amount = Number(payload.amount);
  return JSON.stringify({
    targetType: toText(payload.targetType).toLowerCase(),
    targetId: toText(payload.targetId),
    mechanism: toText(payload.mechanism).toLowerCase(),
    amount: Number.isFinite(amount) ? amount.toFixed(2) : null,
    paymentMethodId: toNullableText(payload.paymentMethodId),
    moneyDestinationId: toNullableText(payload.moneyDestinationId),
    referenceNumber: toNullableText(payload.referenceNumber),
    notes: toNullableText(payload.notes),
  });
}

export function resolveSettlementAttempt(currentAttempt, payload, keyFactory = createSettlementAttemptKey) {
  const fingerprint = createSettlementPayloadFingerprint(payload);
  if (currentAttempt?.fingerprint === fingerprint && currentAttempt.idempotencyKey) {
    return currentAttempt;
  }
  return { fingerprint, idempotencyKey: keyFactory() };
}

export function validateMoneyPaymentInput({ amount, outstandingAmount, paymentMethod, moneyDestinationId, referenceNumber } = {}) {
  const numericAmount = Number(amount);
  const scaledAmount = numericAmount * 100;
  if (!Number.isFinite(numericAmount) || numericAmount <= 0 || Math.abs(Math.round(scaledAmount) - scaledAmount) > 1e-8) {
    return 'أدخل مبلغًا صحيحًا لا يزيد على منزلتين عشريتين.';
  }
  if (numericAmount > Number(outstandingAmount || 0)) {
    return 'المبلغ أكبر من الرصيد المستحق حاليًا.';
  }
  if (!paymentMethod?.id) return 'اختر طريقة الدفع.';
  if (paymentMethod.requiresMoneyDestination && !toText(moneyDestinationId)) return 'اختر مكان التحصيل.';
  if (paymentMethod.requiresReference && !toText(referenceNumber)) return 'رقم المرجع مطلوب لطريقة الدفع المختارة.';
  return null;
}

export function createInitialSettlementForm(options, currentForm = null, { reset = false } = {}) {
  const mechanisms = options?.settlementMechanisms ?? [];
  const previousMechanism = reset ? '' : toText(currentForm?.mechanism);
  const mechanism = mechanisms.find((item) => item.code === previousMechanism)
    || mechanisms.find((item) => item.code === 'money_payment')
    || mechanisms[0]
    || null;
  const previousMethod = reset ? '' : toText(currentForm?.paymentMethodId);
  const method = mechanism?.paymentMethods?.find((item) => item.id === previousMethod)
    || mechanism?.paymentMethods?.[0]
    || null;
  const previousDestination = reset ? '' : toText(currentForm?.moneyDestinationId);
  const destinationAllowed = method?.moneyDestinations?.some((item) => item.id === previousDestination);
  const settleableAmount = Number(options?.settleableAmount || 0);
  const currentAmount = Number(currentForm?.amount);
  const keepAmount = !reset && Number.isFinite(currentAmount) && currentAmount > 0 && currentAmount <= settleableAmount;

  return {
    mechanism: mechanism?.code || '',
    amount: settleableAmount > 0 ? String(keepAmount ? currentForm.amount : settleableAmount) : '',
    paymentMethodId: method?.id || '',
    moneyDestinationId: method?.requiresMoneyDestination && destinationAllowed ? previousDestination : '',
    referenceNumber: reset ? '' : toText(currentForm?.referenceNumber),
    notes: reset ? '' : toText(currentForm?.notes),
  };
}
