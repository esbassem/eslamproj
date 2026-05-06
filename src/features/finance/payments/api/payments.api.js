import { requireSupabase } from '@/core/lib/supabase';

const PAYMENT_METHOD_COLUMNS = 'id, code, name, payment_type, is_active, is_system, notes';
const PAYMENT_METHOD_LINE_COLUMNS =
  'id, tenant_id, journal_id, payment_method_id, name, payment_type, is_active, sequence, require_reference, require_attachment';
const JOURNAL_COLUMNS =
  'id, tenant_id, branch_id, name, code, type, default_account_id, is_active, incoming_payment_method_default_id, outgoing_payment_method_default_id, outstanding_receipts_account_id, outstanding_payments_account_id, suspense_account_id, profit_account_id, loss_account_id, created_at, updated_at';
const PAYMENT_SETTINGS_COLUMNS =
  'tenant_id, allow_partial_payments, allow_overpayments, require_cash_journal, allow_payment_on_posted_invoice, require_note_on_cancel, allow_payment_without_invoice, post_payments_immediately, allow_edit_posted_payment, updated_at';

const DEFAULT_PAYMENT_SETTINGS = {
  allow_partial_payments: true,
  allow_overpayments: false,
  require_cash_journal: true,
  allow_payment_on_posted_invoice: true,
  require_note_on_cancel: true,
  allow_payment_without_invoice: false,
  post_payments_immediately: true,
  allow_edit_posted_payment: false,
};

const DEFAULT_METHODS = [
  { code: 'cash_in', name: 'نقدي وارد', payment_type: 'inbound', is_active: true, is_system: true },
  { code: 'cash_out', name: 'نقدي صادر', payment_type: 'outbound', is_active: true, is_system: true },
];

function requireTenantId(tenantId) {
  if (!tenantId) {
    throw new Error('لا يمكن تحميل إعدادات الدفع بدون تحديد الشركة الحالية.');
  }
}

function normalizePaymentType(value) {
  return value === 'outbound' ? 'outbound' : 'inbound';
}

function assertPaymentType(value) {
  if (value !== 'inbound' && value !== 'outbound') {
    throw new Error('نوع الدفع يجب أن يكون وارد أو صادر.');
  }

  return value;
}

function assertJournalType(value) {
  if (value !== 'cash' && value !== 'bank') {
    throw new Error('نوع الجورنال يجب أن يكون نقدي أو بنكي فقط.');
  }

  return value;
}

function normalizeMethodType(record) {
  const code = record?.code?.toLowerCase();
  if (code === 'cash_in' || code === 'cash_out') return 'cash';
  return record?.payment_type ?? 'inbound';
}

function normalizePaymentMethod(record) {
  if (!record) return null;

  return {
    id: record.id,
    code: record.code ?? '',
    name: record.name ?? '',
    paymentType: normalizePaymentType(record.payment_type),
    payment_type: normalizePaymentType(record.payment_type),
    type: normalizeMethodType(record),
    isActive: record.is_active ?? true,
    active: record.is_active ?? true,
    isSystem: record.is_system ?? false,
    is_system: record.is_system ?? false,
    notes: record.notes ?? '',
  };
}

function normalizeJournal(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    tenant_id: record.tenant_id,
    branchId: record.branch_id ?? null,
    branch_id: record.branch_id ?? null,
    name: record.name ?? '',
    code: record.code ?? '',
    type: record.type ?? '',
    defaultAccountId: record.default_account_id ?? null,
    default_account_id: record.default_account_id ?? null,
    incomingPaymentMethodDefaultId: record.incoming_payment_method_default_id ?? null,
    incoming_payment_method_default_id: record.incoming_payment_method_default_id ?? null,
    outgoingPaymentMethodDefaultId: record.outgoing_payment_method_default_id ?? null,
    outgoing_payment_method_default_id: record.outgoing_payment_method_default_id ?? null,
    outstandingReceiptsAccountId: record.outstanding_receipts_account_id ?? null,
    outstanding_receipts_account_id: record.outstanding_receipts_account_id ?? null,
    outstandingPaymentsAccountId: record.outstanding_payments_account_id ?? null,
    outstanding_payments_account_id: record.outstanding_payments_account_id ?? null,
    suspenseAccountId: record.suspense_account_id ?? null,
    suspense_account_id: record.suspense_account_id ?? null,
    profitAccountId: record.profit_account_id ?? null,
    profit_account_id: record.profit_account_id ?? null,
    lossAccountId: record.loss_account_id ?? null,
    loss_account_id: record.loss_account_id ?? null,
    isActive: record.is_active ?? true,
    active: record.is_active ?? true,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
    default: false,
  };
}

