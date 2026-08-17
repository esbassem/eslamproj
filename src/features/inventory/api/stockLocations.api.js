import { requireSupabase } from '@/core/lib/supabase';

const LOCATION_COLUMNS = `
  id, tenant_id, branch_id, name, code, location_type, is_active, created_at, updated_at,
  branch:branches!stock_locations_branch_tenant_fkey(id, name)
`;

export const STOCK_LOCATION_TYPES = [
  { value: 'internal', label: 'مخزن داخلي' },
  { value: 'showroom', label: 'صالة عرض' },
  { value: 'returns', label: 'مرتجعات' },
  { value: 'damaged', label: 'تالف' },
  { value: 'transit', label: 'قيد النقل' },
];

function normalizeLocation(record) {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    branchId: record.branch_id,
    branchName: record.branch?.name ?? '',
    name: record.name ?? '',
    code: record.code ?? '',
    locationType: record.location_type ?? 'internal',
    isActive: record.is_active !== false,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function locationPayload(values) {
  const name = String(values.name ?? '').trim();
  const code = String(values.code ?? '').trim().toUpperCase();
  const branchId = values.branchId ?? values.branch_id ?? null;
  const locationType = values.locationType ?? values.location_type ?? 'internal';

  if (!name) throw new Error('اسم الموقع مطلوب.');
  if (!code) throw new Error('كود الموقع مطلوب.');
  if (!branchId) throw new Error('اختر الفرع.');
  if (!STOCK_LOCATION_TYPES.some((item) => item.value === locationType)) {
    throw new Error('نوع الموقع غير صحيح.');
  }

  return { branch_id: branchId, name, code, location_type: locationType };
}

function throwLocationError(error) {
  if (error?.code === '23505') {
    throw new Error('يوجد موقع بنفس الاسم أو الكود داخل الفرع المحدد.');
  }
  if (error?.code === '23503') {
    throw new Error('الفرع المحدد لا يتبع الشركة الحالية.');
  }
  throw error;
}

export const stockLocationsService = {
  async list(tenantId) {
    if (!tenantId) return [];
    const { data, error } = await requireSupabase()
      .from('stock_locations')
      .select(LOCATION_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('is_active', { ascending: false })
      .order('name', { ascending: true });

    if (error) throw error;
    return (data ?? []).map(normalizeLocation);
  },

  async listBranches(tenantId) {
    if (!tenantId) return [];
    const { data, error } = await requireSupabase()
      .from('branches')
      .select('id, name, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) throw error;
    return data ?? [];
  },

  async create(tenantId, values) {
    if (!tenantId) throw new Error('تعذر تحديد الشركة الحالية.');
    const { data, error } = await requireSupabase()
      .from('stock_locations')
      .insert({ tenant_id: tenantId, ...locationPayload(values), is_active: true })
      .select(LOCATION_COLUMNS)
      .single();

    if (error) throwLocationError(error);
    return normalizeLocation(data);
  },

  async update(tenantId, locationId, values) {
    if (!tenantId || !locationId) throw new Error('بيانات الموقع غير مكتملة.');
    const { data, error } = await requireSupabase()
      .from('stock_locations')
      .update(locationPayload(values))
      .eq('tenant_id', tenantId)
      .eq('id', locationId)
      .select(LOCATION_COLUMNS)
      .single();

    if (error) throwLocationError(error);
    return normalizeLocation(data);
  },

  async setActive(tenantId, locationId, isActive) {
    if (!tenantId || !locationId) throw new Error('بيانات الموقع غير مكتملة.');
    const { data, error } = await requireSupabase()
      .from('stock_locations')
      .update({ is_active: Boolean(isActive) })
      .eq('tenant_id', tenantId)
      .eq('id', locationId)
      .select(LOCATION_COLUMNS)
      .single();

    if (error) throwLocationError(error);
    return normalizeLocation(data);
  },
};
