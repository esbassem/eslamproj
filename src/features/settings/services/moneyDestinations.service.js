const DESTINATION_COLUMNS = 'id,tenant_id,destination_key,name,destination_type,status,branch_id,responsible_user_id,pos_config_id,bank_name,bank_account_label,bank_identifier_masked,allow_negative_balance,activated_at,created_at,updated_at';

export const MONEY_DESTINATION_TYPES = Object.freeze([
  { code: 'cashbox', label: 'خزنة', description: 'نقدية محفوظة في خزنة النشاط' },
  { code: 'bank', label: 'حساب بنكي', description: 'حساب بنكي تابع للشركة' },
  { code: 'employee_cash_custody', label: 'عهدة موظف', description: 'نقدية الشركة الموجودة مع موظف مسؤول' },
  { code: 'pos_drawer', label: 'درج نقطة بيع', description: 'درج نقدية مرتبط بنقطة بيع' },
  { code: 'wallet', label: 'محفظة إلكترونية', description: 'محفظة تستقبل أو تصرف أموال النشاط' },
]);

export const destinationTypeLabel = (code) => MONEY_DESTINATION_TYPES.find((type) => type.code === code)?.label ?? 'مكان أموال';

function optionalText(value) {
  return String(value ?? '').trim() || null;
}