function normalizePaymentMethodLine(record, lookups = {}) {
  if (!record) return null;

  const method = lookups.methodsById?.get(record.payment_method_id) ?? null;
  const journal = lookups.journalsById?.get(record.journal_id) ?? null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    journalId: record.journal_id,
    paymentMethodId: record.payment_method_id,
    name: record.name ?? '',
    paymentType: normalizePaymentType(record.payment_type),
    payment_type: normalizePaymentType(record.payment_type),
    sequence: Number(record.sequence ?? 10),
    requireReference: record.require_reference ?? false,
    require_reference: record.require_reference ?? false,
    requireAttachment: record.require_attachment ?? false,
    require_attachment: record.require_attachment ?? false,
    isActive: record.is_active ?? true,
    active: record.is_active ?? true,
    method,
    journal,
  };
}

function normalizePaymentSettings(record) {
  const source = { ...DEFAULT_PAYMENT_SETTINGS, ...(record ?? {}) };

  return {
    tenantId: source.tenant_id ?? null,
    allow_partial_payments: source.allow_partial_payments ?? true,
    allow_overpayments: source.allow_overpayments ?? false,
    require_cash_journal: source.require_cash_journal ?? true,
    require_cash_destination: source.require_cash_journal ?? true,
    allow_payment_on_posted_invoice: source.allow_payment_on_posted_invoice ?? true,
    require_note_on_cancel: source.require_note_on_cancel ?? true,
    allow_payment_without_invoice: source.allow_payment_without_invoice ?? false,
    post_payments_immediately: source.post_payments_immediately ?? true,
    allow_edit_posted_payment: source.allow_edit_posted_payment ?? false,
    updatedAt: source.updated_at ?? null,
  };
}

function buildPaymentMethodPayload(data) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(data, 'code')) {
    payload.code = data.code?.trim()?.toLowerCase() || null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'name')) {
    payload.name = data.name?.trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'paymentType') || Object.prototype.hasOwnProperty.call(data, 'payment_type')) {
    payload.payment_type = assertPaymentType(data.paymentType ?? data.payment_type);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'isActive') || Object.prototype.hasOwnProperty.call(data, 'is_active')) {
    payload.is_active = data.isActive ?? data.is_active;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'isSystem') || Object.prototype.hasOwnProperty.call(data, 'is_system')) {
    payload.is_system = data.isSystem ?? data.is_system;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'notes')) {
    payload.notes = data.notes?.trim() || null;
  }

  return payload;
}

function buildPaymentMethodLinePayload(data) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(data, 'tenantId') || Object.prototype.hasOwnProperty.call(data, 'tenant_id')) {
    payload.tenant_id = data.tenantId ?? data.tenant_id;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'journalId') || Object.prototype.hasOwnProperty.call(data, 'journal_id')) {
    payload.journal_id = data.journalId ?? data.journal_id;
  }
  if (
    Object.prototype.hasOwnProperty.call(data, 'paymentMethodId') ||
    Object.prototype.hasOwnProperty.call(data, 'payment_method_id')
  ) {
    payload.payment_method_id = data.paymentMethodId ?? data.payment_method_id;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'name')) {
    payload.name = data.name?.trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'paymentType') || Object.prototype.hasOwnProperty.call(data, 'payment_type')) {
    payload.payment_type = assertPaymentType(data.paymentType ?? data.payment_type);
  }
  if (Object.prototype.hasOwnProperty.call(data, 'isActive') || Object.prototype.hasOwnProperty.call(data, 'is_active')) {
    payload.is_active = data.isActive ?? data.is_active;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'sequence')) {
    const sequence = Number(data.sequence);
    payload.sequence = Number.isFinite(sequence) ? sequence : 10;
  }
  if (
    Object.prototype.hasOwnProperty.call(data, 'requireReference') ||
    Object.prototype.hasOwnProperty.call(data, 'require_reference')
  ) {
    payload.require_reference = data.requireReference ?? data.require_reference;
  }
  if (
    Object.prototype.hasOwnProperty.call(data, 'requireAttachment') ||
    Object.prototype.hasOwnProperty.call(data, 'require_attachment')
  ) {
    payload.require_attachment = data.requireAttachment ?? data.require_attachment;
  }

  return payload;
}

