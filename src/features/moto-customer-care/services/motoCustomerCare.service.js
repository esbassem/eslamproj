import { requireSupabase } from '@/core/lib/supabase';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';

const TENANT_FILES_BUCKET = 'tenant-files';
const SIGNED_URL_EXPIRES_IN = 60 * 60;
const SALE_COLUMNS = `
  id,
  tenant_id,
  branch_id,
  customer_id,
  sale_date,
  status,
  total_amount,
  paid_amount,
  remaining_amount,
  notes,
  account_move_id,
  created_by,
  created_at,
  updated_at,
  showroom_config_id
`;

const PARTNER_COLUMNS = 'id, name, phone1, phone2, address, national_id';
const SALE_LINE_COLUMNS = `
  id,
  sale_id,
  product_product_id,
  tracking_unit_id,
  description,
  quantity,
  unit_price,
  total,
  ownership_name,
  created_at
`;
const SALE_PAYMENT_COLUMNS = `
  id,
  tenant_id,
  sale_id,
  amount,
  payment_date,
  payment_method,
  notes,
  created_by,
  created_at
`;
const PAPERWORK_REQUEST_COLUMNS = `
  id,
  tenant_id,
  branch_id,
  request_source,
  request_type,
  sale_id,
  sale_line_id,
  tracking_unit_id,
  customer_id,
  document_owner_partner_id,
  processor_partner_id,
  current_stage_id,
  stage_entered_at,
  assigned_to,
  status,
  priority,
  blocked_reason,
  deferred_reason,
  cancel_reason,
  notes,
  created_by,
  created_at,
  updated_at,
  closed_at
`;
const PAPERWORK_DOCUMENT_COLUMNS = `
  id,
  tenant_id,
  branch_id,
  document_type,
  document_title,
  tracking_unit_id,
  paperwork_request_id,
  owner_partner_id,
  manual_item_description,
  source_type,
  status,
  notes,
  created_by,
  created_at,
  updated_at
`;
const PAPERWORK_DOCUMENT_MOVE_COLUMNS = `
  id,
  tenant_id,
  document_id,
  move_direction,
  source_type,
  from_user_id,
  from_partner_id,
  from_location,
  to_user_id,
  to_partner_id,
  to_location,
  moved_at,
  notes,
  created_by,
  created_at
`;
const PAPERWORK_REQUEST_EVENT_COLUMNS = `
  id,
  tenant_id,
  request_id,
  event_type,
  new_status,
  new_stage_id,
  notes,
  created_by,
  created_at
`;
const TENANT_USER_COLUMNS = 'id, full_name, email';
const PAPERWORK_OUT_SOURCE_TYPES = new Set(['to_customer', 'to_supplier', 'to_processor', 'to_employee', 'lost', 'cancelled', 'other']);

function requireTenantId(tenantId) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة.');
  }
}

function requireSaleId(saleId) {
  if (!saleId) {
    throw new Error('تعذر تحديد عملية البيع المطلوبة.');
  }
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getFileExtension(file) {
  const nameExtension = String(file?.name || '').split('.').pop();
  const mimeExtension = String(file?.type || '').split('/').pop();
  return (nameExtension && nameExtension !== file?.name ? nameExtension : mimeExtension || 'jpg')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase() || 'jpg';
}

function assertPaperworkImage(file) {
  if (!file) return;
  const looksLikeImage = file.type?.startsWith('image/')
    || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(String(file.name || ''));
  if (!looksLikeImage) {
    throw new Error('يمكن رفع صورة فقط للجواب.');
  }
}

function isStorageImage(file) {
  const mimeType = file?.metadata?.mimetype || file?.metadata?.mimeType || '';
  const name = String(file?.name || '').toLowerCase();
  return mimeType.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(name);
}

function normalizeStoragePath(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/^tenant-files\//, '');
}

async function listTenantStorageImages(client, tenantId, prefix = tenantId, images = [], depth = 0, limit = 120) {
  if (images.length >= limit || depth > 5) {
    return images;
  }

  const { data, error } = await client.storage.from(TENANT_FILES_BUCKET).list(prefix, {
    limit: 1000,
    offset: 0,
    sortBy: { column: 'created_at', order: 'desc' },
  });

  if (error) {
    throw error;
  }

  const rows = data || [];

  for (const row of rows) {
    if (!row?.name || row.name.startsWith('.') || images.length >= limit) {
      continue;
    }

    const path = `${prefix}/${row.name}`;

    if (isStorageImage(row)) {
      images.push({
        id: path,
        bucket: TENANT_FILES_BUCKET,
        path,
        documentType: '',
        name: row.name,
        mimeType: row.metadata?.mimetype || row.metadata?.mimeType || '',
        size: Number(row.metadata?.size || 0) || null,
        createdAt: row.created_at || row.updated_at || null,
        signedUrl: '',
      });
      continue;
    }

    const maybeFolder = !/\.[a-z0-9]{2,8}$/i.test(row.name);
    if (maybeFolder) {
      await listTenantStorageImages(client, tenantId, path, images, depth + 1, limit);
    }
  }

  return images;
}

function normalizeCustomer(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    name: record.name || 'عميل غير محدد',
    phone: record.phone1 || record.phone2 || '',
    phone1: record.phone1 || '',
    phone2: record.phone2 || '',
    address: record.address || '',
    nationalId: record.national_id || '',
  };
}

