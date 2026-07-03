import { requireSupabase } from '@/core/lib/supabase';
import { createManualReceivable as rpcCreateManualReceivable } from '@/features/receivables/api/createManualReceivable';

const RECEIVABLE_COLUMNS = '*';
const INSTALLMENT_COLUMNS = '*';
const EVENT_COLUMNS = '*';
const PARTNER_COLUMNS = 'id, tenant_id, name, phone1, phone2, customer_rank, supplier_rank, active';
const USER_COLUMNS = 'id, tenant_id, full_name, email, phone, role, is_active';
const BRANCH_COLUMNS = 'id, tenant_id, name, is_active';

export const OPEN_RECEIVABLE_STATUSES = ['open', 'partially_paid', 'draft'];
export const ACTIVE_INSTALLMENT_EXCLUDED_STATUSES = ['paid', 'cancelled'];

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function unique(values) {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

function byId(records) {
  return new Map((records ?? []).filter((record) => record?.id).map((record) => [record.id, record]));
}

function isDueInstallment(installment, currentDate = todayIsoDate()) {
  return (
    installment?.due_date &&
    installment.due_date <= currentDate &&
    !ACTIVE_INSTALLMENT_EXCLUDED_STATUSES.includes(String(installment.status ?? '').toLowerCase())
  );
}

function isOverdueInstallment(installment, currentDate = todayIsoDate()) {
  return (
    installment?.due_date &&
    installment.due_date < currentDate &&
    toNumber(installment.remaining_amount) > 0 &&
    !ACTIVE_INSTALLMENT_EXCLUDED_STATUSES.includes(String(installment.status ?? '').toLowerCase())
  );
}

function normalizePartner(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id ?? null,
    name: record.name ?? '',
    phone: record.phone1 ?? record.phone2 ?? '',
    active: record.active ?? true,
  };
}

function normalizeTenantUser(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id ?? null,
    name: record.full_name || record.email || record.phone || 'مستخدم',
    email: record.email ?? '',
    phone: record.phone ?? '',
    role: record.role ?? '',
    active: record.is_active ?? true,
  };
}

function normalizeBranch(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id ?? null,
    name: record.name || 'فرع',
    active: record.is_active ?? true,
  };
}

function normalizeInstallment(record) {
  if (!record) return null;

  return {
    ...record,
    amount: toNumber(record.amount),
    paid_amount: toNumber(record.paid_amount),
    remaining_amount: toNumber(record.remaining_amount),
  };
}

function normalizeEvent(record, usersById = new Map()) {
  if (!record) return null;

  return {
    ...record,
    createdByName: usersById.get(record.created_by)?.name ?? '',
  };
}

function normalizeReceivable(record, lookups = {}) {
  if (!record) return null;

  const installments = lookups.installmentsByReceivableId?.get(record.id) ?? [];
  const currentDate = todayIsoDate();
  const dueAmount = installments
    .filter((installment) => isDueInstallment(installment, currentDate))
    .reduce((sum, installment) => sum + toNumber(installment.remaining_amount), 0);
  const overdueAmount = installments
    .filter((installment) => isOverdueInstallment(installment, currentDate))
    .reduce((sum, installment) => sum + toNumber(installment.remaining_amount), 0);
  const partner = lookups.partnersById?.get(record.partner_id) ?? null;
  const assignee = lookups.usersById?.get(record.assigned_to) ?? null;
  const creator = lookups.usersById?.get(record.created_by) ?? null;
  const branch = lookups.branchesById?.get(record.branch_id) ?? null;

  return {
    ...record,
    partnerName: partner?.name ?? 'بدون عميل',
    assigneeName: assignee?.name ?? '',
    createdByName: creator?.name ?? '',
    branchName: branch?.name ?? '',
    total_amount: toNumber(record.total_amount),
    paid_amount: toNumber(record.paid_amount),
    remaining_amount: toNumber(record.remaining_amount),
    dueAmount,
    overdueAmount,
    installments,
    partner,
    assignee,
    branch,
  };
}

function groupInstallments(installments) {
  return (installments ?? []).reduce((map, installment) => {
    const receivableId = installment.receivable_id;
    if (!receivableId) return map;
    const current = map.get(receivableId) ?? [];
    current.push(installment);
    map.set(receivableId, current);
    return map;
  }, new Map());
}

function buildReceivablePayload(data) {
  const amount = toNumber(data.total_amount);

  return {
    tenant_id: data.tenantId,
    partner_id: data.partner_id || null,
    branch_id: data.branch_id || null,
    receivable_type: normalizeText(data.receivable_type) || 'customer',
    source_type: normalizeText(data.source_type) || 'manual',
    source_model: data.source_model || null,
    source_id: data.source_id || null,
    title: normalizeText(data.title) || 'مديونية يدوية',
    total_amount: amount,
    paid_amount: 0,
    remaining_amount: amount,
    assigned_to: data.assigned_to || null,
    priority: normalizeText(data.priority) || 'normal',
    status: normalizeText(data.status) || 'open',
    notes: normalizeText(data.notes) || null,
    created_by: data.createdBy || null,
    opened_at: new Date().toISOString(),
  };
}

function buildInstallmentPayload(data) {
  const amount = toNumber(data.amount);

  return {
    tenant_id: data.tenantId,
    receivable_id: data.receivableId,
    installment_no: Number(data.installment_no) || 1,
    due_date: data.due_date || null,
    amount,
    paid_amount: 0,
    remaining_amount: amount,
    status: normalizeText(data.status) || 'pending',
    notes: normalizeText(data.notes) || null,
  };
}