function buildJournalPayload(data) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(data, 'tenantId') || Object.prototype.hasOwnProperty.call(data, 'tenant_id')) {
    payload.tenant_id = data.tenantId ?? data.tenant_id;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'branchId') || Object.prototype.hasOwnProperty.call(data, 'branch_id')) {
    payload.branch_id = data.branchId ?? data.branch_id ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'name')) {
    payload.name = data.name?.trim() || null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'code')) {
    payload.code = data.code?.trim()?.toLowerCase() || null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'type')) {
    payload.type = assertJournalType(data.type);
  }
  if (
    Object.prototype.hasOwnProperty.call(data, 'defaultAccountId') ||
    Object.prototype.hasOwnProperty.call(data, 'default_account_id')
  ) {
    payload.default_account_id = data.defaultAccountId ?? data.default_account_id ?? null;
  }
  if (
    Object.prototype.hasOwnProperty.call(data, 'incomingPaymentMethodDefaultId') ||
    Object.prototype.hasOwnProperty.call(data, 'incoming_payment_method_default_id')
  ) {
    payload.incoming_payment_method_default_id =
      data.incomingPaymentMethodDefaultId ?? data.incoming_payment_method_default_id ?? null;
  }
  if (
    Object.prototype.hasOwnProperty.call(data, 'outgoingPaymentMethodDefaultId') ||
    Object.prototype.hasOwnProperty.call(data, 'outgoing_payment_method_default_id')
  ) {
    payload.outgoing_payment_method_default_id =
      data.outgoingPaymentMethodDefaultId ?? data.outgoing_payment_method_default_id ?? null;
  }
  if (
    Object.prototype.hasOwnProperty.call(data, 'outstandingReceiptsAccountId') ||
    Object.prototype.hasOwnProperty.call(data, 'outstanding_receipts_account_id')
  ) {
    payload.outstanding_receipts_account_id =
      data.outstandingReceiptsAccountId ?? data.outstanding_receipts_account_id ?? null;
  }
  if (
    Object.prototype.hasOwnProperty.call(data, 'outstandingPaymentsAccountId') ||
    Object.prototype.hasOwnProperty.call(data, 'outstanding_payments_account_id')
  ) {
    payload.outstanding_payments_account_id =
      data.outstandingPaymentsAccountId ?? data.outstanding_payments_account_id ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'suspenseAccountId') || Object.prototype.hasOwnProperty.call(data, 'suspense_account_id')) {
    payload.suspense_account_id = data.suspenseAccountId ?? data.suspense_account_id ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'profitAccountId') || Object.prototype.hasOwnProperty.call(data, 'profit_account_id')) {
    payload.profit_account_id = data.profitAccountId ?? data.profit_account_id ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'lossAccountId') || Object.prototype.hasOwnProperty.call(data, 'loss_account_id')) {
    payload.loss_account_id = data.lossAccountId ?? data.loss_account_id ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(data, 'isActive') || Object.prototype.hasOwnProperty.call(data, 'is_active')) {
    payload.is_active = data.isActive ?? data.is_active;
  }

  return payload;
}

