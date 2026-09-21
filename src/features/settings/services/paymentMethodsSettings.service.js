export const PAYMENT_METHOD_TYPES = Object.freeze([
  { code: 'cash', label: 'نقدي', settlementMode: 'direct' },
  { code: 'bank_transfer', label: 'تحويل بنكي', settlementMode: 'direct' },
  { code: 'wallet', label: 'محفظة', settlementMode: 'direct' },
  { code: 'card', label: 'بطاقة', settlementMode: 'clearing' },
]);

const TYPE_BY_CODE = new Map(PAYMENT_METHOD_TYPES.map((type) => [type.code, type]));

const ERROR_MESSAGES = Object.freeze({
  FINANCIAL_AUTHORIZATION_REQUIRED: 'ليس لديك صلاحية لإدارة طرق الدفع.',
  PAYMENT_METHOD_NAME_REQUIRED: 'أدخل اسمًا واضحًا لطريقة الدفع.',
  PAYMENT_METHOD_IDEMPOTENCY_KEY_INVALID: 'تعذر تأمين الطلب ضد التكرار. أغلق النموذج وحاول مجددًا.',
  PAYMENT_METHOD_TYPE_NOT_AVAILABLE_IN_SETTINGS: 'نوع طريقة الدفع المحدد غير متاح حاليًا.',
  PAYMENT_METHOD_SETTLEMENT_MODE_INVALID: 'إعداد تشغيل طريقة الدفع غير صالح.',
  PAYMENT_METHOD_COMPATIBLE_DESTINATION_REQUIRED: 'يلزم إعداد مكان أموال متوافق قبل إضافة طريقة الدفع هذه.',
  PAYMENT_METHOD_CLEARING_CONFIGURATION_INVALID: 'إعداد تسوية البطاقة لم يعد متاحًا. حدّث الخيارات وحاول مجددًا.',
  PAYMENT_METHOD_IDEMPOTENCY_PAYLOAD_MISMATCH: 'تعارضت إعادة الطلب مع بيانات مختلفة. أغلق النموذج وحاول مجددًا.',
  PAYMENT_METHOD_NOT_FOUND: 'تعذر العثور على طريقة الدفع داخل الشركة الحالية.',
  PAYMENT_METHOD_CONFIGURATION_NOT_USABLE: 'لا يمكن تفعيل طريقة الدفع قبل استكمال الإعداد المالي المطلوب.',
  PAYMENT_METHOD_STRUCTURE_IMMUTABLE: 'لا يمكن تغيير نوع طريقة الدفع بعد إنشائها. عطّلها وأنشئ طريقة جديدة.',
});

function requireTenant(tenantId) {
  if (!tenantId) throw paymentMethodSettingsError({ message: 'PAYMENT_METHOD_NOT_FOUND' });
}

async function defaultClient(client) {
  if (client) return client;
  const { requireSupabase } = await import('@/core/lib/supabase');
  return requireSupabase();
}

async function rpcOrThrow(client, name, payload) {
  const { data, error } = await client.rpc(name, payload);
  if (error) throw paymentMethodSettingsError(error);
  return data;
}

export function paymentMethodTypeLabel(code) {
  return TYPE_BY_CODE.get(code)?.label ?? 'طريقة دفع';
}

export function paymentMethodSettingsError(error) {
  const diagnostic = String(error?.message ?? '');
  const knownCode = Object.keys(ERROR_MESSAGES).find((code) => diagnostic.includes(code));
  const denied = error?.code === '42501'
    || diagnostic.includes('ACCESS_DENIED')
    || diagnostic.includes('AUTHORIZATION')
    || diagnostic.includes('permission denied');
  const code = knownCode ?? (denied ? 'FINANCIAL_AUTHORIZATION_REQUIRED' : 'PAYMENT_METHOD_OPERATION_FAILED');
  const wrapped = new Error(ERROR_MESSAGES[code] ?? 'تعذر تنفيذ عملية طريقة الدفع. حاول مرة أخرى.');
  wrapped.code = code;
  wrapped.diagnostic = diagnostic;
  wrapped.cause = error;
  return wrapped;
}

function normalizeMethod(record) {
  return {
    id: record.payment_method_id,
    name: record.payment_method_name ?? '',
    type: record.method_type,
    typeLabel: paymentMethodTypeLabel(record.method_type),
    settlementMode: record.settlement_mode,
    isActive: record.is_active === true,
    isUsable: record.is_usable === true,
  };
}

function normalizeClearingOption(record) {
  return {
    key: record.configuration_key,
    accountLabel: record.clearing_account_label ?? '',
    journalLabel: record.clearing_journal_label ?? '',
    destinationLabel: record.settlement_destination_label ?? '',
    branchLabel: record.branch_label ?? '',
  };
}

export const paymentMethodsSettingsService = {
  async list(tenantId, client) {
    requireTenant(tenantId);
    const api = await defaultClient(client);
    const rows = await rpcOrThrow(api, 'list_financial_payment_methods_for_settings', { p_tenant_id: tenantId });
    return (rows ?? []).map(normalizeMethod);
  },

  async listClearingOptions(tenantId, client) {
    requireTenant(tenantId);
    const api = await defaultClient(client);
    const rows = await rpcOrThrow(api, 'list_financial_payment_method_clearing_options', { p_tenant_id: tenantId });
    return (rows ?? []).map(normalizeClearingOption);
  },

  async create(tenantId, values, idempotencyKey, client) {
    requireTenant(tenantId);
    const type = TYPE_BY_CODE.get(values?.type);
    if (!type) throw paymentMethodSettingsError({ message: 'PAYMENT_METHOD_TYPE_NOT_AVAILABLE_IN_SETTINGS' });
    const api = await defaultClient(client);
    return rpcOrThrow(api, 'create_financial_payment_method_for_settings', {
      p_tenant_id: tenantId,
      p_name: String(values.name ?? '').trim(),
      p_method_type: type.code,
      p_settlement_mode: type.settlementMode,
      p_idempotency_key: idempotencyKey,
      p_clearing_configuration_key: type.code === 'card' ? values.clearingConfigurationKey || null : null,
    });
  },

  async rename(tenantId, paymentMethodId, name, client) {
    requireTenant(tenantId);
    const api = await defaultClient(client);
    return rpcOrThrow(api, 'rename_financial_payment_method', {
      p_tenant_id: tenantId,
      p_payment_method_id: paymentMethodId,
      p_name: String(name ?? '').trim(),
    });
  },

  async setActive(tenantId, paymentMethodId, isActive, client) {
    requireTenant(tenantId);
    const api = await defaultClient(client);
    return rpcOrThrow(api, 'set_financial_payment_method_status', {
      p_tenant_id: tenantId,
      p_payment_method_id: paymentMethodId,
      p_is_active: isActive,
    });
  },
};