function normalizeDestination(record, references = {}) {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    key: record.destination_key,
    name: record.name ?? '',
    type: record.destination_type,
    typeLabel: destinationTypeLabel(record.destination_type),
    status: record.status,
    branchId: record.branch_id,
    branchName: references.branches?.get(record.branch_id)?.name ?? '',
    responsibleUserId: record.responsible_user_id,
    responsibleUserName: references.users?.get(record.responsible_user_id)?.full_name ?? '',
    posConfigId: record.pos_config_id,
    posConfigName: references.pos?.get(record.pos_config_id)?.name ?? '',
    bankName: record.bank_name ?? '',
    bankAccountLabel: record.bank_account_label ?? '',
    bankIdentifierMasked: record.bank_identifier_masked ?? '',
    allowNegativeBalance: record.allow_negative_balance === true,
    activatedAt: record.activated_at ?? null,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

async function rowsOrThrow(query) {
  const { data, error } = await query;
  if (error) throw moneyDestinationError(error);
  return data ?? [];
}

async function loadReferences(client, tenantId, records) {
  const branchIds = [...new Set(records.map((row) => row.branch_id).filter(Boolean))];
  const userIds = [...new Set(records.map((row) => row.responsible_user_id).filter(Boolean))];
  const posIds = [...new Set(records.map((row) => row.pos_config_id).filter(Boolean))];
  const [branches, users, pos] = await Promise.all([
    branchIds.length ? rowsOrThrow(client.from('branches').select('id,name').eq('tenant_id', tenantId).in('id', branchIds)) : [],
    userIds.length ? rowsOrThrow(client.from('tenant_users').select('id,full_name').eq('tenant_id', tenantId).in('id', userIds)) : [],
    posIds.length ? rowsOrThrow(client.from('pos_configs').select('id,name').eq('tenant_id', tenantId).in('id', posIds)) : [],
  ]);
  return {
    branches: new Map(branches.map((row) => [row.id, row])),
    users: new Map(users.map((row) => [row.id, row])),
    pos: new Map(pos.map((row) => [row.id, row])),
  };
}

const ERROR_MESSAGES = Object.freeze({
  FINANCIAL_AUTHORIZATION_REQUIRED: 'ليس لديك صلاحية لإدارة أماكن الأموال.',
  MONEY_DESTINATION_NOT_FOUND: 'تعذر العثور على مكان الأموال داخل الشركة الحالية.',
  MONEY_DESTINATION_BRANCH_INVALID_OR_INACTIVE: 'الفرع المحدد غير صالح أو غير نشط.',
  MONEY_DESTINATION_RESPONSIBLE_USER_REQUIRED: 'اختر الموظف المسؤول عن العهدة.',
  MONEY_DESTINATION_RESPONSIBLE_USER_INVALID_OR_INACTIVE: 'الموظف المحدد غير صالح أو غير نشط.',
  MONEY_DESTINATION_POS_CONFIG_INVALID_OR_INACTIVE: 'نقطة البيع المحددة غير صالحة أو غير نشطة.',
  MONEY_DESTINATION_BANK_METADATA_REQUIRED: 'اسم البنك ووصف الحساب البنكي مطلوبان.',
  MONEY_DESTINATION_IDEMPOTENCY_CONFLICT: 'تعارضت إعادة الطلب مع بيانات مختلفة. أغلق النموذج وحاول مجددًا.',
  MONEY_DESTINATION_STATUS_TRANSITION_INVALID: 'لا يمكن تنفيذ تغيير الحالة المطلوب.',
  MONEY_DESTINATION_STATUS_TARGET_INVALID: 'حالة مكان الأموال المطلوبة غير مدعومة.',
  MONEY_DESTINATION_ACTIVE_REQUIRES_LEDGER_ACCOUNT_AND_JOURNAL: 'لم يكتمل الربط المحاسبي التلقائي لمكان الأموال.',
  MONEY_DESTINATION_PARTIAL_OR_INVALID_PROVISIONING_STATE: 'تعذر إكمال موارد مكان الأموال المحاسبية بأمان.',
  MONEY_DESTINATION_ACCOUNT_CODE_RANGE_EXHAUSTED: 'لا توجد أرقام حسابات متاحة لهذا النوع. راجع مسؤول النظام.',
});

export function moneyDestinationError(error) {
  const diagnostic = String(error?.message ?? '');
  const knownCode = Object.keys(ERROR_MESSAGES).find((code) => diagnostic.includes(code));
  const denied = error?.code === '42501' || diagnostic.includes('ACCESS_DENIED') || diagnostic.includes('AUTHORIZATION');
  const wrapped = new Error(knownCode ? ERROR_MESSAGES[knownCode] : denied ? ERROR_MESSAGES.FINANCIAL_AUTHORIZATION_REQUIRED : 'تعذر تنفيذ عملية مكان الأموال. حاول مرة أخرى.');
  wrapped.code = knownCode ?? (denied ? 'FINANCIAL_AUTHORIZATION_REQUIRED' : 'MONEY_DESTINATION_OPERATION_FAILED');
  wrapped.diagnostic = diagnostic;
  wrapped.cause = error;
  return wrapped;
}

function requireTenant(tenantId) {
  if (!tenantId) throw moneyDestinationError({ message: 'MONEY_DESTINATION_NOT_FOUND' });
}

async function defaultClient(client) {
  if (client) return client;
  const { requireSupabase } = await import('@/core/lib/supabase');
  return requireSupabase();
}

export const moneyDestinationsService = {
  async list(tenantId, client) {
    requireTenant(tenantId);
    const api = await defaultClient(client);
    const records = await rowsOrThrow(api.from('money_destinations').select(DESTINATION_COLUMNS).eq('tenant_id', tenantId).order('created_at', { ascending: false }));
    const references = await loadReferences(api, tenantId, records);
    return records.map((record) => normalizeDestination(record, references));
  },

  async listBranches(tenantId, client) {
    requireTenant(tenantId);
    const api = await defaultClient(client);
    return rowsOrThrow(api.from('branches').select('id,name').eq('tenant_id', tenantId).eq('is_active', true).order('name'));
  },

  async listEmployees(tenantId, client) {
    requireTenant(tenantId);
    const api = await defaultClient(client);
    const rows = await rowsOrThrow(api.from('tenant_users').select('id,full_name,email').eq('tenant_id', tenantId).eq('is_active', true).order('full_name').limit(100));
    return rows.map((row) => ({ id: row.id, name: row.full_name || row.email || 'موظف' }));
  },

  async listPosConfigs(tenantId, client) {
    requireTenant(tenantId);
    const api = await defaultClient(client);
    return rowsOrThrow(api.from('pos_configs').select('id,name,branch_id').eq('tenant_id', tenantId).eq('is_active', true).order('name').limit(100));
  },

  async create(tenantId, values, requestKey, client) {
    requireTenant(tenantId);
    if (!requestKey) throw new Error('مفتاح الطلب مطلوب لمنع التكرار.');
    const api = await defaultClient(client);
    const { data, error } = await api.rpc('create_and_provision_money_destination', {
      p_tenant_id: tenantId,
      p_destination_key: `${values.type}_${String(requestKey).replaceAll('-', '').toLowerCase()}`,
      p_name: String(values.name ?? '').trim(),
      p_destination_type: values.type,
      p_branch_id: values.branchId || null,
      p_responsible_user_id: values.type === 'employee_cash_custody' ? values.responsibleUserId || null : null,
      p_pos_config_id: values.type === 'pos_drawer' ? values.posConfigId || null : null,
      p_bank_name: values.type === 'bank' ? optionalText(values.bankName) : null,
      p_bank_account_label: values.type === 'bank' ? optionalText(values.bankAccountLabel) : null,
      p_bank_identifier_masked: values.type === 'bank' ? optionalText(values.bankIdentifierMasked) : null,
      p_metadata: {},
      p_activate: true,
    });
    if (error) throw moneyDestinationError(error);
    return data;
  },

  async rename(tenantId, destinationId, name, client) {
    requireTenant(tenantId);
    const api = await defaultClient(client);
    const { data, error } = await api.rpc('rename_money_destination', { p_tenant_id: tenantId, p_destination_id: destinationId, p_name: String(name ?? '').trim() });
    if (error) throw moneyDestinationError(error);
    return data;
  },

  async setStatus(tenantId, destinationId, status, client) {
    requireTenant(tenantId);
    const api = await defaultClient(client);
    const { data, error } = await api.rpc('set_money_destination_status', { p_tenant_id: tenantId, p_destination_id: destinationId, p_target_status: status });
    if (error) throw moneyDestinationError(error);
    return data;
  },
};
