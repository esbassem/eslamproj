import { requireSupabase } from '@/core/lib/supabase';
import { invokePaperworkNotification } from '@/core/notifications/paperworkNotifications';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';
import { invalidateVaultPaperworkCache } from '@/features/paperwork/services/vaultPaperworkCache';
import * as Core from './paperworkDataCore';

const {
  SALE_COLUMNS, PARTNER_COLUMNS, SALE_LINE_COLUMNS, SALE_PAYMENT_MOVE_COLUMNS,
  TENANT_FILES_BUCKET, SIGNED_URL_EXPIRES_IN, normalizeOptionalText, toNumber,
  isStorageImage, normalizeStoragePath,
} = Core;

export function normalizeCustomer(record) {
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

export function mergeAttributes(...groups) {
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

export function mergeTrackingIdentifiers(expectedIdentifiers = [], actualIdentifiers = []) {
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

export function normalizeSaleLine(record, productMap = new Map(), attributesMap = new Map(), variantAttributesMap = new Map(), trackingDetailsMap = new Map(), trackingUnitAttributesMap = new Map()) {
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

export async function loadTrackingUnitAttributesMap(client, tenantId, lines) {
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

export async function loadProductsMap(client, tenantId, lines) {
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

export async function loadExpectedTrackingIdentifiersByCategoryId(client, tenantId, categoryIds) {
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

export async function loadLineAttributesMap(client, tenantId, lines) {
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

export async function loadVariantAttributesMap(client, tenantId, lines) {
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

export async function loadTrackingDetailsMap(client, tenantId, lines, { includeAttachments = true } = {}) {
  const trackingUnitIds = Array.from(new Set(
    (Array.isArray(lines) ? lines : [])
      .map((line) => line?.tracking_unit_id)
      .filter(Boolean),
  ));

  if (!trackingUnitIds.length) {
    return new Map();
  }

  const attachmentQuery = includeAttachments
    ? client
      .from('ir_attachments')
      .select('id, related_id, document_type, bucket_name, file_path, original_file_name, mime_type, created_at')
      .eq('tenant_id', tenantId)
      .eq('related_model', 'stock_tracking_units')
      .in('related_id', trackingUnitIds)
      .in('document_type', ['chassis_photo', 'engine_photo'])
      .eq('is_active', true)
    : Promise.resolve({ data: [], error: null });

  const [
    { data: units, error: unitsError },
    { data: identifierRows, error: identifiersError },
    { data: licenseRows, error: licensesError },
    { data: attachmentRows, error: attachmentsError },
  ] = await Promise.all([
    client
      .from('stock_tracking_units')
      .select('id, tracking_number, status, data_status, incomplete_reason, paperwork_processor_partner_id')
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
    attachmentQuery,
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
        dataStatus: unit.data_status || 'complete',
        incompleteReason: unit.incomplete_reason || null,
        isIncomplete: ['incomplete', 'needs_review'].includes(unit.data_status),
        paperworkProcessorPartnerId: unit.paperwork_processor_partner_id || null,
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

export function normalizeSalePayment(record) {
  return {
    id: record.id,
    tenantId: record.tenant_id,
    saleId: String(record.ref || '').replace(/^showroom_sale:/, ''),
    accountMoveId: record.id,
    amount: toNumber(record.amount_total),
    paymentDate: record.invoice_date || record.date || record.created_at,
    paymentMethod: record.pay_method || '',
    notes: record.notes || '',
    createdBy: record.created_by,
    createdAt: record.created_at,
  };
}

export function normalizeSale(record, customerMap, linesMap = new Map(), paymentsMap = new Map(), accountingMap = new Map()) {
  const customer = customerMap.get(record.customer_id) ?? null;
  const payments = paymentsMap.get(record.id) || [];
  const totalAmount = toNumber(record.total_amount);
  const accounting = accountingMap.get(record.id) || null;
  const paidAmount = accounting
    ? accounting.paidAmount
    : payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
  const remainingAmount = accounting
    ? accounting.remainingAmount
    : Math.max(totalAmount - paidAmount, 0);

  return {
    id: record.id,
    tenantId: record.tenant_id,
    branchId: record.branch_id,
    customerId: record.customer_id,
    saleDate: record.sale_date,
    status: record.status || 'pending',
    totalAmount,
    paidAmount,
    remainingAmount,
    notes: record.notes || '',
    accountMoveId: record.account_move_id,
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    showroomConfigId: record.showroom_config_id,
    customer,
    items: linesMap.get(record.id) || [],
    payments,
  };
}

export async function loadCustomersMap(client, tenantId, sales) {
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

export async function loadSaleLinesMap(client, tenantId, sales, { includeAttachments = true } = {}) {
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
    loadTrackingDetailsMap(client, tenantId, lines, { includeAttachments }),
    loadTrackingUnitAttributesMap(client, tenantId, lines),
  ]);

  return lines.reduce((map, line) => {
    const current = map.get(line.sale_id) || [];
    current.push(normalizeSaleLine(line, productMap, attributesMap, variantAttributesMap, trackingDetailsMap, trackingUnitAttributesMap));
    map.set(line.sale_id, current);
    return map;
  }, new Map());
}

export async function loadSalePaymentsMap(client, tenantId, sales) {
  const saleIds = Array.from(new Set(
    (Array.isArray(sales) ? sales : [sales])
      .map((sale) => sale?.id)
      .filter(Boolean),
  ));

  if (!saleIds.length) {
    return new Map();
  }

  const saleRefs = saleIds.map((saleId) => `showroom_sale:${saleId}`);
  const { data, error } = await client
    .from('account_moves')
    .select(SALE_PAYMENT_MOVE_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('move_type', 'payment')
    .eq('state', 'posted')
    .in('ref', saleRefs)
    .order('created_at', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, paymentMove) => {
    const payment = normalizeSalePayment(paymentMove);
    const current = map.get(payment.saleId) || [];
    current.push(payment);
    map.set(payment.saleId, current);
    return map;
  }, new Map());
}

export async function loadSaleAccountingMap(client, tenantId, sales) {
  const saleRows = Array.isArray(sales) ? sales : [sales].filter(Boolean);
  const saleIds = saleRows.map((sale) => sale?.id).filter(Boolean);

  if (!saleIds.length) {
    return new Map();
  }

  const chunk = (values, size = 100) => (
    Array.from({ length: Math.ceil(values.length / size) }, (_, index) => values.slice(index * size, (index + 1) * size))
  );
  const accountMoveIds = [...new Set(saleRows.map((sale) => sale?.account_move_id).filter(Boolean))];
  const [moveIdResults, refResults, receivableAccountsResult] = await Promise.all([
    Promise.all(chunk(accountMoveIds).map((ids) => client
      .from('account_moves')
      .select('id, ref')
      .eq('tenant_id', tenantId)
      .eq('move_type', 'sale')
      .eq('state', 'posted')
      .in('id', ids))),
    Promise.all(chunk(saleIds.map((saleId) => `showroom_sale:${saleId}`)).map((refs) => client
      .from('account_moves')
      .select('id, ref')
      .eq('tenant_id', tenantId)
      .eq('move_type', 'sale')
      .eq('state', 'posted')
      .in('ref', refs))),
    client
      .from('account_accounts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('code', '114001'),
  ]);

  const moveResults = [...moveIdResults, ...refResults];
  const failedResult = [...moveResults, receivableAccountsResult].find((result) => result.error);
  if (failedResult?.error) throw failedResult.error;

  const accountingMoves = moveResults.flatMap((result) => result.data || []);
  const movesById = new Map(accountingMoves.map((move) => [move.id, move]));
  const movesByRef = new Map(accountingMoves.filter((move) => move.ref).map((move) => [move.ref, move]));
  const moveBySaleId = new Map();

  saleRows.forEach((sale) => {
    const move = movesById.get(sale.account_move_id) || movesByRef.get(`showroom_sale:${sale.id}`) || null;
    if (move) moveBySaleId.set(sale.id, move);
  });

  const linkedMoveIds = [...new Set([...moveBySaleId.values()].map((move) => move.id))];
  const receivableAccountIds = (receivableAccountsResult.data || []).map((account) => account.id);
  const lineResults = linkedMoveIds.length && receivableAccountIds.length
    ? await Promise.all(chunk(linkedMoveIds).map((ids) => client
      .from('account_move_lines')
      .select('id, move_id, debit')
      .eq('tenant_id', tenantId)
      .in('move_id', ids)
      .in('account_id', receivableAccountIds)
      .gt('debit', 0)))
    : [];
  const failedLineResult = lineResults.find((result) => result.error);
  if (failedLineResult?.error) throw failedLineResult.error;

  const receivableLines = lineResults.flatMap((result) => result.data || []);
  const lineIds = receivableLines.map((line) => line.id);
  const reconcileResults = lineIds.length
    ? await Promise.all(chunk(lineIds).map((ids) => client
      .from('account_partial_reconcile')
      .select('debit_move_id, amount')
      .eq('tenant_id', tenantId)
      .in('debit_move_id', ids)))
    : [];
  const failedReconcileResult = reconcileResults.find((result) => result.error);
  if (failedReconcileResult?.error) throw failedReconcileResult.error;

  const paidByLineId = new Map();
  reconcileResults.flatMap((result) => result.data || []).forEach((row) => {
    paidByLineId.set(row.debit_move_id, toNumber(paidByLineId.get(row.debit_move_id)) + toNumber(row.amount));
  });

  const paidByMoveId = new Map();
  const originalByMoveId = new Map();
  receivableLines.forEach((line) => {
    paidByMoveId.set(line.move_id, toNumber(paidByMoveId.get(line.move_id)) + toNumber(paidByLineId.get(line.id)));
    originalByMoveId.set(line.move_id, toNumber(originalByMoveId.get(line.move_id)) + toNumber(line.debit));
  });

  return saleRows.reduce((map, sale) => {
    const move = moveBySaleId.get(sale.id) || null;
    const paidAmount = Math.round(toNumber(paidByMoveId.get(move?.id)) * 100) / 100;
    const invoiceReceivableAmount = move
      ? toNumber(originalByMoveId.get(move.id))
      : toNumber(sale.total_amount);

    map.set(sale.id, {
      paidAmount,
      remainingAmount: Math.max(Math.round((invoiceReceivableAmount - paidAmount) * 100) / 100, 0),
    });
    return map;
  }, new Map());
}

export async function loadPaperworkDocumentInvoiceMap(client, tenantId, documents) {
  const sourceDocuments = Array.isArray(documents) ? documents : [];
  const requestIds = [...new Set(sourceDocuments
    .filter((document) => !(document.sale_id || document.saleId))
    .map((document) => document.paperwork_request_id || document.paperworkRequestId)
    .filter(Boolean))];

  const chunks = Array.from(
    { length: Math.ceil(requestIds.length / 100) },
    (_, index) => requestIds.slice(index * 100, (index + 1) * 100),
  );
  const requestResults = await Promise.all(chunks.map((ids) => client
    .from('paperwork_requests')
    .select('id, sale_id, sale_line_id')
    .eq('tenant_id', tenantId)
    .in('id', ids)));
  const failedRequestResult = requestResults.find((result) => result.error);
  if (failedRequestResult?.error) throw failedRequestResult.error;

  const requests = requestResults.flatMap((result) => result.data || []);
  const saleLineIds = [...new Set(requests
    .filter((request) => !request.sale_id)
    .map((request) => request.sale_line_id)
    .filter(Boolean))];
  const saleLineChunks = Array.from(
    { length: Math.ceil(saleLineIds.length / 100) },
    (_, index) => saleLineIds.slice(index * 100, (index + 1) * 100),
  );
  const saleLineResults = await Promise.all(saleLineChunks.map((ids) => client
    .from('showroom_sale_lines')
    .select('id, sale_id')
    .eq('tenant_id', tenantId)
    .in('id', ids)));
  const failedSaleLineResult = saleLineResults.find((result) => result.error);
  if (failedSaleLineResult?.error) throw failedSaleLineResult.error;
  const saleLineMap = new Map(saleLineResults
    .flatMap((result) => result.data || [])
    .map((line) => [line.id, line]));
  const requestsMap = new Map(requests.map((request) => [request.id, request]));
  const saleIdByDocumentId = new Map(sourceDocuments.map((document) => {
    const requestId = document.paperwork_request_id || document.paperworkRequestId;
    const request = requestsMap.get(requestId);
    return [
      document.id,
      document.sale_id
        || document.saleId
        || request?.sale_id
        || saleLineMap.get(request?.sale_line_id)?.sale_id
        || null,
    ];
  }));
  const saleIds = [...new Set([...saleIdByDocumentId.values()].filter(Boolean))];
  if (!saleIds.length) return new Map();

  const saleChunks = Array.from(
    { length: Math.ceil(saleIds.length / 100) },
    (_, index) => saleIds.slice(index * 100, (index + 1) * 100),
  );
  const saleResults = await Promise.all(saleChunks.map((ids) => client
    .from('showroom_sales')
    .select('id, sale_number, total_amount, account_move_id')
    .eq('tenant_id', tenantId)
    .in('id', ids)));
  const failedSaleResult = saleResults.find((result) => result.error);
  if (failedSaleResult?.error) throw failedSaleResult.error;

  const sales = saleResults.flatMap((result) => result.data || []);
  const salesMap = new Map(sales.map((sale) => [sale.id, sale]));
  const accountingMap = await loadSaleAccountingMap(client, tenantId, sales);

  return sourceDocuments.reduce((map, document) => {
    const sale = salesMap.get(saleIdByDocumentId.get(document.id));
    if (!sale) return map;
    const accounting = accountingMap.get(sale.id) || {};
    map.set(document.id, {
      saleId: sale.id,
      saleNumber: sale.sale_number || '',
      totalAmount: toNumber(sale.total_amount),
      paidAmount: toNumber(accounting.paidAmount),
      remainingAmount: toNumber(accounting.remainingAmount),
    });
    return map;
  }, new Map());
}