function mergeAttributes(...groups) {
  const seen = new Set();

  return groups
    .flat()
    .filter(Boolean)
    .filter((attribute) => {
      const key = `${attribute.label}:${attribute.value}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function mergeTrackingIdentifiers(expectedIdentifiers = [], actualIdentifiers = []) {
  const actualByTypeId = new Map(
    (Array.isArray(actualIdentifiers) ? actualIdentifiers : [])
      .filter((identifier) => identifier?.identifierTypeId)
      .map((identifier) => [identifier.identifierTypeId, identifier]),
  );

  const expected = (Array.isArray(expectedIdentifiers) ? expectedIdentifiers : []).map((definition) => {
    const actual = actualByTypeId.get(definition.identifierTypeId);
    const value = actual?.value || '';

    return {
      ...definition,
      id: actual?.id || definition.identifierTypeId,
      value,
      isNotAvailable: Boolean(actual?.isNotAvailable),
      isMissing: Boolean(definition.isRequired && !value && !(definition.allowNotAvailable && actual?.isNotAvailable)),
    };
  });

  const unexpectedActual = (Array.isArray(actualIdentifiers) ? actualIdentifiers : [])
    .filter((identifier) => !identifier?.identifierTypeId || !expected.some((definition) => definition.identifierTypeId === identifier.identifierTypeId));

  return [...expected, ...unexpectedActual];
}

function normalizeSaleLine(record, productMap = new Map(), attributesMap = new Map(), variantAttributesMap = new Map(), trackingDetailsMap = new Map(), trackingUnitAttributesMap = new Map()) {
  const product = productMap.get(record.product_product_id);
  const name = record.description || product?.displayName || product?.sku || 'منتج غير محدد';
  const trackingDetails = trackingDetailsMap.get(record.tracking_unit_id) || {};
  const configuredAttributes = mergeAttributes(
    variantAttributesMap.get(record.product_product_id) || [],
    attributesMap.get(record.id) || [],
  );

  return {
    id: record.id,
    saleId: record.sale_id,
    productProductId: record.product_product_id,
    productTemplateId: product?.productTemplateId || null,
    categoryId: product?.categoryId || null,
    trackingUnitId: record.tracking_unit_id,
    tracking: product?.tracking || 'none',
    name,
    displayName: product?.displayName || '',
    description: record.description || product?.displayName || '',
    sku: product?.sku || '',
    barcode: product?.barcode || '',
    quantity: toNumber(record.quantity) || 1,
    unitPrice: toNumber(record.unit_price),
    total: toNumber(record.total),
    ownershipName: record.ownership_name || '',
    configuredAttributes,
    trackingUnitAttributes: trackingUnitAttributesMap.get(record.tracking_unit_id) || [],
    trackingUnit: trackingDetails.trackingUnit || null,
    expectedTrackingIdentifiers: product?.expectedTrackingIdentifiers || [],
    trackingIdentifiers: mergeTrackingIdentifiers(product?.expectedTrackingIdentifiers || [], trackingDetails.trackingIdentifiers || []),
    license: trackingDetails.license || null,
    attachments: trackingDetails.attachments || {},
  };
}

async function loadTrackingUnitAttributesMap(client, tenantId, lines) {
  const trackingUnitIds = Array.from(new Set(
    (Array.isArray(lines) ? lines : [])
      .map((line) => line?.tracking_unit_id)
      .filter(Boolean),
  ));

  if (!trackingUnitIds.length) {
    return new Map();
  }

  const { data: rows, error } = await client
    .from('stock_tracking_unit_attributes')
    .select('id, tracking_unit_id, attribute_id, attribute_value_id, value_text')
    .eq('tenant_id', tenantId)
    .in('tracking_unit_id', trackingUnitIds);

  if (error) {
    throw error;
  }

  const unitAttributeRows = rows || [];
  const attributeIds = Array.from(new Set(unitAttributeRows.map((row) => row.attribute_id).filter(Boolean)));
  const valueIds = Array.from(new Set(unitAttributeRows.map((row) => row.attribute_value_id).filter(Boolean)));

  const [{ data: attributes, error: attributesError }, { data: values, error: valuesError }] = await Promise.all([
    attributeIds.length
      ? client.from('product_attributes').select('id, name').eq('tenant_id', tenantId).in('id', attributeIds)
      : Promise.resolve({ data: [], error: null }),
    valueIds.length
      ? client.from('product_attribute_values').select('id, name').eq('tenant_id', tenantId).in('id', valueIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (attributesError) {
    throw attributesError;
  }

  if (valuesError) {
    throw valuesError;
  }

  const attributesById = new Map((attributes || []).map((attribute) => [attribute.id, attribute]));
  const valuesById = new Map((values || []).map((value) => [value.id, value]));

  return unitAttributeRows.reduce((map, row) => {
    const value = row.attribute_value_id ? valuesById.get(row.attribute_value_id)?.name : row.value_text;
    if (!value) return map;

    const current = map.get(row.tracking_unit_id) || [];
    const attribute = attributesById.get(row.attribute_id);
    current.push({
      id: row.id,
      label: attribute?.name || 'خاصية',
      value,
    });
    map.set(row.tracking_unit_id, current);
    return map;
  }, new Map());
}

async function loadProductsMap(client, tenantId, lines) {
  const productIds = Array.from(new Set(
    (Array.isArray(lines) ? lines : [])
      .map((line) => line?.product_product_id)
      .filter(Boolean),
  ));

  if (!productIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('product_products')
    .select('id, product_template_id, display_name, sku, barcode, tracking')
    .eq('tenant_id', tenantId)
    .in('id', productIds);

  if (error) {
    throw error;
  }

  const products = data || [];
  const templateIds = Array.from(new Set(products.map((product) => product.product_template_id).filter(Boolean)));
  const { data: templates, error: templatesError } = templateIds.length
    ? await client
      .from('product_templates')
      .select('id, category_id, tracking')
      .eq('tenant_id', tenantId)
      .in('id', templateIds)
    : { data: [], error: null };

  if (templatesError) {
    throw templatesError;
  }

  const templatesById = new Map((templates || []).map((template) => [template.id, template]));
  const categoryIds = Array.from(new Set((templates || []).map((template) => template.category_id).filter(Boolean)));
  const expectedTrackingIdentifiersByCategoryId = await loadExpectedTrackingIdentifiersByCategoryId(client, tenantId, categoryIds);

  return products.reduce((map, product) => {
    const template = templatesById.get(product.product_template_id) || null;
    map.set(product.id, {
      id: product.id,
      productTemplateId: product.product_template_id || null,
      categoryId: template?.category_id || null,
      displayName: product.display_name || '',
      sku: product.sku || '',
      barcode: product.barcode || '',
      tracking: product.tracking || template?.tracking || 'none',
      expectedTrackingIdentifiers: expectedTrackingIdentifiersByCategoryId.get(template?.category_id) || [],
    });
    return map;
  }, new Map());
}

async function loadExpectedTrackingIdentifiersByCategoryId(client, tenantId, categoryIds) {
  const ids = Array.from(new Set((categoryIds || []).filter(Boolean)));

  if (!ids.length) {
    return new Map();
  }

  const { data: links, error } = await client
    .from('product_category_tracking_identifiers')
    .select('id, category_id, identifier_type_id, is_required, allow_not_available, sequence, created_at')
    .eq('tenant_id', tenantId)
    .in('category_id', ids)
    .order('sequence', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  const linkRows = links || [];
  const identifierTypeIds = Array.from(new Set(linkRows.map((link) => link.identifier_type_id).filter(Boolean)));
  const { data: types, error: typesError } = identifierTypeIds.length
    ? await client
      .from('product_tracking_identifier_types')
      .select('id, name, code, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('id', identifierTypeIds)
    : { data: [], error: null };

  if (typesError) {
    throw typesError;
  }

  const typesById = new Map((types || []).map((type) => [type.id, type]));

  return linkRows.reduce((map, link) => {
    const type = typesById.get(link.identifier_type_id);
    if (!type) {
      return map;
    }

    const current = map.get(link.category_id) || [];
    current.push({
      identifierTypeId: link.identifier_type_id,
      label: type.name || 'رقم تتبع',
      code: type.code || '',
      isRequired: link.is_required ?? false,
      allowNotAvailable: link.allow_not_available ?? false,
      sequence: Number(link.sequence) || 0,
      value: '',
    });
    map.set(link.category_id, current);
    return map;
  }, new Map());
}

async function loadLineAttributesMap(client, tenantId, lines) {
  const lineIds = Array.from(new Set(
    (Array.isArray(lines) ? lines : [])
      .map((line) => line?.id)
      .filter(Boolean),
  ));

  if (!lineIds.length) {
    return new Map();
  }

  const { data: rows, error } = await client
    .from('transaction_line_attributes')
    .select('id, transaction_line_id, attribute_id, attribute_value_id, value_text')
    .eq('tenant_id', tenantId)
    .in('transaction_line_id', lineIds);

  if (error) {
    throw error;
  }

  const attributeRows = rows || [];
  const attributeIds = Array.from(new Set(attributeRows.map((row) => row.attribute_id).filter(Boolean)));
  const valueIds = Array.from(new Set(attributeRows.map((row) => row.attribute_value_id).filter(Boolean)));

  const [{ data: attributes, error: attributesError }, { data: values, error: valuesError }] = await Promise.all([
    attributeIds.length
      ? client.from('product_attributes').select('id, name').eq('tenant_id', tenantId).in('id', attributeIds)
      : Promise.resolve({ data: [], error: null }),
    valueIds.length
      ? client.from('product_attribute_values').select('id, name').eq('tenant_id', tenantId).in('id', valueIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (attributesError) {
    throw attributesError;
  }

  if (valuesError) {
    throw valuesError;
  }

  const attributesById = new Map((attributes || []).map((attribute) => [attribute.id, attribute]));
  const valuesById = new Map((values || []).map((value) => [value.id, value]));

  return attributeRows.reduce((map, row) => {
    const current = map.get(row.transaction_line_id) || [];
    const attribute = attributesById.get(row.attribute_id);
    const value = row.attribute_value_id ? valuesById.get(row.attribute_value_id) : null;
    const nextValue = value?.name || row.value_text || '';

    if (nextValue) {
      current.push({
        id: row.id,
        label: attribute?.name || 'خاصية',
        value: nextValue,
      });
      map.set(row.transaction_line_id, current);
    }

    return map;
  }, new Map());
}

async function loadVariantAttributesMap(client, tenantId, lines) {
  const productIds = Array.from(new Set(
    (Array.isArray(lines) ? lines : [])
      .map((line) => line?.product_product_id)
      .filter(Boolean),
  ));

  if (!productIds.length) {
    return new Map();
  }

  const { data: rows, error } = await client
    .from('product_product_attribute_values')
    .select('product_product_id, attribute_id, attribute_value_id')
    .eq('tenant_id', tenantId)
    .in('product_product_id', productIds);

  if (error) {
    throw error;
  }

  const variantRows = rows || [];
  const attributeIds = Array.from(new Set(variantRows.map((row) => row.attribute_id).filter(Boolean)));
  const valueIds = Array.from(new Set(variantRows.map((row) => row.attribute_value_id).filter(Boolean)));

  if (!attributeIds.length && !valueIds.length) {
    return new Map();
  }

  const [{ data: attributes, error: attributesError }, { data: values, error: valuesError }] = await Promise.all([
    attributeIds.length
      ? client.from('product_attributes').select('id, name').eq('tenant_id', tenantId).in('id', attributeIds)
      : Promise.resolve({ data: [], error: null }),
    valueIds.length
      ? client.from('product_attribute_values').select('id, name').eq('tenant_id', tenantId).in('id', valueIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (attributesError) {
    throw attributesError;
  }

  if (valuesError) {
    throw valuesError;
  }

  const attributesById = new Map((attributes || []).map((attribute) => [attribute.id, attribute]));
  const valuesById = new Map((values || []).map((value) => [value.id, value]));

  return variantRows.reduce((map, row) => {
    const value = valuesById.get(row.attribute_value_id);
    if (!value?.name) {
      return map;
    }

    const current = map.get(row.product_product_id) || [];
    const attribute = attributesById.get(row.attribute_id);

    current.push({
      label: attribute?.name || 'خاصية',
      value: value.name,
    });
    map.set(row.product_product_id, current);
    return map;
  }, new Map());
}

async function loadTrackingDetailsMap(client, tenantId, lines) {
  const trackingUnitIds = Array.from(new Set(
    (Array.isArray(lines) ? lines : [])
      .map((line) => line?.tracking_unit_id)
      .filter(Boolean),
  ));

  if (!trackingUnitIds.length) {
    return new Map();
  }

  const [
    { data: units, error: unitsError },
    { data: identifierRows, error: identifiersError },
    { data: licenseRows, error: licensesError },
    { data: attachmentRows, error: attachmentsError },
  ] = await Promise.all([
    client
      .from('stock_tracking_units')
      .select('id, tracking_number, status')
      .eq('tenant_id', tenantId)
      .in('id', trackingUnitIds),
    client
      .from('stock_tracking_unit_identifiers')
      .select('id, tracking_unit_id, identifier_type_id, value, is_not_available')
      .eq('tenant_id', tenantId)
      .in('tracking_unit_id', trackingUnitIds),
    client
      .from('stock_tracking_unit_licenses')
      .select('id, tracking_unit_id, license_status, license_number, license_issued_at, license_expires_at, issuing_authority, notes, is_current, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .eq('is_current', true)
      .in('tracking_unit_id', trackingUnitIds),
    client
      .from('ir_attachments')
      .select('id, related_id, document_type, bucket_name, file_path, original_file_name, mime_type, created_at')
      .eq('tenant_id', tenantId)
      .eq('related_model', 'stock_tracking_units')
      .in('related_id', trackingUnitIds)
      .in('document_type', ['chassis_photo', 'engine_photo'])
      .eq('is_active', true),
  ]);

  if (unitsError) {
    throw unitsError;
  }

  if (identifiersError) {
    throw identifiersError;
  }

  if (licensesError) {
    throw licensesError;
  }

  if (attachmentsError) {
    throw attachmentsError;
  }

  const identifierTypeIds = Array.from(new Set((identifierRows || []).map((row) => row.identifier_type_id).filter(Boolean)));
  const { data: identifierTypes, error: typesError } = identifierTypeIds.length
    ? await client
      .from('product_tracking_identifier_types')
      .select('id, name, code')
      .eq('tenant_id', tenantId)
      .in('id', identifierTypeIds)
    : { data: [], error: null };

  if (typesError) {
    throw typesError;
  }

  const detailsMap = new Map();
  const typesById = new Map((identifierTypes || []).map((type) => [type.id, type]));

  (units || []).forEach((unit) => {
    detailsMap.set(unit.id, {
      trackingUnit: {
        id: unit.id,
        trackingNumber: unit.tracking_number || '',
        status: unit.status || '',
      },
      trackingIdentifiers: [],
    });
  });

  (identifierRows || []).forEach((row) => {
    const type = typesById.get(row.identifier_type_id);
    const current = detailsMap.get(row.tracking_unit_id) || { trackingUnit: null, trackingIdentifiers: [] };

    current.trackingIdentifiers.push({
      id: row.id,
      identifierTypeId: row.identifier_type_id,
      label: type?.name || 'رقم تتبع',
      code: type?.code || '',
      value: row.value || '',
      isNotAvailable: row.is_not_available ?? false,
    });
    detailsMap.set(row.tracking_unit_id, current);
  });

  (licenseRows || []).forEach((row) => {
    const current = detailsMap.get(row.tracking_unit_id) || { trackingUnit: null, trackingIdentifiers: [] };

    current.license = {
      id: row.id,
      trackingUnitId: row.tracking_unit_id,
      status: row.license_status || '',
      number: row.license_number || '',
      issuedAt: row.license_issued_at || null,
      expiresAt: row.license_expires_at || null,
      issuingAuthority: row.issuing_authority || '',
      notes: row.notes || '',
      isCurrent: row.is_current ?? true,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
    };
    detailsMap.set(row.tracking_unit_id, current);
  });

  const attachmentsWithUrls = await Promise.all((attachmentRows || []).map(async (row) => {
    const bucket = row.bucket_name || TENANT_FILES_BUCKET;
    const { data } = await client.storage.from(bucket).createSignedUrl(row.file_path, SIGNED_URL_EXPIRES_IN);

    return {
      id: row.id,
      trackingUnitId: row.related_id,
      documentType: row.document_type,
      bucket,
      path: row.file_path,
      name: row.original_file_name || '',
      mimeType: row.mime_type || '',
      createdAt: row.created_at || null,
      signedUrl: data?.signedUrl || '',
    };
  }));

  attachmentsWithUrls.forEach((attachment) => {
    const current = detailsMap.get(attachment.trackingUnitId) || { trackingUnit: null, trackingIdentifiers: [], attachments: {} };
    current.attachments = {
      ...(current.attachments || {}),
      [attachment.documentType]: attachment,
    };
    detailsMap.set(attachment.trackingUnitId, current);
  });

  return detailsMap;
}

function normalizeSalePayment(record) {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    saleId: record.sale_id,
    amount: toNumber(record.amount),
    paymentDate: record.payment_date,
    paymentMethod: record.payment_method || '',
    notes: record.notes || '',
    createdBy: record.created_by,
    createdAt: record.created_at,
  };
}

function normalizeSale(record, customerMap, linesMap = new Map(), paymentsMap = new Map()) {
  const customer = customerMap.get(record.customer_id) ?? null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    branchId: record.branch_id,
    customerId: record.customer_id,
    saleDate: record.sale_date,
    status: record.status || 'pending',
    totalAmount: toNumber(record.total_amount),
    paidAmount: toNumber(record.paid_amount),
    remainingAmount: toNumber(record.remaining_amount),
    notes: record.notes || '',
    accountMoveId: record.account_move_id,
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    showroomConfigId: record.showroom_config_id,
    customer,
    items: linesMap.get(record.id) || [],
    payments: paymentsMap.get(record.id) || [],
  };
}

async function loadCustomersMap(client, tenantId, sales) {
  const customerIds = Array.from(new Set(
    (Array.isArray(sales) ? sales : [sales])
      .map((sale) => sale?.customer_id)
      .filter(Boolean),
  ));

  if (!customerIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('partners')
    .select(PARTNER_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', customerIds);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, partner) => {
    map.set(partner.id, normalizeCustomer(partner));
    return map;
  }, new Map());
}

async function loadSaleLinesMap(client, tenantId, sales) {
  const saleIds = Array.from(new Set(
    (Array.isArray(sales) ? sales : [sales])
      .map((sale) => sale?.id)
      .filter(Boolean),
  ));

  if (!saleIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('showroom_sale_lines')
    .select(SALE_LINE_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('sale_id', saleIds)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  const lines = data || [];
  const [productMap, attributesMap, variantAttributesMap, trackingDetailsMap, trackingUnitAttributesMap] = await Promise.all([
    loadProductsMap(client, tenantId, lines),
    loadLineAttributesMap(client, tenantId, lines),
    loadVariantAttributesMap(client, tenantId, lines),
    loadTrackingDetailsMap(client, tenantId, lines),
    loadTrackingUnitAttributesMap(client, tenantId, lines),
  ]);

  return lines.reduce((map, line) => {
    const current = map.get(line.sale_id) || [];
    current.push(normalizeSaleLine(line, productMap, attributesMap, variantAttributesMap, trackingDetailsMap, trackingUnitAttributesMap));
    map.set(line.sale_id, current);
    return map;
  }, new Map());
}

async function loadSalePaymentsMap(client, tenantId, sales) {
  const saleIds = Array.from(new Set(
    (Array.isArray(sales) ? sales : [sales])
      .map((sale) => sale?.id)
      .filter(Boolean),
  ));

  if (!saleIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('showroom_sale_payments')
    .select(SALE_PAYMENT_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('sale_id', saleIds)
    .order('payment_date', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, payment) => {
    const current = map.get(payment.sale_id) || [];
    current.push(normalizeSalePayment(payment));
    map.set(payment.sale_id, current);
    return map;
  }, new Map());
}

async function loadPaperworkPartnersMap(client, tenantId, requests) {
  const partnerIds = Array.from(new Set(
    (Array.isArray(requests) ? requests : [])
      .flatMap((request) => [
        request?.customer_id,
        request?.document_owner_partner_id,
        request?.processor_partner_id,
      ])
      .filter(Boolean),
  ));

  if (!partnerIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('partners')
    .select(PARTNER_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', partnerIds);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, partner) => {
    map.set(partner.id, normalizeCustomer(partner));
    return map;
  }, new Map());
}

async function loadPaperworkStagesMap(client, tenantId, requests) {
  const stageIds = Array.from(new Set(
    (Array.isArray(requests) ? requests : [])
      .map((request) => request?.current_stage_id)
      .filter(Boolean),
  ));

  if (!stageIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('paperwork_stages')
    .select('id, code, name, sequence, is_start, is_done, is_cancel')
    .eq('tenant_id', tenantId)
    .in('id', stageIds);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, stage) => {
    map.set(stage.id, {
      id: stage.id,
      code: stage.code || '',
      name: stage.name || 'مرحلة غير محددة',
      sequence: Number(stage.sequence) || 0,
      isStart: stage.is_start ?? false,
      isDone: stage.is_done ?? false,
      isCancel: stage.is_cancel ?? false,
    });
    return map;
  }, new Map());
}

async function loadPaperworkSaleLinesMap(client, tenantId, requests) {
  const saleLineIds = Array.from(new Set(
    (Array.isArray(requests) ? requests : [])
      .map((request) => request?.sale_line_id)
      .filter(Boolean),
  ));

  if (!saleLineIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('showroom_sale_lines')
    .select(SALE_LINE_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', saleLineIds);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, line) => {
    map.set(line.id, line);
    return map;
  }, new Map());
}

async function loadPaperworkTrackingUnitsMap(client, tenantId, requests) {
  const trackingUnitIds = Array.from(new Set(
    (Array.isArray(requests) ? requests : [])
      .map((request) => request?.tracking_unit_id)
      .filter(Boolean),
  ));

  if (!trackingUnitIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('stock_tracking_units')
    .select('id, product_product_id, tracking_number, tracking_type, status')
    .eq('tenant_id', tenantId)
    .in('id', trackingUnitIds);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, unit) => {
    map.set(unit.id, unit);
    return map;
  }, new Map());
}

async function loadPartnersByIdsMap(client, tenantId, partnerIds = []) {
  const ids = Array.from(new Set((Array.isArray(partnerIds) ? partnerIds : []).filter(Boolean)));

  if (!ids.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('partners')
    .select(PARTNER_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', ids);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, partner) => {
    map.set(partner.id, normalizeCustomer(partner));
    return map;
  }, new Map());
}

async function loadTenantUsersByIdsMap(client, tenantId, userIds = []) {
  const ids = Array.from(new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean)));

  if (!ids.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('tenant_users')
    .select(TENANT_USER_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', ids);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, user) => {
    map.set(user.id, {
      id: user.id,
      name: user.full_name || user.email || 'مستخدم غير محدد',
      email: user.email || '',
    });
    return map;
  }, new Map());
}

async function loadPaperworkRequestEventsMap(client, tenantId, requests = []) {
  const requestIds = Array.from(new Set(
    (Array.isArray(requests) ? requests : [])
      .map((request) => request?.id)
      .filter(Boolean),
  ));

  if (!requestIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('paperwork_request_events')
    .select(PAPERWORK_REQUEST_EVENT_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('request_id', requestIds)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const events = data || [];
  const usersMap = await loadTenantUsersByIdsMap(
    client,
    tenantId,
    events.map((event) => event.created_by).filter(Boolean),
  );

  return events.reduce((map, event) => {
    const normalizedEvent = {
      id: event.id,
      tenantId: event.tenant_id,
      requestId: event.request_id,
      eventType: event.event_type || '',
      newStatus: event.new_status || '',
      newStageId: event.new_stage_id || null,
      notes: event.notes || '',
      createdBy: event.created_by,
      createdByName: usersMap.get(event.created_by)?.name || '',
      createdAt: event.created_at,
    };
    const current = map.get(event.request_id) || [];
    current.push(normalizedEvent);
    map.set(event.request_id, current);
    return map;
  }, new Map());
}

async function loadPaperworkDocumentAttachmentsMap(client, tenantId, documentIds = []) {
  const ids = Array.from(new Set((Array.isArray(documentIds) ? documentIds : []).filter(Boolean)));

  if (!ids.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('ir_attachments')
    .select('id, related_id, document_type, bucket_name, file_path, original_file_name, mime_type, created_at')
    .eq('tenant_id', tenantId)
    .eq('related_model', 'paperwork_documents')
    .eq('document_type', 'jawab_photo')
    .in('related_id', ids)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rowsWithUrls = await Promise.all((data || []).map(async (row) => {
    const bucket = row.bucket_name || TENANT_FILES_BUCKET;
    const { data: signedData } = await client.storage.from(bucket).createSignedUrl(row.file_path, SIGNED_URL_EXPIRES_IN);

    return {
      id: row.id,
      documentId: row.related_id,
      documentType: row.document_type,
      bucket,
      path: row.file_path,
      name: row.original_file_name || '',
      mimeType: row.mime_type || '',
      createdAt: row.created_at || null,
      signedUrl: signedData?.signedUrl || '',
    };
  }));

  return rowsWithUrls.reduce((map, attachment) => {
    if (!map.has(attachment.documentId)) {
      map.set(attachment.documentId, attachment);
    }
    return map;
  }, new Map());
}

function getMovePartyLabel({ userId, partnerId, location, usersMap, partnersMap }) {
  if (userId) {
    return usersMap?.get(userId)?.name || 'مستخدم غير محدد';
  }

  if (partnerId) {
    return partnersMap?.get(partnerId)?.name || 'جهة غير محددة';
  }

  return location || 'غير محدد';
}

function normalizePaperworkDocumentMove(record, maps = {}) {
  const document = maps.documentsMap?.get(record.document_id) || null;
  const fallbackDirection = ['opening', 'receive', 'return', 'manual', 'manual_adjustment'].includes(record.move_type) ? 'in' : 'out';

  return {
    id: record.id,
    tenantId: record.tenant_id,
    documentId: record.document_id,
    moveDirection: record.move_direction || fallbackDirection,
    sourceType: record.source_type || record.move_type || 'manual',
    fromUserId: record.from_user_id,
    fromPartnerId: record.from_partner_id,
    fromLocation: record.from_location || '',
    toUserId: record.to_user_id,
    toPartnerId: record.to_partner_id,
    toLocation: record.to_location || '',
    movedAt: record.moved_at,
    notes: record.notes || '',
    createdBy: record.created_by,
    createdAt: record.created_at,
    documentTitle: document?.documentTitle || document?.displayTitle || 'مستند غير محدد',
    documentType: document?.documentType || '',
    fromLabel: getMovePartyLabel({
      userId: record.from_user_id,
      partnerId: record.from_partner_id,
      location: record.from_location,
      usersMap: maps.usersMap,
      partnersMap: maps.partnersMap,
    }),
    toLabel: getMovePartyLabel({
      userId: record.to_user_id,
      partnerId: record.to_partner_id,
      location: record.to_location,
      usersMap: maps.usersMap,
      partnersMap: maps.partnersMap,
    }),
    createdByName: maps.usersMap?.get(record.created_by)?.name || '',
  };
}

function normalizePaperworkDocument(record, maps = {}) {
  const trackingUnit = maps.trackingUnitsMap?.get(record.tracking_unit_id) || null;
  const product = maps.productMap?.get(trackingUnit?.product_product_id) || null;
  const trackingDetails = maps.trackingDetailsMap?.get(record.tracking_unit_id) || {};
  const moves = maps.movesMap?.get(record.id) || [];
  const jawabPhoto = maps.attachmentsMap?.get(record.id) || null;
  const latestMove = moves[0] || null;
  const title = record.document_title || record.manual_item_description || product?.displayName || trackingUnit?.tracking_number || 'ورقة بدون عنوان';
  const itemDescription = trackingUnit
    ? [product?.displayName, trackingUnit.tracking_number].filter(Boolean).join(' - ')
    : record.manual_item_description || '';

  return {
    id: record.id,
    tenantId: record.tenant_id,
    branchId: record.branch_id,
    documentType: record.document_type || 'document',
    documentTitle: record.document_title || '',
    displayTitle: title,
    trackingUnitId: record.tracking_unit_id,
    paperworkRequestId: record.paperwork_request_id,
    ownerPartnerId: record.owner_partner_id,
    manualItemDescription: record.manual_item_description || '',
    sourceType: record.source_type || 'manual',
    status: record.status || 'available',
    notes: record.notes || '',
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    owner: maps.partnersMap?.get(record.owner_partner_id) || null,
    trackingUnit: trackingUnit ? {
      id: trackingUnit.id,
      trackingNumber: trackingUnit.tracking_number || '',
      status: trackingUnit.status || '',
      productProductId: trackingUnit.product_product_id || null,
    } : null,
    productName: product?.displayName || product?.sku || '',
    itemDescription,
    trackingIdentifiers: mergeTrackingIdentifiers(product?.expectedTrackingIdentifiers || [], trackingDetails.trackingIdentifiers || []),
    jawabPhoto,
    moves,
    latestMove,
  };
}

function normalizePaperworkRequest(record, maps = {}) {
  const saleLine = maps.saleLinesMap?.get(record.sale_line_id) || null;
  const trackingUnit = maps.trackingUnitsMap?.get(record.tracking_unit_id) || null;
  const productProductId = trackingUnit?.product_product_id || saleLine?.product_product_id || null;
  const product = maps.productMap?.get(productProductId) || null;
  const trackingDetails = maps.trackingDetailsMap?.get(record.tracking_unit_id) || {};
  const productName = saleLine?.description || product?.displayName || product?.sku || 'طلب أوراق';
  const events = maps.eventsMap?.get(record.id) || [];
  const deliveryEvent = events.find((event) => event.eventType === 'done' || event.newStatus === 'done') || null;
  const trackingUnitDetails = trackingDetails.trackingUnit || (trackingUnit ? {
    id: trackingUnit.id,
    trackingNumber: trackingUnit.tracking_number || '',
    status: trackingUnit.status || '',
  } : null);

  return {
    id: record.id,
    tenantId: record.tenant_id,
    branchId: record.branch_id,
    requestSource: record.request_source || 'manual',
    requestType: record.request_type || 'new_document',
    saleId: record.sale_id,
    saleLineId: record.sale_line_id,
    trackingUnitId: record.tracking_unit_id,
    customerId: record.customer_id,
    documentOwnerPartnerId: record.document_owner_partner_id,
    processorPartnerId: record.processor_partner_id,
    currentStageId: record.current_stage_id,
    stageEnteredAt: record.stage_entered_at,
    assignedTo: record.assigned_to,
    status: record.status || 'open',
    priority: record.priority || 'normal',
    blockedReason: record.blocked_reason || '',
    deferredReason: record.deferred_reason || '',
    cancelReason: record.cancel_reason || '',
    notes: record.notes || '',
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    closedAt: record.closed_at,
    events,
    deliveryEvent,
    deliveryEventCreatedBy: deliveryEvent?.createdBy || null,
    deliveryEventCreatedByName: deliveryEvent?.createdByName || '',
    deliveryEventCreatedAt: deliveryEvent?.createdAt || null,
    deliveryEventNotes: deliveryEvent?.notes || '',
    customer: maps.partnersMap?.get(record.customer_id) || null,
    documentOwner: maps.partnersMap?.get(record.document_owner_partner_id) || null,
    processor: maps.partnersMap?.get(record.processor_partner_id) || null,
    stage: maps.stagesMap?.get(record.current_stage_id) || null,
    productProductId,
    productName,
    attributes: maps.trackingUnitAttributesMap?.get(record.tracking_unit_id) || [],
    attributesText: formatPaperAttributesTextForService(maps.trackingUnitAttributesMap?.get(record.tracking_unit_id) || []),
    trackingUnit: trackingUnitDetails,
    trackingIdentifiers: mergeTrackingIdentifiers(product?.expectedTrackingIdentifiers || [], trackingDetails.trackingIdentifiers || []),
    license: trackingDetails.license || null,
    attachments: trackingDetails.attachments || {},
  };
}

function formatPaperAttributesTextForService(attributes) {
  return (Array.isArray(attributes) ? attributes : [])
    .map((attribute) => attribute.value)
    .filter(Boolean)
    .join(' / ');
}

export const motoCustomerCareService = {
  async listSales({ tenantId, status, limit = 150 } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();

    let query = client
      .from('showroom_sales')
      .select(SALE_COLUMNS)
      .eq('tenant_id', tenantId);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    const sales = data || [];
    const [customerMap, linesMap, paymentsMap] = await Promise.all([
      loadCustomersMap(client, tenantId, sales),
      loadSaleLinesMap(client, tenantId, sales),
      loadSalePaymentsMap(client, tenantId, sales),
    ]);

    return sales.map((sale) => normalizeSale(sale, customerMap, linesMap, paymentsMap));
  },

  async listPaperworkRequests({ tenantId, limit = 150 } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();

    const { data, error } = await client
      .from('paperwork_requests')
      .select(PAPERWORK_REQUEST_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    const requests = data || [];
    const [partnersMap, stagesMap, saleLinesMap, trackingUnitsMap, eventsMap] = await Promise.all([
      loadPaperworkPartnersMap(client, tenantId, requests),
      loadPaperworkStagesMap(client, tenantId, requests),
      loadPaperworkSaleLinesMap(client, tenantId, requests),
      loadPaperworkTrackingUnitsMap(client, tenantId, requests),
      loadPaperworkRequestEventsMap(client, tenantId, requests),
    ]);

    const contextLines = requests.map((request) => {
      const saleLine = saleLinesMap.get(request.sale_line_id) || null;
      const trackingUnit = trackingUnitsMap.get(request.tracking_unit_id) || null;

      return {
        id: saleLine?.id || request.id,
        product_product_id: trackingUnit?.product_product_id || saleLine?.product_product_id || null,
        tracking_unit_id: request.tracking_unit_id,
      };
    });

    const [productMap, trackingDetailsMap, trackingUnitAttributesMap] = await Promise.all([
      loadProductsMap(client, tenantId, contextLines),
      loadTrackingDetailsMap(client, tenantId, contextLines),
      loadTrackingUnitAttributesMap(client, tenantId, contextLines),
    ]);

    return requests.map((request) => normalizePaperworkRequest(request, {
      partnersMap,
      stagesMap,
      saleLinesMap,
      trackingUnitsMap,
      productMap,
      trackingDetailsMap,
      trackingUnitAttributesMap,
      eventsMap,
    }));
  },

  async listPaperworkDocuments({ tenantId, limit = 250 } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();

    const { data, error } = await client
      .from('paperwork_documents')
      .select(PAPERWORK_DOCUMENT_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    const documents = data || [];
    const trackingUnitIds = Array.from(new Set(documents.map((document) => document.tracking_unit_id).filter(Boolean)));
    const ownerPartnerIds = documents.map((document) => document.owner_partner_id).filter(Boolean);

    const documentIds = documents.map((document) => document.id).filter(Boolean);
    const [trackingUnitsMap, partnersMap, attachmentsMap] = await Promise.all([
      trackingUnitIds.length
        ? loadPaperworkTrackingUnitsMap(client, tenantId, documents)
        : Promise.resolve(new Map()),
      loadPartnersByIdsMap(client, tenantId, ownerPartnerIds),
      loadPaperworkDocumentAttachmentsMap(client, tenantId, documentIds),
    ]);

    const contextLines = documents.map((document) => {
      const trackingUnit = trackingUnitsMap.get(document.tracking_unit_id) || null;
      return {
        id: document.id,
        product_product_id: trackingUnit?.product_product_id || null,
        tracking_unit_id: document.tracking_unit_id,
      };
    });

    const [productMap, trackingDetailsMap] = await Promise.all([
      loadProductsMap(client, tenantId, contextLines),
      loadTrackingDetailsMap(client, tenantId, contextLines),
    ]);
    const baseDocuments = documents.map((document) => normalizePaperworkDocument(document, {
      trackingUnitsMap,
      partnersMap,
      productMap,
      trackingDetailsMap,
      attachmentsMap,
    }));
    const documentsMap = new Map(baseDocuments.map((document) => [document.id, document]));

    const { data: moveRows, error: movesError } = documentIds.length
      ? await client
        .from('paperwork_document_moves')
        .select(PAPERWORK_DOCUMENT_MOVE_COLUMNS)
        .eq('tenant_id', tenantId)
        .in('document_id', documentIds)
        .order('moved_at', { ascending: false })
        .order('created_at', { ascending: false })
      : { data: [], error: null };

    if (movesError) {
      throw movesError;
    }

    const moves = moveRows || [];
    const movePartnerIds = moves.flatMap((move) => [move.from_partner_id, move.to_partner_id]).filter(Boolean);
    const moveUserIds = moves.flatMap((move) => [move.from_user_id, move.to_user_id, move.created_by]).filter(Boolean);
    const [movePartnersMap, usersMap] = await Promise.all([
      loadPartnersByIdsMap(client, tenantId, movePartnerIds),
      loadTenantUsersByIdsMap(client, tenantId, moveUserIds),
    ]);
    const allPartnersMap = new Map([...partnersMap, ...movePartnersMap]);
    const normalizedMoves = moves.map((move) => normalizePaperworkDocumentMove(move, {
      documentsMap,
      partnersMap: allPartnersMap,
      usersMap,
    }));
    const movesMap = normalizedMoves.reduce((map, move) => {
      const current = map.get(move.documentId) || [];
      current.push(move);
      map.set(move.documentId, current);
      return map;
    }, new Map());

    return {
      documents: documents.map((document) => normalizePaperworkDocument(document, {
        trackingUnitsMap,
        partnersMap,
        productMap,
        trackingDetailsMap,
        movesMap,
        attachmentsMap,
      })),
      moves: normalizedMoves,
    };
  },

  async listPaperworkMoveTargets({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();

    const [partnersResult, usersResult] = await Promise.all([
      client
        .from('partners')
        .select(PARTNER_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true })
        .limit(200),
      client
        .from('tenant_users')
        .select(TENANT_USER_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('full_name', { ascending: true })
        .limit(100),
    ]);

    if (partnersResult.error) {
      throw partnersResult.error;
    }

    if (usersResult.error) {
      throw usersResult.error;
    }

    return {
      partners: (partnersResult.data || []).map(normalizeCustomer),
      users: (usersResult.data || []).map((user) => ({
        id: user.id,
        name: user.full_name || user.email || 'مستخدم غير محدد',
        email: user.email || '',
      })),
    };
  },

  async createPaperworkDocumentOutMove({
    tenantId,
    documentId,
    sourceType = 'to_customer',
    targetPartnerId = null,
    targetUserId = null,
    targetLocation = '',
    notes = '',
  } = {}) {
    requireTenantId(tenantId);

    if (!documentId) {
      throw new Error('تعذر تحديد الورقة المطلوب صرفها.');
    }

    if (!PAPERWORK_OUT_SOURCE_TYPES.has(sourceType)) {
      throw new Error('نوع الصرف غير مدعوم.');
    }

    const needsPartner = ['to_customer', 'to_supplier', 'to_processor'].includes(sourceType);
    const needsUser = sourceType === 'to_employee';
    const needsLocation = sourceType === 'other';
    const safeLocation = String(targetLocation || '').trim();
    const safeNotes = String(notes || '').trim();

    if (needsPartner && !targetPartnerId) {
      throw new Error('اختر الجهة التي سيتم الصرف لها.');
    }

    if (needsUser && !targetUserId) {
      throw new Error('اختر الموظف الذي سيتم الصرف له.');
    }

    if (needsLocation && !safeLocation) {
      throw new Error('اكتب وجهة الصرف.');
    }

    const client = requireSupabase();
    const { data: document, error: documentError } = await client
      .from('paperwork_documents')
      .select('id, status')
      .eq('tenant_id', tenantId)
      .eq('id', documentId)
      .maybeSingle();

    if (documentError) {
      throw documentError;
    }

    if (!document) {
      throw new Error('الورقة غير موجودة.');
    }

    if (document.status !== 'in_custody') {
      throw new Error('لا يمكن صرف ورقة ليست في العهدة.');
    }

    const currentTenantUserId = await resolveCurrentTenantUserId(client, { tenantId });
    const statusBySourceType = {
      to_customer: 'delivered',
      lost: 'lost',
      cancelled: 'cancelled',
    };
    const nextStatus = statusBySourceType[sourceType] || 'transferred';
    const destinationLocation = needsPartner || needsUser
      ? null
      : safeLocation || (sourceType === 'lost' ? 'مفقود' : sourceType === 'cancelled' ? 'ملغي' : null);

    const { data: move, error: moveError } = await client
      .from('paperwork_document_moves')
      .insert({
        tenant_id: tenantId,
        document_id: documentId,
        move_direction: 'out',
        source_type: sourceType,
        from_user_id: currentTenantUserId,
        to_partner_id: needsPartner ? targetPartnerId : null,
        to_user_id: needsUser ? targetUserId : null,
        to_location: destinationLocation,
        moved_at: new Date().toISOString(),
        notes: safeNotes || null,
        created_by: currentTenantUserId,
      })
      .select('id')
      .single();

    if (moveError) {
      throw moveError;
    }

    const updatePayload = {
      status: nextStatus,
      updated_at: new Date().toISOString(),
    };

    if (safeNotes) {
      updatePayload.notes = safeNotes;
    }

    const { error: updateError } = await client
      .from('paperwork_documents')
      .update(updatePayload)
      .eq('tenant_id', tenantId)
      .eq('id', documentId);

    if (updateError) {
      await client
        .from('paperwork_document_moves')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('id', move.id);
      throw updateError;
    }

    return move.id;
  },

  async listTrackingUnitIdentifiers({ tenantId, trackingUnitId } = {}) {
    requireTenantId(tenantId);

    if (!trackingUnitId) {
      return [];
    }

    const client = requireSupabase();
    const { data: rows, error } = await client
      .from('stock_tracking_unit_identifiers')
      .select('id, tracking_unit_id, identifier_type_id, value, is_not_available')
      .eq('tenant_id', tenantId)
      .eq('tracking_unit_id', trackingUnitId);

    if (error) {
      throw error;
    }

    const identifierTypeIds = Array.from(new Set((rows || []).map((row) => row.identifier_type_id).filter(Boolean)));
    const { data: types, error: typesError } = identifierTypeIds.length
      ? await client
        .from('product_tracking_identifier_types')
        .select('id, name, code')
        .eq('tenant_id', tenantId)
        .in('id', identifierTypeIds)
      : { data: [], error: null };

    if (typesError) {
      throw typesError;
    }

    const typesById = new Map((types || []).map((type) => [type.id, type]));

    return (rows || []).map((row) => {
      const type = typesById.get(row.identifier_type_id);

      return {
        id: row.id,
        trackingUnitId: row.tracking_unit_id,
        identifierTypeId: row.identifier_type_id,
        label: type?.name || 'تعريف',
        code: type?.code || '',
        value: row.value || '',
        isNotAvailable: row.is_not_available ?? false,
      };
    });
  },

  async createPaperworkDocument({
    tenantId,
    documentType = 'jawab',
    documentTitle,
    sourceType = 'manual',
    ownerPartnerId = null,
    trackingUnitId = null,
    paperworkRequestId = null,
    initialLocation = '',
    notes = '',
  } = {}) {
    requireTenantId(tenantId);

    if (!trackingUnitId) {
      throw new Error('اختر القطعة المسجلة المرتبطة بالجواب.');
    }

    const client = requireSupabase();
    const { data: trackingUnit, error: trackingUnitError } = await client
      .from('stock_tracking_units')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', trackingUnitId)
      .maybeSingle();

    if (trackingUnitError) {
      throw trackingUnitError;
    }

    if (!trackingUnit) {
      throw new Error('القطعة المسجلة غير موجودة.');
    }

    const safeTitle = String(documentTitle || '').trim() || 'جواب';
    const currentTenantUserId = await resolveCurrentTenantUserId(client, { tenantId });
    const status = 'in_custody';

    const { data: document, error: documentError } = await client
      .from('paperwork_documents')
      .insert({
        tenant_id: tenantId,
        document_type: 'jawab',
        document_title: safeTitle,
        tracking_unit_id: trackingUnitId || null,
        paperwork_request_id: paperworkRequestId || null,
        owner_partner_id: ownerPartnerId || null,
        source_type: sourceType || 'manual',
        status,
        notes: String(notes || '').trim() || null,
        created_by: currentTenantUserId,
      })
      .select('id')
      .single();

    if (documentError) {
      throw documentError;
    }

    const { error: moveError } = await client
      .from('paperwork_document_moves')
      .insert({
        tenant_id: tenantId,
        document_id: document.id,
        move_direction: 'in',
        source_type: 'manual',
        to_user_id: currentTenantUserId,
        to_location: String(initialLocation || '').trim() || null,
        moved_at: new Date().toISOString(),
        notes: String(notes || '').trim() || null,
        created_by: currentTenantUserId,
      });

    if (moveError) {
      await client
        .from('paperwork_documents')
        .delete()
        .eq('tenant_id', tenantId)
        .eq('id', document.id);
      throw moveError;
    }

    return document.id;
  },

  async deletePaperworkDocumentRollback({ tenantId, documentId } = {}) {
    const client = requireSupabase();
    requireTenantId(tenantId);
    if (!documentId) return false;

    const { error: attachmentsError } = await client
      .from('ir_attachments')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('related_model', 'paperwork_documents')
      .eq('related_id', documentId);

    if (attachmentsError) {
      throw attachmentsError;
    }

    const { error: movesError } = await client
      .from('paperwork_document_moves')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('document_id', documentId);

    if (movesError) {
      throw movesError;
    }

    const { error: documentError } = await client
      .from('paperwork_documents')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', documentId);

    if (documentError) {
      throw documentError;
    }

    return true;
  },

  async savePaperworkDocumentAttachment({ tenantId, documentId, documentType = 'jawab_photo', file, userId } = {}) {
    const client = requireSupabase();
    requireTenantId(tenantId);
    if (!documentId) throw new Error('تعذر تحديد الجواب.');
    if (!file) return null;

    assertPaperworkImage(file);

    const { data: document, error: documentError } = await client
      .from('paperwork_documents')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', documentId)
      .maybeSingle();

    if (documentError) {
      throw documentError;
    }

    if (!document) {
      throw new Error('الجواب غير موجود.');
    }

    const createdBy = userId || await resolveCurrentTenantUserId(client, { tenantId });
    const extension = getFileExtension(file);
    const path = `${tenantId}/paperwork-documents/${documentId}/${documentType}-${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await client.storage.from(TENANT_FILES_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

    if (uploadError) {
      throw new Error(uploadError.message || 'تعذر رفع صورة الجواب.');
    }

    const { error: attachmentError } = await client.from('ir_attachments').insert({
      tenant_id: tenantId,
      bucket_name: TENANT_FILES_BUCKET,
      file_path: path,
      document_type: documentType,
      related_model: 'paperwork_documents',
      related_id: documentId,
      original_file_name: file.name || null,
      mime_type: file.type || null,
      file_size: file.size || null,
      created_by: createdBy,
    });

    if (attachmentError) {
      await client.storage.from(TENANT_FILES_BUCKET).remove([path]);
      throw new Error(attachmentError.message || 'تم رفع الصورة لكن تعذر ربطها بالجواب.');
    }

    return { path, bucket: TENANT_FILES_BUCKET, documentType };
  },

  async linkExistingPaperworkDocumentAttachment({
    tenantId,
    documentId,
    documentType = 'jawab_photo',
    source,
    userId,
  } = {}) {
    const client = requireSupabase();
    requireTenantId(tenantId);
    if (!documentId) throw new Error('تعذر تحديد الجواب.');
    if (!source?.path) throw new Error('اختر صورة موجودة أولاً.');

    const path = normalizeStoragePath(source.path);
    if (!path.startsWith(`${tenantId}/`)) {
      throw new Error('لا يمكن ربط صورة من مساحة شركة أخرى.');
    }

    const { data: document, error: documentError } = await client
      .from('paperwork_documents')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', documentId)
      .maybeSingle();

    if (documentError) {
      throw documentError;
    }

    if (!document) {
      throw new Error('الجواب غير موجود.');
    }

    const createdBy = userId || await resolveCurrentTenantUserId(client, { tenantId });
    const { error: attachmentError } = await client.from('ir_attachments').insert({
      tenant_id: tenantId,
      bucket_name: source.bucket || source.bucketName || TENANT_FILES_BUCKET,
      file_path: path,
      document_type: documentType,
      related_model: 'paperwork_documents',
      related_id: documentId,
      original_file_name: source.name || source.originalFileName || path.split('/').pop() || null,
      mime_type: source.mimeType || null,
      file_size: source.size || null,
      created_by: createdBy,
    });

    if (attachmentError) {
      throw new Error(attachmentError.message || 'تعذر ربط الصورة الموجودة بالجواب.');
    }

    return { path, bucket: source.bucket || source.bucketName || TENANT_FILES_BUCKET, documentType };
  },

  async listTenantImageFiles({ tenantId, limit = 120 } = {}) {
    const client = requireSupabase();
    requireTenantId(tenantId);

    const files = await listTenantStorageImages(client, tenantId, tenantId, [], 0, limit);

    return Promise.all(files.map(async (file) => {
      const { data: signedData } = await client.storage.from(file.bucket).createSignedUrl(file.path, SIGNED_URL_EXPIRES_IN);
      return {
        ...file,
        signedUrl: signedData?.signedUrl || '',
      };
    }));
  },

  async createPaperworkRequest({ tenantId, item, requestType = 'new_document', priority = 'normal', notes = '' } = {}) {
    requireTenantId(tenantId);
    if (!item?.saleId) {
      throw new Error('تعذر تحديد الفاتورة المرتبطة بطلب الأوراق.');
    }
    if (!item?.id) {
      throw new Error('تعذر تحديد سطر المنتج المطلوب.');
    }

    const client = requireSupabase();
    const currentTenantUserId = await resolveCurrentTenantUserId(client, { tenantId });
    const { data: stage, error: stageError } = await client
      .from('paperwork_stages')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('is_start', { ascending: false })
      .order('sequence', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (stageError) {
      throw stageError;
    }

    if (!stage?.id) {
      throw new Error('لا توجد مرحلة أوراق نشطة لإنشاء الطلب.');
    }

    const { error } = await client
      .from('paperwork_requests')
      .insert({
        tenant_id: tenantId,
        branch_id: item.branchId || null,
        request_source: 'sale',
        request_type: requestType || 'new_document',
        sale_id: item.saleId,
        sale_line_id: item.id,
        tracking_unit_id: item.trackingUnitId || null,
        customer_id: item.customerId || null,
        current_stage_id: stage.id,
        status: 'open',
        priority: priority || 'normal',
        notes: String(notes || '').trim() || null,
        created_by: currentTenantUserId,
      });

    if (error) {
      throw error;
    }

    return true;
  },

  async createLegacyDeliveredPaperworkRequest({ tenantId, item, confirmationNote = '' } = {}) {
    requireTenantId(tenantId);
    if (!item?.saleId) {
      throw new Error('تعذر تحديد الفاتورة المرتبطة بحالة الأوراق.');
    }

    const client = requireSupabase();
    const { data, error } = await client.rpc('create_legacy_delivered_paperwork_request', {
      p_tenant_id: tenantId,
      p_branch_id: item.branchId || null,
      p_sale_id: item.saleId,
      p_sale_line_id: item.id || null,
      p_tracking_unit_id: item.trackingUnitId || null,
      p_customer_id: item.customerId || null,
      p_confirmation_note: String(confirmationNote || '').trim(),
    });

    if (error) {
      throw error;
    }

    return Array.isArray(data) ? data[0] : data;
  },

  async getSaleDetails({ tenantId, saleId } = {}) {
    requireTenantId(tenantId);
    requireSaleId(saleId);
    const client = requireSupabase();

    const { data, error } = await client
      .from('showroom_sales')
      .select(SALE_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', saleId)
      .single();

    if (error) {
      throw error;
    }

    const [customerMap, linesMap, paymentsMap] = await Promise.all([
      loadCustomersMap(client, tenantId, data),
      loadSaleLinesMap(client, tenantId, data),
      loadSalePaymentsMap(client, tenantId, data),
    ]);
    return normalizeSale(data, customerMap, linesMap, paymentsMap);
  },

  async saveSaleLineTrackingIdentifiers({ tenantId, lineId, productProductId, trackingUnitId, identifiers = [] } = {}) {
    requireTenantId(tenantId);
    if (!lineId) {
      throw new Error('تعذر تحديد سطر المنتج المطلوب.');
    }
    if (!productProductId) {
      throw new Error('تعذر تحديد المنتج المطلوب.');
    }

    const client = requireSupabase();
    const normalizedIdentifiers = (Array.isArray(identifiers) ? identifiers : [])
      .map((identifier) => ({
        identifierTypeId: identifier?.identifierTypeId,
        value: String(identifier?.value || '').trim(),
        isNotAvailable: Boolean(identifier?.isNotAvailable),
      }))
      .filter((identifier) => identifier.identifierTypeId);
    const trackingNumber = normalizedIdentifiers.map((identifier) => identifier.value).filter(Boolean).join(' - ');
    let nextTrackingUnitId = trackingUnitId || null;
    const hasNotAvailableIdentifier = normalizedIdentifiers.some((identifier) => identifier.isNotAvailable);
    const safeTrackingNumber = trackingNumber || (hasNotAvailableIdentifier ? `NA-${lineId}` : '');

    if (!nextTrackingUnitId && safeTrackingNumber) {
      const { data: createdUnit, error: createError } = await client
        .from('stock_tracking_units')
        .insert([{
          tenant_id: tenantId,
          product_product_id: productProductId,
          tracking_number: safeTrackingNumber,
          tracking_type: 'serial',
          status: 'sold',
          notes: `customer_care:${lineId}`,
        }])
        .select('id')
        .single();

      if (createError) {
        throw createError;
      }

      nextTrackingUnitId = createdUnit.id;

      const { error: lineError } = await client
        .from('showroom_sale_lines')
        .update({ tracking_unit_id: nextTrackingUnitId })
        .eq('tenant_id', tenantId)
        .eq('id', lineId);

      if (lineError) {
        throw lineError;
      }
    } else if (nextTrackingUnitId && safeTrackingNumber) {
      const { error: unitError } = await client
        .from('stock_tracking_units')
        .update({ tracking_number: safeTrackingNumber })
        .eq('tenant_id', tenantId)
        .eq('id', nextTrackingUnitId);

      if (unitError) {
        throw unitError;
      }
    }

    if (!nextTrackingUnitId) {
      return true;
    }

    const { error: deleteError } = await client
      .from('stock_tracking_unit_identifiers')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('tracking_unit_id', nextTrackingUnitId);

    if (deleteError) {
      throw deleteError;
    }

    const rows = normalizedIdentifiers
      .filter((identifier) => identifier.value || identifier.isNotAvailable)
      .map((identifier) => ({
        tenant_id: tenantId,
        tracking_unit_id: nextTrackingUnitId,
        identifier_type_id: identifier.identifierTypeId,
        value: identifier.isNotAvailable ? null : identifier.value,
        is_not_available: identifier.isNotAvailable,
      }));

    if (!rows.length) {
      return true;
    }

    const currentTenantUserId = await resolveCurrentTenantUserId(client, { tenantId });
    const { error: insertError } = await client
      .from('stock_tracking_unit_identifiers')
      .insert(rows.map((row) => ({ ...row, created_by: currentTenantUserId })));

    if (insertError) {
      if (insertError.code === '23505') {
        throw new Error('هذه القيمة مستخدمة بالفعل في وحدة أخرى.');
      }
      throw insertError;
    }

    return true;
  },

  async attachSaleLineTrackingUnit({ tenantId, lineId, productProductId, trackingUnitId } = {}) {
    requireTenantId(tenantId);
    if (!lineId) {
      throw new Error('تعذر تحديد سطر المنتج المطلوب.');
    }
    if (!productProductId) {
      throw new Error('تعذر تحديد المنتج المطلوب.');
    }
    if (!trackingUnitId) {
      throw new Error('تعذر تحديد القطعة المسجلة.');
    }

    const client = requireSupabase();
    const { data: unit, error: unitError } = await client
      .from('stock_tracking_units')
      .select('id, product_product_id, status')
      .eq('tenant_id', tenantId)
      .eq('id', trackingUnitId)
      .maybeSingle();

    if (unitError) {
      throw unitError;
    }

    if (!unit) {
      throw new Error('القطعة المسجلة غير موجودة.');
    }

    if (unit.product_product_id !== productProductId) {
      throw new Error('القطعة المسجلة لا تخص نفس منتج الفاتورة.');
    }

    if (unit.status !== 'in_stock') {
      throw new Error('هذه القطعة غير متاحة للربط.');
    }

    const { error: lineError } = await client
      .from('showroom_sale_lines')
      .update({ tracking_unit_id: trackingUnitId })
      .eq('tenant_id', tenantId)
      .eq('id', lineId)
      .eq('product_product_id', productProductId);

    if (lineError) {
      throw lineError;
    }

    const { error: statusError } = await client
      .from('stock_tracking_units')
      .update({ status: 'sold', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('id', trackingUnitId);

    if (statusError) {
      throw statusError;
    }

    return true;
  },

  async saveTrackingUnitLicense({ tenantId, trackingUnitId, license = {} } = {}) {
    requireTenantId(tenantId);
    if (!trackingUnitId) {
      throw new Error('تعذر تحديد وحدة التتبع المطلوبة.');
    }

    const status = license.status || license.licenseStatus || license.license_status || '';
    const number = String(license.number ?? license.licenseNumber ?? license.license_number ?? '').trim();
    const expiresAt = license.expiresAt || license.licenseExpiresAt || license.license_expires_at || null;

    if (!status) {
      throw new Error('اختر حالة الترخيص.');
    }

    if (status === 'licensed' && !number) {
      throw new Error('رقم الرخصة مطلوب عندما تكون الحالة مرخص.');
    }

    if (status === 'licensed' && !expiresAt) {
      throw new Error('تاريخ انتهاء الترخيص مطلوب عندما تكون الحالة مرخص.');
    }

    const client = requireSupabase();
    const currentTenantUserId = await resolveCurrentTenantUserId(client, { tenantId });

    const { error: updateError } = await client
      .from('stock_tracking_unit_licenses')
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('tracking_unit_id', trackingUnitId)
      .eq('is_current', true);

    if (updateError) {
      throw updateError;
    }

    const { error: insertError } = await client
      .from('stock_tracking_unit_licenses')
      .insert({
        tenant_id: tenantId,
        tracking_unit_id: trackingUnitId,
        license_status: status,
        license_number: number || null,
        license_issued_at: license.issuedAt || license.licenseIssuedAt || license.license_issued_at || null,
        license_expires_at: expiresAt,
        issuing_authority: String(license.issuingAuthority ?? license.issuing_authority ?? '').trim() || null,
        notes: String(license.notes ?? '').trim() || null,
        is_current: true,
        created_by: currentTenantUserId,
      });

    if (insertError) {
      if (insertError.code === '23505') {
        throw new Error('رقم الرخصة مستخدم بالفعل داخل نفس الشركة.');
      }
      throw insertError;
    }

    return true;
  },
};