function buildPaymentSettingsPayload(data) {
  const source = data ?? {};

  return {
    allow_partial_payments: source.allow_partial_payments ?? DEFAULT_PAYMENT_SETTINGS.allow_partial_payments,
    allow_overpayments: source.allow_overpayments ?? DEFAULT_PAYMENT_SETTINGS.allow_overpayments,
    require_cash_journal:
      source.require_cash_journal ?? source.require_cash_destination ?? DEFAULT_PAYMENT_SETTINGS.require_cash_journal,
    allow_payment_on_posted_invoice:
      source.allow_payment_on_posted_invoice ?? DEFAULT_PAYMENT_SETTINGS.allow_payment_on_posted_invoice,
    require_note_on_cancel: source.require_note_on_cancel ?? DEFAULT_PAYMENT_SETTINGS.require_note_on_cancel,
    allow_payment_without_invoice:
      source.allow_payment_without_invoice ?? DEFAULT_PAYMENT_SETTINGS.allow_payment_without_invoice,
    post_payments_immediately: source.post_payments_immediately ?? DEFAULT_PAYMENT_SETTINGS.post_payments_immediately,
    allow_edit_posted_payment: source.allow_edit_posted_payment ?? DEFAULT_PAYMENT_SETTINGS.allow_edit_posted_payment,
    updated_at: new Date().toISOString(),
  };
}

async function getPaymentMethodsByIds(client, ids) {
  if (!ids.length) return new Map();

  const { data, error } = await client.from('account_payment_methods').select(PAYMENT_METHOD_COLUMNS).in('id', ids);
  if (error) throw new Error(error.message);

  return new Map((data ?? []).map((record) => [record.id, normalizePaymentMethod(record)]));
}

