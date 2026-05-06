import { requireSupabase } from '@/core/lib/supabase';

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizePartner(record) {
  const customerRank = toNumber(record?.customer_rank, 0);
  const supplierRank = toNumber(record?.supplier_rank, 0);
  const isCustomer = customerRank > 0;
  const isSupplier = supplierRank > 0;

  return {
    id: record?.id,
    tenantId: record?.tenant_id ?? null,
    name: record?.name ?? '',
    nickname: record?.nickname ?? '',
    phone: record?.phone1 ?? '',
    phone1: record?.phone1 ?? '',
    phone2: record?.phone2 ?? '',
    address: record?.address ?? '',
    nationalId: record?.national_id ?? '',
    job: record?.job ?? '',
    jobAddress: record?.job_address ?? '',
    notes: record?.notes ?? '',
    companyType: record?.company_type ?? '',
    isCompany: record?.is_company ?? false,
    customerRank,
    supplierRank,
    financerRank: toNumber(record?.financer_rank, 0),
    isCustomer,
    isSupplier,
    balance: 0,
    isActive: record?.active ?? true,
    active: record?.active ?? true,
    receivableAccountId: record?.property_account_receivable_id ?? null,
    payableAccountId: record?.property_account_payable_id ?? null,
    createdAt: record?.created_at ?? null,
    updatedAt: record?.updated_at ?? null,
  };
}

function applyTypeFilter(query, filterType) {
  if (filterType === 'customer') {
    return query.gt('customer_rank', 0);
  }

  if (filterType === 'supplier') {
    return query.gt('supplier_rank', 0);
  }

  return query;
}

function escapeSearchTerm(value) {
  return value.replaceAll('%', '\\%').replaceAll('_', '\\_').replaceAll(',', ' ');
}

function buildPartnerPayload(data) {
  const payload = {};

  if (Object.prototype.hasOwnProperty.call(data, 'tenantId') || Object.prototype.hasOwnProperty.call(data, 'tenant_id')) {
    payload.tenant_id = data.tenantId ?? data.tenant_id;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'name')) {
    payload.name = data.name?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'nickname')) {
    payload.nickname = data.nickname?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'phone') || Object.prototype.hasOwnProperty.call(data, 'phone1')) {
    payload.phone1 = (data.phone ?? data.phone1)?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'phone2')) {
    payload.phone2 = data.phone2?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'address')) {
    payload.address = data.address?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'nationalId') || Object.prototype.hasOwnProperty.call(data, 'national_id')) {
    payload.national_id = (data.nationalId ?? data.national_id)?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'job')) {
    payload.job = data.job?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'jobAddress') || Object.prototype.hasOwnProperty.call(data, 'job_address')) {
    payload.job_address = (data.jobAddress ?? data.job_address)?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'notes')) {
    payload.notes = data.notes?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'companyType') || Object.prototype.hasOwnProperty.call(data, 'company_type')) {
    payload.company_type = (data.companyType ?? data.company_type)?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'isCompany') || Object.prototype.hasOwnProperty.call(data, 'is_company')) {
    payload.is_company = data.isCompany ?? data.is_company;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'isActive') || Object.prototype.hasOwnProperty.call(data, 'active')) {
    payload.active = data.isActive ?? data.active;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'customerRank') || Object.prototype.hasOwnProperty.call(data, 'customer_rank')) {
    payload.customer_rank = toNumber(data.customerRank ?? data.customer_rank, 0);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'supplierRank') || Object.prototype.hasOwnProperty.call(data, 'supplier_rank')) {
    payload.supplier_rank = toNumber(data.supplierRank ?? data.supplier_rank, 0);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'financerRank') || Object.prototype.hasOwnProperty.call(data, 'financer_rank')) {
    payload.financer_rank = toNumber(data.financerRank ?? data.financer_rank, 0);
  }

  if (Object.prototype.hasOwnProperty.call(data, 'isCustomer')) {
    payload.customer_rank = data.isCustomer ? Math.max(payload.customer_rank ?? 0, 1) : 0;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'isSupplier')) {
    payload.supplier_rank = data.isSupplier ? Math.max(payload.supplier_rank ?? 0, 1) : 0;
  }

  if (
    Object.prototype.hasOwnProperty.call(data, 'receivableAccountId') ||
    Object.prototype.hasOwnProperty.call(data, 'property_account_receivable_id')
  ) {
    payload.property_account_receivable_id = data.receivableAccountId ?? data.property_account_receivable_id ?? null;
  }

  if (
    Object.prototype.hasOwnProperty.call(data, 'payableAccountId') ||
    Object.prototype.hasOwnProperty.call(data, 'property_account_payable_id')
  ) {
    payload.property_account_payable_id = data.payableAccountId ?? data.property_account_payable_id ?? null;
  }

  return payload;
}

export const partnersService = {
  async getPartners({ tenantId, filterType = 'all', search = '', status = 'all' } = {}) {
    const client = requireSupabase();

    let query = client.from('partners').select('*').order('created_at', { ascending: false });

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    query = applyTypeFilter(query, filterType);

    const normalizedSearch = escapeSearchTerm(search.trim());
    if (normalizedSearch) {
      query = query.or(`name.ilike.%${normalizedSearch}%,nickname.ilike.%${normalizedSearch}%,phone1.ilike.%${normalizedSearch}%,phone2.ilike.%${normalizedSearch}%`);
    }

    if (status === 'active') {
      query = query.eq('active', true);
    }

    if (status === 'archived') {
      query = query.eq('active', false);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message || 'تعذر تحميل جهات الاتصال.');
    }

    return (data ?? []).map(normalizePartner);
  },

  async createPartner(payload) {
    const client = requireSupabase();
    const body = buildPartnerPayload({ active: true, ...payload });

    const { data, error } = await client.from('partners').insert(body).select('*').single();

    if (error) {
      throw new Error(error.message || 'تعذر إنشاء جهة الاتصال.');
    }

    return normalizePartner(data);
  },

  async updatePartner({ id, tenantId, ...payload }) {
    if (!id) {
      throw new Error('معرف جهة الاتصال مطلوب للتعديل.');
    }

    const client = requireSupabase();
    const body = buildPartnerPayload(payload);

    let query = client.from('partners').update(body).eq('id', id);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.select('*').single();

    if (error) {
      throw new Error(error.message || 'تعذر تعديل جهة الاتصال.');
    }

    return normalizePartner(data);
  },

  async archivePartner({ id, tenantId }) {
    if (!id) {
      throw new Error('معرف جهة الاتصال مطلوب للأرشفة.');
    }

    const client = requireSupabase();

    let query = client.from('partners').update({ active: false }).eq('id', id);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.select('*').single();

    if (error) {
      throw new Error(error.message || 'تعذر أرشفة جهة الاتصال.');
    }

    return normalizePartner(data);
  },
};
