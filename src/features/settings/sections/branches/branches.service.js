import { requireSupabase } from '@/core/lib/supabase';

const BRANCH_COLUMNS = 'id, tenant_id, name, code, address, phone, is_active, created_at, updated_at';

function normalizeBranch(record) {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    name: record.name ?? '',
    code: record.code ?? '',
    address: record.address ?? '',
    phone: record.phone ?? '',
    isActive: record.is_active !== false,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function optionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function branchPayload(values) {
  const name = String(values.name ?? '').trim();
  if (!name) throw new Error('اسم الفرع مطلوب.');

  return {
    name,
    code: optionalText(values.code),
    address: optionalText(values.address),
    phone: optionalText(values.phone),
  };
}

function throwBranchError(error) {
  if (error?.code === '23505') {
    throw new Error('يوجد فرع بنفس الاسم داخل الشركة الحالية.');
  }
  throw error;
}

export const branchesService = {
  async list(tenantId) {
    if (!tenantId) return [];
    const { data, error } = await requireSupabase()
      .from('branches')
      .select(BRANCH_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('is_active', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw error;
    return (data ?? []).map(normalizeBranch);
  },

  async create(tenantId, values) {
    if (!tenantId) throw new Error('تعذر تحديد الشركة الحالية.');
    const { data, error } = await requireSupabase()
      .from('branches')
      .insert({ tenant_id: tenantId, ...branchPayload(values), is_active: true })
      .select(BRANCH_COLUMNS)
      .single();

    if (error) throwBranchError(error);
    return normalizeBranch(data);
  },

  async update(tenantId, branchId, values) {
    if (!tenantId || !branchId) throw new Error('بيانات الفرع غير مكتملة.');
    const { data, error } = await requireSupabase()
      .from('branches')
      .update({ ...branchPayload(values), updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', branchId)
      .select(BRANCH_COLUMNS)
      .single();

    if (error) throwBranchError(error);
    return normalizeBranch(data);
  },

  async setActive(tenantId, branchId, isActive) {
    if (!tenantId || !branchId) throw new Error('بيانات الفرع غير مكتملة.');
    const { data, error } = await requireSupabase()
      .from('branches')
      .update({ is_active: Boolean(isActive), updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', branchId)
      .select(BRANCH_COLUMNS)
      .single();

    if (error) throw error;
    return normalizeBranch(data);
  },
};