async function getJournalsByIds(client, tenantId, ids) {
  if (!ids.length) return new Map();

  const { data, error } = await client
    .from('account_journals')
    .select(JOURNAL_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', ids);

  if (error) throw new Error(error.message);

  return new Map((data ?? []).map((record) => [record.id, normalizeJournal(record)]));
}

async function ensureTenantJournal(client, tenantId, journalId) {
  if (!journalId) return;

  const { data, error } = await client
    .from('account_journals')
    .select(JOURNAL_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', journalId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('الجورنال لا يتبع الشركة الحالية.');
  if (!['cash', 'bank'].includes(data.type)) throw new Error('الجورنال يجب أن يكون من نوع نقدي أو بنكي.');
  if (data.is_active === false) throw new Error('لا يمكن ربط طريقة دفع بجورنال غير نشط.');
}

async function ensureActivePaymentMethod(client, paymentMethodId) {
  if (!paymentMethodId) return;

  const { data, error } = await client
    .from('account_payment_methods')
    .select(PAYMENT_METHOD_COLUMNS)
    .eq('id', paymentMethodId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('طريقة الدفع غير موجودة.');
  if (data.is_active === false) throw new Error('لا يمكن ربط جورنال بطريقة دفع غير نشطة.');
}

async function ensurePaymentMethodLineUnique(client, { tenantId, journalId, paymentMethodId, paymentType, ignoredId }) {
  if (!tenantId || !journalId || !paymentMethodId || !paymentType) return;

  let query = client
    .from('account_payment_method_lines')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('journal_id', journalId)
    .eq('payment_method_id', paymentMethodId)
    .eq('payment_type', paymentType)
    .limit(1);

  if (ignoredId) {
    query = query.neq('id', ignoredId);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);
  if (data?.length) throw new Error('هذا الربط موجود بالفعل لنفس الجورنال وطريقة الدفع ونوع الحركة.');
}

async function ensurePaymentMethodCodeUnique(client, code, ignoredId) {
  if (!code) return;

  let query = client.from('account_payment_methods').select('id').eq('code', code).limit(1);

  if (ignoredId) {
    query = query.neq('id', ignoredId);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);
  if (data?.length) throw new Error('هذا الكود مستخدم بالفعل.');
}

async function ensureJournalCodeUnique(client, tenantId, code, ignoredId) {
  if (!tenantId || !code) return;

  let query = client
    .from('account_journals')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('code', code)
    .limit(1);

  if (ignoredId) {
    query = query.neq('id', ignoredId);
  }

  const { data, error } = await query;

  if (error) throw new Error(error.message);
  if (data?.length) throw new Error('كود الجورنال المالي مستخدم بالفعل داخل نفس الشركة.');
}

async function ensurePaymentSettingsRow(client, tenantId) {
  const { data, error } = await client
    .from('payment_settings')
    .select(PAYMENT_SETTINGS_COLUMNS)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data) return normalizePaymentSettings(data);

  const { data: created, error: insertError } = await client
    .from('payment_settings')
    .upsert(
      {
        tenant_id: tenantId,
        ...DEFAULT_PAYMENT_SETTINGS,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' },
    )
    .select(PAYMENT_SETTINGS_COLUMNS)
    .single();

  if (insertError) throw new Error(insertError.message);
  return normalizePaymentSettings(created);
}

export async function getPaymentMethods() {
  const client = requireSupabase();
  const { data, error } = await client
    .from('account_payment_methods')
    .select(PAYMENT_METHOD_COLUMNS)
    .order('payment_type', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizePaymentMethod);
}

export async function createPaymentMethod(data) {
  const client = requireSupabase();
  const payload = buildPaymentMethodPayload(data);

  if (!payload.name) throw new Error('اكتب اسم طريقة الدفع.');
  if (!payload.code) throw new Error('اكتب كود طريقة الدفع.');
  assertPaymentType(payload.payment_type);

  await ensurePaymentMethodCodeUnique(client, payload.code);

  const { data: created, error } = await client
    .from('account_payment_methods')
    .insert(payload)
    .select(PAYMENT_METHOD_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return normalizePaymentMethod(created);
}

export async function updatePaymentMethod(id, data) {
  const client = requireSupabase();
  const payload = buildPaymentMethodPayload(data);

  if (Object.prototype.hasOwnProperty.call(payload, 'name') && !payload.name) throw new Error('اكتب اسم طريقة الدفع.');
  if (Object.prototype.hasOwnProperty.call(payload, 'code') && !payload.code) throw new Error('اكتب كود طريقة الدفع.');

  await ensurePaymentMethodCodeUnique(client, payload.code, id);

  const { data: updated, error } = await client
    .from('account_payment_methods')
    .update(payload)
    .eq('id', id)
    .select(PAYMENT_METHOD_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return normalizePaymentMethod(updated);
}

export async function togglePaymentMethod(id, isActive) {
  return updatePaymentMethod(id, { isActive });
}

export async function getPaymentMethodLines(tenantId) {
  requireTenantId(tenantId);
  const client = requireSupabase();
  const { data, error } = await client
    .from('account_payment_method_lines')
    .select(PAYMENT_METHOD_LINE_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('sequence', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);

  const lines = data ?? [];
  const methodIds = [...new Set(lines.map((line) => line.payment_method_id).filter(Boolean))];
  const journalIds = [...new Set(lines.map((line) => line.journal_id).filter(Boolean))];
  const [methodsById, journalsById] = await Promise.all([
    getPaymentMethodsByIds(client, methodIds),
    getJournalsByIds(client, tenantId, journalIds),
  ]);

  return lines.map((line) => normalizePaymentMethodLine(line, { methodsById, journalsById }));
}

export async function createPaymentMethodLine(data) {
  const payload = buildPaymentMethodLinePayload(data);
  requireTenantId(payload.tenant_id);
  if (!payload.name) throw new Error('اكتب اسم الربط.');
  assertPaymentType(payload.payment_type);

  const client = requireSupabase();
  await ensureTenantJournal(client, payload.tenant_id, payload.journal_id);
  await ensureActivePaymentMethod(client, payload.payment_method_id);
  await ensurePaymentMethodLineUnique(client, {
    tenantId: payload.tenant_id,
    journalId: payload.journal_id,
    paymentMethodId: payload.payment_method_id,
    paymentType: payload.payment_type,
  });

  const { data: created, error } = await client
    .from('account_payment_method_lines')
    .insert(payload)
    .select(PAYMENT_METHOD_LINE_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return normalizePaymentMethodLine(created);
}

export async function updatePaymentMethodLine(id, data) {
  const tenantId = data?.tenantId ?? data?.tenant_id;
  requireTenantId(tenantId);

  const client = requireSupabase();
  const { data: current, error: currentError } = await client
    .from('account_payment_method_lines')
    .select(PAYMENT_METHOD_LINE_COLUMNS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (currentError) throw new Error(currentError.message);
  if (!current) throw new Error('ربط طريقة الدفع غير موجود.');

  const payload = buildPaymentMethodLinePayload(data);
  const nextJournalId = payload.journal_id ?? current.journal_id;
  const nextPaymentMethodId = payload.payment_method_id ?? current.payment_method_id;
  const nextPaymentType = payload.payment_type ?? current.payment_type;

  if (Object.prototype.hasOwnProperty.call(payload, 'name') && !payload.name) throw new Error('اكتب اسم الربط.');
  assertPaymentType(nextPaymentType);

  await ensureTenantJournal(client, tenantId, nextJournalId);
  await ensureActivePaymentMethod(client, nextPaymentMethodId);
  await ensurePaymentMethodLineUnique(client, {
    tenantId,
    journalId: nextJournalId,
    paymentMethodId: nextPaymentMethodId,
    paymentType: nextPaymentType,
    ignoredId: id,
  });

  const { data: updated, error } = await client
    .from('account_payment_method_lines')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(PAYMENT_METHOD_LINE_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return normalizePaymentMethodLine(updated);
}

export async function togglePaymentMethodLine(id, isActive, tenantId) {
  return updatePaymentMethodLine(id, { isActive, tenantId });
}

export async function getPaymentSettings(tenantId) {
  requireTenantId(tenantId);
  const client = requireSupabase();
  return ensurePaymentSettingsRow(client, tenantId);
}

export async function upsertPaymentSettings(tenantId, data) {
  requireTenantId(tenantId);
  const client = requireSupabase();
  const { data: saved, error } = await client
    .from('payment_settings')
    .upsert(
      {
        tenant_id: tenantId,
        ...buildPaymentSettingsPayload(data),
      },
      { onConflict: 'tenant_id' },
    )
    .select(PAYMENT_SETTINGS_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return normalizePaymentSettings(saved);
}

export async function getCashAndBankJournals(tenantId) {
  requireTenantId(tenantId);
  const client = requireSupabase();
  const { data, error } = await client
    .from('account_journals')
    .select(JOURNAL_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('type', ['cash', 'bank'])
    .order('type', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizeJournal);
}

export async function createJournal(data) {
  const payload = buildJournalPayload(data);
  requireTenantId(payload.tenant_id);

  if (!payload.name) throw new Error('اكتب اسم الجورنال المالي.');
  if (!payload.code) throw new Error('اكتب كود الجورنال المالي.');
  assertJournalType(payload.type);

  const client = requireSupabase();
  await ensureJournalCodeUnique(client, payload.tenant_id, payload.code);

  const { data: created, error } = await client
    .from('account_journals')
    .insert(payload)
    .select(JOURNAL_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return normalizeJournal(created);
}

export async function updateJournal(id, data) {
  const tenantId = data?.tenantId ?? data?.tenant_id;
  requireTenantId(tenantId);

  const client = requireSupabase();
  const { data: current, error: currentError } = await client
    .from('account_journals')
    .select(JOURNAL_COLUMNS)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (currentError) throw new Error(currentError.message);
  if (!current) throw new Error('الجورنال المالي غير موجود داخل الشركة الحالية.');

  const payload = buildJournalPayload(data);
  const nextCode = Object.prototype.hasOwnProperty.call(payload, 'code') ? payload.code : current.code;
  const nextType = Object.prototype.hasOwnProperty.call(payload, 'type') ? payload.type : current.type;
  if (Object.prototype.hasOwnProperty.call(payload, 'name') && !payload.name) throw new Error('اكتب اسم الجورنال المالي.');
  if (!nextCode) throw new Error('اكتب كود الجورنال المالي.');
  assertJournalType(nextType);

  await ensureJournalCodeUnique(client, tenantId, nextCode, id);

  delete payload.tenant_id;

  const { data: updated, error } = await client
    .from('account_journals')
    .update(payload)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .select(JOURNAL_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return normalizeJournal(updated);
}

export async function toggleJournalActive(id, isActive, tenantId) {
  return updateJournal(id, { tenantId, isActive });
}

async function findOrCreateDefaultMethods(client) {
  const { data, error } = await client
    .from('account_payment_methods')
    .select(PAYMENT_METHOD_COLUMNS)
    .in('code', DEFAULT_METHODS.map((method) => method.code));

  if (error) throw new Error(error.message);

  const existing = data ?? [];
  const missing = DEFAULT_METHODS.filter(
    (method) =>
      !existing.some(
        (record) =>
          record.code?.toLowerCase() === method.code && normalizePaymentType(record.payment_type) === method.payment_type,
      ),
  );

  if (missing.length) {
    const { data: inserted, error: insertError } = await client
      .from('account_payment_methods')
      .insert(missing)
      .select(PAYMENT_METHOD_COLUMNS);

    if (insertError) throw new Error(insertError.message);
    existing.push(...(inserted ?? []));
  }

  await Promise.all(
    DEFAULT_METHODS.map(async (method) => {
      const current = existing.find(
        (record) =>
          record.code?.toLowerCase() === method.code && normalizePaymentType(record.payment_type) === method.payment_type,
      );

      if (!current || (current.name === method.name && current.is_active === true)) {
        return;
      }

      const { error: updateError } = await client
        .from('account_payment_methods')
        .update({
          name: method.name,
          payment_type: method.payment_type,
          is_active: true,
          is_system: true,
        })
        .eq('id', current.id);

      if (updateError) throw new Error(updateError.message);
    }),
  );

  const { data: ensured, error: ensuredError } = await client
    .from('account_payment_methods')
    .select(PAYMENT_METHOD_COLUMNS)
    .in('code', DEFAULT_METHODS.map((method) => method.code));

  if (ensuredError) throw new Error(ensuredError.message);
  return (ensured ?? []).map(normalizePaymentMethod);
}

export async function ensureDefaultPaymentSetup(tenantId) {
  requireTenantId(tenantId);
  const client = requireSupabase();

  const [settings, methods, journals, existingLines] = await Promise.all([
    ensurePaymentSettingsRow(client, tenantId),
    findOrCreateDefaultMethods(client),
    getCashAndBankJournals(tenantId),
    getPaymentMethodLines(tenantId),
  ]);

  const activeJournals = journals.filter((journal) => journal.isActive);
  const linesToCreate = activeJournals.flatMap((journal) => {
    return ['inbound', 'outbound']
      .map((paymentType) => {
        const methodCode = paymentType === 'inbound' ? 'cash_in' : 'cash_out';
        const method = methods.find((item) => item.code === methodCode && item.paymentType === paymentType);
        if (!method) return null;

        const exists = existingLines.some(
          (line) => line.journalId === journal.id && line.paymentMethodId === method.id && line.paymentType === paymentType,
        );

        if (exists) return null;

        return {
          tenant_id: tenantId,
          journal_id: journal.id,
          payment_method_id: method.id,
          payment_type: paymentType,
          name: `${method.name} - ${journal.name}`,
          sequence: paymentType === 'inbound' ? 10 : 20,
          require_reference: false,
          require_attachment: false,
          is_active: true,
        };
      })
      .filter(Boolean);
  });

  if (linesToCreate.length) {
    const { error } = await client.from('account_payment_method_lines').insert(linesToCreate);
    if (error) throw new Error(error.message);
  }

  return {
    settings,
    methods: await getPaymentMethods(tenantId),
    lines: await getPaymentMethodLines(tenantId),
    journals,
  };
}

export async function fetchPaymentMethods(tenantId) {
  return getPaymentMethods(tenantId);
}

export async function fetchPaymentRules(tenantId) {
  return getPaymentSettings(tenantId);
}

export async function savePaymentRules(tenantId, nextRules) {
  return upsertPaymentSettings(tenantId, nextRules);
}

export async function fetchCashDestinations(tenantId) {
  const journals = await getCashAndBankJournals(tenantId);
  return journals.map((journal, index) => ({
    ...journal,
    default: index === 0,
  }));
}

export async function fetchPaymentJournals(tenantId) {
  return fetchCashDestinations(tenantId);
}

export const paymentSettingsService = {
  getPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  togglePaymentMethod,
  getPaymentMethodLines,
  createPaymentMethodLine,
  updatePaymentMethodLine,
  togglePaymentMethodLine,
  getPaymentSettings,
  upsertPaymentSettings,
  getCashAndBankJournals,
  fetchCashDestinations,
  fetchPaymentJournals,
  createJournal,
  updateJournal,
  toggleJournalActive,
  ensureDefaultPaymentSetup,
};