async function listByIds(client, table, columns, ids, tenantId) {
  const normalizedIds = unique(ids);
  if (!normalizedIds.length) return [];

  let query = client.from(table).select(columns).in('id', normalizedIds);
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

async function listPartners(client, tenantId) {
  if (!tenantId) return [];

  const { data, error } = await client
    .from('partners')
    .select(PARTNER_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(normalizePartner).filter(Boolean);
}

async function listTenantUsers(client, tenantId) {
  if (!tenantId) return [];

  const { data, error } = await client
    .from('tenant_users')
    .select(USER_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('full_name', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(normalizeTenantUser).filter(Boolean);
}

async function listBranches(client, tenantId) {
  if (!tenantId) return [];

  const { data, error } = await client
    .from('branches')
    .select(BRANCH_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true });

  if (error) throw error;
  return (data ?? []).map(normalizeBranch).filter(Boolean);
}

export const receivablesApi = {
  async loadWorkspace(tenantId) {
    if (!tenantId) {
      return { receivables: [], installments: [], eventsByReceivableId: new Map(), partners: [], users: [], branches: [] };
    }

    const client = requireSupabase();
    const [{ data: receivableRows, error: receivablesError }, partners, users, branches] = await Promise.all([
      client
        .from('receivables')
        .select(RECEIVABLE_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('opened_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false, nullsFirst: false }),
      listPartners(client, tenantId),
      listTenantUsers(client, tenantId),
      listBranches(client, tenantId),
    ]);

    if (receivablesError) throw receivablesError;

    const receivableIds = unique((receivableRows ?? []).map((row) => row.id));
    const [{ data: installmentRows, error: installmentsError }, { data: eventRows, error: eventsError }] = await Promise.all([
      receivableIds.length
        ? client
            .from('receivable_installments')
            .select(INSTALLMENT_COLUMNS)
            .eq('tenant_id', tenantId)
            .in('receivable_id', receivableIds)
            .order('due_date', { ascending: true, nullsFirst: false })
            .order('installment_no', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      receivableIds.length
        ? client
            .from('receivable_events')
            .select(EVENT_COLUMNS)
            .eq('tenant_id', tenantId)
            .in('receivable_id', receivableIds)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (installmentsError) throw installmentsError;
    if (eventsError) throw eventsError;

    const normalizedInstallments = (installmentRows ?? []).map(normalizeInstallment).filter(Boolean);
    const partnersById = byId(partners);
    const usersById = byId(users);
    const branchesById = byId(branches);
    const installmentsByReceivableId = groupInstallments(normalizedInstallments);
    const eventsByReceivableId = (eventRows ?? []).reduce((map, event) => {
      const receivableId = event.receivable_id;
      if (!receivableId) return map;
      const current = map.get(receivableId) ?? [];
      current.push(normalizeEvent(event, usersById));
      map.set(receivableId, current.filter(Boolean));
      return map;
    }, new Map());

    const receivables = (receivableRows ?? [])
      .map((record) => normalizeReceivable(record, { partnersById, usersById, branchesById, installmentsByReceivableId }))
      .filter(Boolean);

    return {
      receivables,
      installments: normalizedInstallments,
      eventsByReceivableId,
      partners,
      users,
      branches,
    };
  },

  async createManualReceivable(data) {
    if (!data?.tenantId) throw new Error('لا يمكن إنشاء مديونية بدون تحديد الشركة.');
    if (!data.partner_id) throw new Error('اختر العميل.');
    if (toNumber(data.total_amount) <= 0) throw new Error('إجمالي المديونية يجب أن يكون أكبر من صفر.');

    const result = await rpcCreateManualReceivable({
      tenant_id: data.tenantId,
      branch_id: data.branch_id || null,
      partner_id: data.partner_id,
      receivable_type: normalizeText(data.receivable_type) || 'customer',
      source_type: normalizeText(data.source_type) || 'manual',
      title: normalizeText(data.title) || 'مديونية يدوية',
      total_amount: toNumber(data.total_amount),
      priority: normalizeText(data.priority) || 'normal',
      assigned_to: data.assigned_to || null,
      created_by: data.createdBy || null,
      notes: normalizeText(data.notes) || null,
      has_payment_plan: false,
      installments: [],
      guarantors: [],
      start_date: null,
      plan_title: null,
    });

    if (!result.ok) throw new Error(result.error || 'تعذر إنشاء المديونية.');
    return result.data;
  },

  async addInstallment(data) {
    if (!data?.tenantId || !data?.receivableId) throw new Error('بيانات الاستحقاق غير مكتملة.');
    if (toNumber(data.amount) <= 0) throw new Error('مبلغ الاستحقاق يجب أن يكون أكبر من صفر.');

    const client = requireSupabase();
    const installmentPayload = buildInstallmentPayload(data);
    const { data: installment, error: installmentError } = await client
      .from('receivable_installments')
      .insert(installmentPayload)
      .select(INSTALLMENT_COLUMNS)
      .single();

    if (installmentError) throw installmentError;

    const { error: eventError } = await client.from('receivable_events').insert({
      tenant_id: data.tenantId,
      receivable_id: data.receivableId,
      event_type: 'installment_added',
      notes: data.notes ? `تمت إضافة استحقاق: ${data.notes}` : 'تمت إضافة استحقاق جديد',
      old_value: null,
      new_value: {
        installment_no: installmentPayload.installment_no,
        due_date: installmentPayload.due_date,
        amount: installmentPayload.amount,
      },
      created_by: data.createdBy || null,
    });

    if (eventError) throw eventError;
    return installment;
  },

  async loadSourceSale(tenantId, sourceId) {
    if (!tenantId || !sourceId) return null;

    const client = requireSupabase();
    const rows = await listByIds(client, 'showroom_sales', 'id, tenant_id, invoice_no, code, total_amount, created_at', [sourceId], tenantId);
    return rows[0] ?? null;
  },
};
