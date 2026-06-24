import { requireSupabase } from '@/core/lib/supabase';

const TENANT_FILES_BUCKET = 'tenant-files';
const IDENTITY_DOCUMENTS_FOLDER = 'identity-documents';

function toNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function normalizePartner(record) {
  const customerRank = toNumber(record?.customer_rank, 0);
  const supplierRank = toNumber(record?.supplier_rank, 0);
  const isCustomer = customerRank > 0;
  const isSupplier = supplierRank > 0;
  const parentId = record?.parent_id ?? null;
  const isCompany = record?.is_company ?? false;
  const contactType = record?.contact_type ?? (parentId ? 'contact' : isCompany ? 'company' : 'person');

  return {
    id: record?.id,
    tenantId: record?.tenant_id ?? null,
    parentId,
    parentName: record?.parent_name ?? record?.parentName ?? '',
    contactType,
    functionTitle: record?.function_title ?? '',
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
    isCompany,
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

  if (Object.prototype.hasOwnProperty.call(data, 'parentId') || Object.prototype.hasOwnProperty.call(data, 'parent_id')) {
    payload.parent_id = data.parentId ?? data.parent_id ?? null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'contactType') || Object.prototype.hasOwnProperty.call(data, 'contact_type')) {
    payload.contact_type = (data.contactType ?? data.contact_type)?.trim() || null;
  }

  if (Object.prototype.hasOwnProperty.call(data, 'functionTitle') || Object.prototype.hasOwnProperty.call(data, 'function_title')) {
    payload.function_title = (data.functionTitle ?? data.function_title)?.trim() || null;
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

  const hasParentField = Object.prototype.hasOwnProperty.call(payload, 'parent_id');
  const hasIsCompanyField = Object.prototype.hasOwnProperty.call(payload, 'is_company');
  const hasParent = Boolean(payload.parent_id);

  if (payload.is_company === true) {
    payload.contact_type = 'company';
  } else if (hasParent) {
    payload.contact_type = 'contact';
    payload.is_company = false;
  } else if (hasIsCompanyField || hasParentField) {
    payload.contact_type = 'person';
  }

  return payload;
}

async function loadParentNamesMap(client, tenantId, partners) {
  const parentIds = Array.from(new Set(
    (Array.isArray(partners) ? partners : [])
      .map((partner) => partner?.parent_id)
      .filter(Boolean),
  ));

  if (!parentIds.length) {
    return new Map();
  }

  let query = client.from('partners').select('id, name').in('id', parentIds);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, partner) => {
    map.set(partner.id, partner.name || '');
    return map;
  }, new Map());
}

function groupPartnersByParent(partners) {
  return (Array.isArray(partners) ? partners : []).reduce((map, partner) => {
    const parentId = partner.parentId;
    if (!parentId) {
      return map;
    }

    const current = map.get(parentId) || [];
    current.push(partner);
    map.set(parentId, current);
    return map;
  }, new Map());
}

function getFileExtension(file) {
  const nameExtension = String(file?.name || '').split('.').pop();
  const safeExtension = String(nameExtension || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return safeExtension || 'jpg';
}

function createIdentityFilePath({ tenantId, side, file }) {
  const extension = getFileExtension(file);
  return `${tenantId}/${IDENTITY_DOCUMENTS_FOLDER}/${side}-${crypto.randomUUID()}.${extension}`;
}

function validateAttachmentFile(file) {
  if (!file) return;
  if (!file.type?.startsWith('image/')) {
    throw new Error('يمكن رفع صور فقط في صور البطاقة.');
  }
}

async function uploadPartnerIdentityAttachment(client, { tenantId, partnerId, file, side }) {
  if (!file) return null;

  validateAttachmentFile(file);

  const path = createIdentityFilePath({ tenantId, side, file });
  const { error: uploadError } = await client.storage.from(TENANT_FILES_BUCKET).upload(path, file, {
    cacheControl: '3600',
    contentType: file.type || 'image/jpeg',
    upsert: false,
  });

  if (uploadError) {
    throw new Error(uploadError.message || 'تعذر رفع صورة البطاقة.');
  }

  const { error: attachmentError } = await client.from('ir_attachments').insert({
    tenant_id: tenantId,
    file_path: path,
    related_model: 'partners',
    related_id: partnerId,
  });

  if (attachmentError) {
    await client.storage.from(TENANT_FILES_BUCKET).remove([path]);
    throw new Error(attachmentError.message || 'تم رفع الصورة لكن تعذر ربطها بالعميل.');
  }

  return path;
}

async function uploadPartnerIdentityAttachments(client, { tenantId, partnerId, identityCardFrontFile, identityCardBackFile }) {
  if (!tenantId || !partnerId) return;

  await Promise.all([
    uploadPartnerIdentityAttachment(client, {
      tenantId,
      partnerId,
      file: identityCardFrontFile,
      side: 'front',
    }),
    uploadPartnerIdentityAttachment(client, {
      tenantId,
      partnerId,
      file: identityCardBackFile,
      side: 'back',
    }),
  ]);
}

export const partnersService = {
  async getPartnerById({ tenantId, id } = {}) {
    if (!id) {
      return null;
    }

    const client = requireSupabase();
    let query = client.from('partners').select('*').eq('id', id);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(error.message || 'تعذر تحميل جهة الاتصال.');
    }

    if (!data) {
      return null;
    }

    const parentNamesMap = await loadParentNamesMap(client, tenantId, [data]);

    return normalizePartner({
      ...data,
      parent_name: parentNamesMap.get(data.parent_id) || '',
    });
  },

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
    } else {
      query = query.is('parent_id', null);
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

    const rows = data ?? [];
    const parentNamesMap = await loadParentNamesMap(client, tenantId, rows);

    return rows.map((record) => normalizePartner({
      ...record,
      parent_name: parentNamesMap.get(record.parent_id) || '',
    }));
  },

  async getChildContacts({ tenantId, parentIds = [], status = 'active' } = {}) {
    const ids = Array.from(new Set((Array.isArray(parentIds) ? parentIds : [parentIds]).filter(Boolean)));

    if (!ids.length) {
      return new Map();
    }

    const client = requireSupabase();
    let query = client
      .from('partners')
      .select('*')
      .in('parent_id', ids)
      .order('created_at', { ascending: false });

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    if (status === 'active') {
      query = query.eq('active', true);
    }

    if (status === 'archived') {
      query = query.eq('active', false);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(error.message || 'تعذر تحميل جهات الاتصال التابعة.');
    }

    const parentNamesMap = await loadParentNamesMap(client, tenantId, data || []);
    const children = (data || []).map((record) => normalizePartner({
      ...record,
      parent_name: parentNamesMap.get(record.parent_id) || '',
    }));

    return groupPartnersByParent(children);
  },

  async getPaperworkProcessorOptions({ tenantId } = {}) {
    const client = requireSupabase();
    let suppliersQuery = client
      .from('partners')
      .select('id, name, phone1, phone2')
      .gt('supplier_rank', 0)
      .is('parent_id', null)
      .eq('active', true)
      .order('created_at', { ascending: false });

    if (tenantId) {
      suppliersQuery = suppliersQuery.eq('tenant_id', tenantId);
    }

    const { data: suppliers = [], error: suppliersError } = await suppliersQuery;

    if (suppliersError) {
      throw new Error(suppliersError.message || 'تعذر تحميل جهات إصدار الأوراق.');
    }

    const supplierIds = suppliers.map((supplier) => supplier.id).filter(Boolean);
    let children = [];

    if (supplierIds.length) {
      let childrenQuery = client
        .from('partners')
        .select('id, parent_id, name, phone1, phone2, function_title')
        .in('parent_id', supplierIds)
        .eq('active', true)
        .order('created_at', { ascending: false });

      if (tenantId) {
        childrenQuery = childrenQuery.eq('tenant_id', tenantId);
      }

      const { data, error: childrenError } = await childrenQuery;

      if (childrenError) {
        throw new Error(childrenError.message || 'تعذر تحميل الجهات التابعة.');
      }

      children = data || [];
    }

    const childrenByParent = children.reduce((map, child) => {
      const current = map.get(child.parent_id) || [];
      current.push(child);
      map.set(child.parent_id, current);
      return map;
    }, new Map());

    return suppliers.flatMap((supplier) => [
      {
        id: supplier.id,
        name: supplier.name || 'مورد بدون اسم',
        phone: supplier.phone1 || supplier.phone2 || '',
        subtitle: 'المورد الرئيسي',
        parentName: '',
      },
      ...(childrenByParent.get(supplier.id) || []).map((child) => ({
        id: child.id,
        name: child.name || 'جهة تابعة بدون اسم',
        phone: child.phone1 || child.phone2 || '',
        subtitle: child.function_title || 'جهة اتصال تابعة',
        parentName: supplier.name || '',
      })),
    ]);
  },

  async createPartner(payload) {
    const client = requireSupabase();
    const { identityCardFrontFile, identityCardBackFile, ...partnerPayload } = payload || {};
    const body = buildPartnerPayload({ active: true, ...partnerPayload });

    const { data, error } = await client.from('partners').insert(body).select('*').single();

    if (error) {
      throw new Error(error.message || 'تعذر إنشاء جهة الاتصال.');
    }

    await uploadPartnerIdentityAttachments(client, {
      tenantId: data.tenant_id,
      partnerId: data.id,
      identityCardFrontFile,
      identityCardBackFile,
    });

    return normalizePartner(data);
  },

  async updatePartner({ id, tenantId, ...payload }) {
    if (!id) {
      throw new Error('معرف جهة الاتصال مطلوب للتعديل.');
    }

    const client = requireSupabase();
    const { identityCardFrontFile, identityCardBackFile, ...partnerPayload } = payload || {};
    const body = buildPartnerPayload(partnerPayload);

    let query = client.from('partners').update(body).eq('id', id);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.select('*').single();

    if (error) {
      throw new Error(error.message || 'تعذر تعديل جهة الاتصال.');
    }

    await uploadPartnerIdentityAttachments(client, {
      tenantId: data.tenant_id || tenantId,
      partnerId: data.id,
      identityCardFrontFile,
      identityCardBackFile,
    });

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
