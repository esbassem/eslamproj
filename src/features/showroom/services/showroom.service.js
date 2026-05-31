import { requireSupabase } from '@/core/lib/supabase';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';
import { isInventoryInstalled } from '@/core/lib/inventoryGuard';

const SALE_SELECT = `
  id,
  tenant_id,
  branch_id,
  customer_id,
  showroom_config_id,
  sale_number,
  sale_date,
  status,
  total_amount,
  paid_amount,
  remaining_amount,
  notes,
  account_move_id,
  created_by,
  created_at,
  updated_at
`;

const SHOWROOM_CONFIG_COLUMNS = 'id, tenant_id, branch_id, name, code, is_active, journal_id';

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function toMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeConfigCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function requireTenantId(tenantId) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة.');
  }
}

function requireShowroomConfigId(showroomConfigId) {
  if (!showroomConfigId) {
    throw new Error('اختر نقطة معرض أولاً.');
  }
}

function buildConfigPayload({ tenantId, branchId, branch_id, name, code, isActive, is_active, journalId, journal_id } = {}) {
  const payload = {};

  if (tenantId) payload.tenant_id = tenantId;
  if (Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'branchId') || Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'branch_id')) {
    payload.branch_id = branchId ?? branch_id ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'name')) {
    payload.name = String(name ?? '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'code')) {
    payload.code = normalizeConfigCode(code);
  }
  if (Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'isActive') || Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'is_active')) {
    payload.is_active = Boolean(isActive ?? is_active);
  }
  if (Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'journalId') || Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'journal_id')) {
    payload.journal_id = journalId ?? journal_id ?? null;
  }

  return payload;
}

async function ensureConfigCodeUnique(client, tenantId, code, excludeId) {
  const normalizedCode = normalizeConfigCode(code);
  if (!normalizedCode) return;

  let query = client
    .from('showroom_configs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('code', normalizedCode)
    .limit(1);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query;
  if (error) throw error;
  if ((data || []).length) {
    throw new Error('كود نقطة المعرض مستخدم بالفعل داخل نفس الشركة.');
  }
}

function getProductProductId(item) {
  const explicitProductId = item?.productProductId ?? item?.product_product_id ?? item?.productVariantId ?? item?.variantId ?? null;
  if (explicitProductId) return explicitProductId;

  return item?.id ?? null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

function getLineAttributes(item) {
  const attributes = Array.isArray(item?.configuredAttributes) ? item.configuredAttributes : [];

  return attributes
    .map((attribute) => {
      const attributeId = attribute?.attributeId ?? attribute?.attribute_id ?? attribute?.key ?? null;
      const attributeValueId = attribute?.valueId ?? attribute?.value_id ?? null;
      const valueText = attribute?.value ?? attribute?.valueText ?? attribute?.value_text ?? '';

      if (!isUuid(attributeId)) {
        return null;
      }

      return {
        attributeId,
        attributeValueId: isUuid(attributeValueId) ? attributeValueId : null,
        valueText: isUuid(attributeValueId) ? null : String(valueText || '').trim() || null,
      };
    })
    .filter(Boolean)
    .filter((attribute) => attribute.attributeValueId || attribute.valueText);
}

function getLineTrackingIdentifiers(item) {
  const identifiers = Array.isArray(item?.trackingIdentifiers) ? item.trackingIdentifiers : [];

  return identifiers
    .map((identifier) => ({
      identifierTypeId: identifier?.identifierTypeId ?? identifier?.identifier_type_id ?? null,
      label: identifier?.label ?? identifier?.name ?? 'تعريف تتبع',
      code: identifier?.code ?? null,
      value: String(identifier?.value ?? identifier?.valueText ?? identifier?.value_text ?? '').trim(),
      isNotAvailable: Boolean(identifier?.isNotAvailable ?? identifier?.is_not_available),
    }))
    .filter((identifier) => isUuid(identifier.identifierTypeId) && (identifier.value || identifier.isNotAvailable));
}

function getLineLicense(item) {
  if (!item?.requiresLicense && !item?.license) {
    return null;
  }

  const license = item?.license ?? {};
  const status = license.status || license.licenseStatus || license.license_status || '';
  const number = String(license.number ?? license.licenseNumber ?? license.license_number ?? '').trim();
  const expiresAt = license.expiresAt || license.licenseExpiresAt || license.license_expires_at || null;

  if (!status) {
    throw new Error('حالة الترخيص مطلوبة.');
  }

  if (status === 'licensed' && !number) {
    throw new Error('رقم الترخيص مطلوب عندما تكون حالة الترخيص "مرخص".');
  }

  if (status === 'licensed' && !expiresAt) {
    throw new Error('تاريخ انتهاء الترخيص مطلوب عندما تكون حالة الترخيص "مرخص".');
  }

  return {
    license_status: status,
    license_number: number || null,
    license_issued_at: license.issuedAt || license.licenseIssuedAt || license.license_issued_at || null,
    license_expires_at: expiresAt,
    issuing_authority: String(license.issuingAuthority ?? license.issuing_authority ?? '').trim() || null,
    notes: String(license.notes ?? '').trim() || null,
  };
}

function getTrackingNumber(item, trackingIdentifiers = getLineTrackingIdentifiers(item)) {
  const explicitSerial = String(item?.serialNumber ?? item?.serial_number ?? '').trim();
  if (explicitSerial) return explicitSerial;
  return trackingIdentifiers.map((identifier) => identifier.value).filter(Boolean).join(' - ');
}

async function ensureSaleTrackingUnit(client, { tenantId, item, productProductId, saleId, userId }) {
  if ((item?.tracking ?? item?.tracking_type) !== 'serial') {
    return null;
  }

  const trackingIdentifiers = getLineTrackingIdentifiers(item);
  const trackingNumber = getTrackingNumber(item, trackingIdentifiers);

  if (!trackingNumber && !trackingIdentifiers.some((identifier) => identifier.isNotAvailable)) {
    return null;
  }
  const safeTrackingNumber = trackingNumber || `NA-${saleId}-${productProductId}-${String(item?.lineId || Date.now()).replace(/[^a-zA-Z0-9-]/g, '')}`;

  const { data: existingUnits, error: existingError } = await client
    .from('stock_tracking_units')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('product_product_id', productProductId)
    .eq('tracking_number', safeTrackingNumber)
    .limit(1);

  if (existingError) throw existingError;

  let trackingUnit = existingUnits?.[0] ?? null;

  if (trackingUnit?.status === 'sold') {
    throw new Error(`الوحدة "${safeTrackingNumber}" تم بيعها من قبل.`);
  }

  if (trackingUnit) {
    const { data: updatedUnit, error: updateError } = await client
      .from('stock_tracking_units')
      .update({
        status: 'sold',
      })
      .eq('tenant_id', tenantId)
      .eq('id', trackingUnit.id)
      .select('id, status')
      .single();

    if (updateError) throw updateError;
    trackingUnit = updatedUnit;
  } else {
    const { data: createdUnit, error: createError } = await client
      .from('stock_tracking_units')
      .insert([{
        tenant_id: tenantId,
        product_product_id: productProductId,
        tracking_number: safeTrackingNumber,
        tracking_type: 'serial',
        status: 'sold',
        notes: `showroom_sale:${saleId}`,
      }])
      .select('id, status')
      .single();

    if (createError) throw createError;
    trackingUnit = createdUnit;
  }

  if (trackingIdentifiers.length) {
    const currentTenantUserId = await resolveCurrentTenantUserId(client, { tenantId, tenantUserId: userId });
    const { data: existingIdentifiers, error: identifiersFetchError } = await client
      .from('stock_tracking_unit_identifiers')
      .select('identifier_type_id')
      .eq('tenant_id', tenantId)
      .eq('tracking_unit_id', trackingUnit.id);

    if (identifiersFetchError) throw identifiersFetchError;

    const existingIdentifierIds = new Set((existingIdentifiers || []).map((identifier) => identifier.identifier_type_id));
    const identifierRows = trackingIdentifiers
      .filter((identifier) => !existingIdentifierIds.has(identifier.identifierTypeId))
      .map((identifier) => ({
        tenant_id: tenantId,
        tracking_unit_id: trackingUnit.id,
        identifier_type_id: identifier.identifierTypeId,
        value: identifier.isNotAvailable ? null : identifier.value,
        is_not_available: identifier.isNotAvailable,
        created_by: currentTenantUserId,
      }));

    if (identifierRows.length) {
      const { error: identifiersInsertError } = await client
        .from('stock_tracking_unit_identifiers')
        .insert(identifierRows);

      if (identifiersInsertError) {
        if (identifiersInsertError.code === '23505') {
          throw new Error('هذه القيمة مستخدمة بالفعل في وحدة أخرى.');
        }
        throw identifiersInsertError;
      }
    }
  }

  return trackingUnit.id;
}

async function saveTrackingUnitLicense(client, { tenantId, item, trackingUnitId, userId }) {
  const license = getLineLicense(item);
  if (!license) return;

  if (!trackingUnitId) {
    throw new Error('لا يمكن حفظ الترخيص بدون وحدة تتبع مرتبطة بالمنتج.');
  }

  const currentTenantUserId = await resolveCurrentTenantUserId(client, { tenantId, tenantUserId: userId });

  const { error: updateError } = await client
    .from('stock_tracking_unit_licenses')
    .update({ is_current: false, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('tracking_unit_id', trackingUnitId)
    .eq('is_current', true);

  if (updateError) throw updateError;

  const { error: insertError } = await client
    .from('stock_tracking_unit_licenses')
    .insert({
      tenant_id: tenantId,
      tracking_unit_id: trackingUnitId,
      ...license,
      is_current: true,
      created_by: currentTenantUserId,
    });

  if (insertError) {
    if (insertError.code === '23505') {
      throw new Error('رقم الترخيص مستخدم بالفعل داخل نفس الشركة.');
    }
    throw insertError;
  }
}

function buildSaleLine({ tenantId, saleId, item, trackingUnitId }) {
  const quantity = Math.max(toMoney(item?.quantity) || 1, 1);
  const unitPrice = Math.max(toMoney(item?.price), 0);

  return {
    tenant_id: tenantId,
    sale_id: saleId,
    product_product_id: getProductProductId(item),
    tracking_unit_id: trackingUnitId || null,
    ownership_name: item?.ownershipTransferName?.trim() || null,
    description: item?.name || item?.displayName || null,
    quantity,
    unit_price: unitPrice,
    total: unitPrice * quantity,
  };
}

async function attachLineAttributes(client, tenantId, lines) {
  const saleLines = Array.isArray(lines) ? lines : [];
  const lineIds = saleLines.map((line) => line.id).filter(Boolean);

  if (!lineIds.length) {
    return saleLines;
  }

  const { data: attributeRows, error } = await client
    .from('transaction_line_attributes')
    .select('id, transaction_line_id, attribute_id, attribute_value_id, value_text')
    .eq('tenant_id', tenantId)
    .in('transaction_line_id', lineIds);

  if (error) throw error;

  const rows = attributeRows || [];
  const attributeIds = [...new Set(rows.map((row) => row.attribute_id).filter(Boolean))];
  const valueIds = [...new Set(rows.map((row) => row.attribute_value_id).filter(Boolean))];

  const [{ data: attributes, error: attributesError }, { data: values, error: valuesError }] = await Promise.all([
    attributeIds.length
      ? client.from('product_attributes').select('id, name').eq('tenant_id', tenantId).in('id', attributeIds)
      : Promise.resolve({ data: [], error: null }),
    valueIds.length
      ? client.from('product_attribute_values').select('id, name').eq('tenant_id', tenantId).in('id', valueIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (attributesError) throw attributesError;
  if (valuesError) throw valuesError;

  const attributesById = new Map((attributes || []).map((attribute) => [attribute.id, attribute]));
  const valuesById = new Map((values || []).map((value) => [value.id, value]));
  const lineAttributesByLineId = new Map();

  rows.forEach((row) => {
    const current = lineAttributesByLineId.get(row.transaction_line_id) || [];
    const attribute = attributesById.get(row.attribute_id);
    const value = row.attribute_value_id ? valuesById.get(row.attribute_value_id) : null;

    current.push({
      id: row.id,
      key: row.attribute_id,
      attributeId: row.attribute_id,
      label: attribute?.name || 'خاصية',
      valueId: row.attribute_value_id,
      value: value?.name || row.value_text || '',
    });

    lineAttributesByLineId.set(row.transaction_line_id, current);
  });

  return saleLines.map((line) => ({
    ...line,
    configuredAttributes: lineAttributesByLineId.get(line.id) || [],
  }));
}

async function attachLineTrackingIdentifiers(client, tenantId, lines) {
  const saleLines = Array.isArray(lines) ? lines : [];
  const trackingUnitIds = [...new Set(saleLines.map((line) => line.tracking_unit_id).filter(Boolean))];

  if (!trackingUnitIds.length) {
    return saleLines;
  }

  const [{ data: units, error: unitsError }, { data: identifierRows, error: identifiersError }] = await Promise.all([
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
  ]);

  if (unitsError) throw unitsError;
  if (identifiersError) throw identifiersError;

  const identifierTypeIds = [...new Set((identifierRows || []).map((row) => row.identifier_type_id).filter(Boolean))];
  const { data: identifierTypes, error: typesError } = identifierTypeIds.length
    ? await client
      .from('product_tracking_identifier_types')
      .select('id, name, code')
      .eq('tenant_id', tenantId)
      .in('id', identifierTypeIds)
    : { data: [], error: null };

  if (typesError) throw typesError;

  const unitsById = new Map((units || []).map((unit) => [unit.id, unit]));
  const typesById = new Map((identifierTypes || []).map((type) => [type.id, type]));
  const identifiersByUnitId = new Map();

  (identifierRows || []).forEach((row) => {
    const current = identifiersByUnitId.get(row.tracking_unit_id) || [];
    const type = typesById.get(row.identifier_type_id);

    current.push({
      id: row.id,
      identifierTypeId: row.identifier_type_id,
      label: type?.name || 'تعريف تتبع',
      code: type?.code || '',
      value: row.value || '',
      isNotAvailable: row.is_not_available ?? false,
    });

    identifiersByUnitId.set(row.tracking_unit_id, current);
  });

  return saleLines.map((line) => {
    const unit = unitsById.get(line.tracking_unit_id);
    const trackingIdentifiers = identifiersByUnitId.get(line.tracking_unit_id) || [];

    return {
      ...line,
      trackingUnit: unit ? {
        id: unit.id,
        trackingNumber: unit.tracking_number || '',
        status: unit.status || '',
      } : null,
      serialNumber: unit?.tracking_number || '',
      trackingIdentifiers,
    };
  });
}

async function attachLineDetails(client, tenantId, lines) {
  const linesWithAttributes = await attachLineAttributes(client, tenantId, lines || []);
  return attachLineTrackingIdentifiers(client, tenantId, linesWithAttributes);
}

async function restoreQuantityStock(client, { tenantId, productProductId, quantity }) {
  const safeQuantity = Math.max(toMoney(quantity), 0);
  if (!productProductId || safeQuantity <= 0) return;

  const { data: existingQuant, error: quantError } = await client
    .from('stock_quants')
    .select('id, quantity_on_hand, reserved_quantity')
    .eq('tenant_id', tenantId)
    .eq('product_product_id', productProductId)
    .limit(1)
    .maybeSingle();

  if (quantError) throw quantError;

  if (!existingQuant) {
    const { error: insertError } = await client
      .from('stock_quants')
      .insert({
        tenant_id: tenantId,
        product_product_id: productProductId,
        quantity_on_hand: safeQuantity,
      });

    if (insertError) throw insertError;
    return;
  }

  const currentQuantity = toMoney(existingQuant.quantity_on_hand);
  const nextQuantity = currentQuantity + safeQuantity;
  const reservedQuantity = toMoney(existingQuant.reserved_quantity);

  if (currentQuantity < 0 && nextQuantity === 0 && reservedQuantity === 0) {
    const { error: deleteError } = await client
      .from('stock_quants')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', existingQuant.id);

    if (deleteError) throw deleteError;
    return;
  }

  const { error: updateError } = await client
    .from('stock_quants')
    .update({ quantity_on_hand: nextQuantity, updated_at: new Date().toISOString() })
    .eq('tenant_id', tenantId)
    .eq('id', existingQuant.id);

  if (updateError) throw updateError;
}

async function restoreTrackingUnits(client, { tenantId, saleId, saleCreatedAt, lines }) {
  const trackingUnitIds = [...new Set((lines || []).map((line) => line.tracking_unit_id).filter(Boolean))];
  if (!trackingUnitIds.length) return [];

  const { data: units, error: unitsError } = await client
    .from('stock_tracking_units')
    .select('id, notes, created_at')
    .eq('tenant_id', tenantId)
    .in('id', trackingUnitIds);

  if (unitsError) throw unitsError;

  const saleCreatedTime = new Date(saleCreatedAt || Date.now()).getTime();
  const createdForSaleIds = [];
  const restoreIds = [];

  (units || []).forEach((unit) => {
    const unitCreatedTime = new Date(unit.created_at || 0).getTime();
    const isMarkedForSale = unit.notes === `showroom_sale:${saleId}`;
    const wasCreatedWithSale = Number.isFinite(unitCreatedTime) && unitCreatedTime >= saleCreatedTime - 5000;

    if (isMarkedForSale || wasCreatedWithSale) {
      createdForSaleIds.push(unit.id);
    } else {
      restoreIds.push(unit.id);
    }
  });

  if (restoreIds.length) {
    const { error: restoreError } = await client
      .from('stock_tracking_units')
      .update({ status: 'in_stock', updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .in('id', restoreIds);

    if (restoreError) throw restoreError;
  }

  return createdForSaleIds;
}

async function deleteTrackingUnits(client, { tenantId, trackingUnitIds }) {
  const ids = [...new Set((trackingUnitIds || []).filter(Boolean))];
  if (!ids.length) return;

  const { error: identifiersDeleteError } = await client
    .from('stock_tracking_unit_identifiers')
    .delete()
    .eq('tenant_id', tenantId)
    .in('tracking_unit_id', ids);

  if (identifiersDeleteError) throw identifiersDeleteError;

  const { error: unitsDeleteError } = await client
    .from('stock_tracking_units')
    .delete()
    .eq('tenant_id', tenantId)
    .in('id', ids);

  if (unitsDeleteError) throw unitsDeleteError;
}

async function attachSaleLines(client, tenantId, sales, showroomConfigId) {
  const saleRows = Array.isArray(sales) ? sales : [sales].filter(Boolean);
  const saleIds = saleRows.map((sale) => sale.id).filter(Boolean);

  if (!saleIds.length) {
    return Array.isArray(sales) ? saleRows : saleRows[0] || null;
  }

  const { data: lines, error } = await client
    .from('showroom_sale_lines')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('sale_id', saleIds)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const linesWithAttributes = await attachLineDetails(client, tenantId, lines || []);
  const linesBySaleId = new Map();

  linesWithAttributes.forEach((line) => {
    const current = linesBySaleId.get(line.sale_id) || [];
    current.push(line);
    linesBySaleId.set(line.sale_id, current);
  });

  const salesWithLines = saleRows.map((sale) => ({
    ...sale,
    lines: linesBySaleId.get(sale.id) || [],
  }));

  return Array.isArray(sales) ? salesWithLines : salesWithLines[0] || null;
}

async function attachCustomers(client, tenantId, sales) {
  const saleRows = Array.isArray(sales) ? sales : [sales].filter(Boolean);
  const customerIds = [...new Set(saleRows.map((sale) => sale.customer_id).filter(Boolean))];

  if (!customerIds.length) {
    return Array.isArray(sales) ? saleRows : saleRows[0] || null;
  }

  const { data: customers, error } = await client
    .from('partners')
    .select('id, name, phone1, phone2, address, national_id')
    .eq('tenant_id', tenantId)
    .in('id', customerIds);

  if (error) throw error;

  const customersById = new Map((customers || []).map((customer) => [customer.id, customer]));
  const salesWithCustomers = saleRows.map((sale) => ({
    ...sale,
    customer: customersById.has(sale.customer_id)
      ? {
          ...customersById.get(sale.customer_id),
          phone: customersById.get(sale.customer_id)?.phone1 || customersById.get(sale.customer_id)?.phone2 || '',
          nationalId: customersById.get(sale.customer_id)?.national_id || '',
        }
      : null,
  }));

  return Array.isArray(sales) ? salesWithCustomers : salesWithCustomers[0] || null;
}

export const showroomService = {
  async listConfigs({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const { data, error } = await client
      .from('showroom_configs')
      .select(SHOWROOM_CONFIG_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async listBranches({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const { data, error } = await client
      .from('branches')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async listPaymentJournals({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const { data, error } = await client
      .from('account_journals')
      .select('id, name, code, type, is_active')
      .eq('tenant_id', tenantId)
      .in('type', ['cash', 'bank'])
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async createConfig(data = {}) {
    const tenantId = data.tenantId ?? data.tenant_id;
    requireTenantId(tenantId);

    const payload = buildConfigPayload({ ...data, tenantId, isActive: data.isActive ?? data.is_active ?? true });
    if (!payload.name) throw new Error('اكتب اسم نقطة المعرض.');
    if (!payload.code) throw new Error('اكتب كود نقطة المعرض.');

    const client = requireSupabase();
    await ensureConfigCodeUnique(client, tenantId, payload.code);

    const { data: createdConfig, error } = await client
      .from('showroom_configs')
      .insert(payload)
      .select(SHOWROOM_CONFIG_COLUMNS)
      .single();

    if (error) throw error;
    return createdConfig;
  },

  async updateConfig(id, data = {}) {
    const tenantId = data.tenantId ?? data.tenant_id;
    requireTenantId(tenantId);
    if (!id) throw new Error('تعذر تحديد نقطة المعرض.');

    const client = requireSupabase();
    const { data: current, error: currentError } = await client
      .from('showroom_configs')
      .select(SHOWROOM_CONFIG_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (currentError) throw currentError;

    const payload = buildConfigPayload(data);
    const nextName = Object.prototype.hasOwnProperty.call(payload, 'name') ? payload.name : current.name;
    const nextCode = Object.prototype.hasOwnProperty.call(payload, 'code') ? payload.code : current.code;

    if (!nextName) throw new Error('اكتب اسم نقطة المعرض.');
    if (!nextCode) throw new Error('اكتب كود نقطة المعرض.');
    await ensureConfigCodeUnique(client, tenantId, nextCode, id);

    delete payload.tenant_id;

    const { data: updatedConfig, error } = await client
      .from('showroom_configs')
      .update(payload)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select(SHOWROOM_CONFIG_COLUMNS)
      .single();

    if (error) throw error;
    return updatedConfig;
  },

  async toggleConfigActive({ tenantId, id, isActive } = {}) {
    return showroomService.updateConfig(id, { tenantId, isActive });
  },

  async listConfigActivity({ tenantId, configIds } = {}) {
    requireTenantId(tenantId);
    const scopedConfigIds = Array.isArray(configIds) ? configIds.filter(Boolean) : [];

    if (!scopedConfigIds.length) {
      return {};
    }

    const client = requireSupabase();
    const { data, error } = await client
      .from('showroom_sales')
      .select('showroom_config_id')
      .eq('tenant_id', tenantId)
      .in('showroom_config_id', scopedConfigIds);

    if (error) throw error;

    return (data || []).reduce((accumulator, row) => {
      if (row?.showroom_config_id) {
        accumulator[row.showroom_config_id] = true;
      }
      return accumulator;
    }, {});
  },

  async deleteConfig({ tenantId, id } = {}) {
    requireTenantId(tenantId);
    if (!id) throw new Error('تعذر تحديد نقطة المعرض.');

    const client = requireSupabase();
    const { data: linkedSales, error: linkedSalesError } = await client
      .from('showroom_sales')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', id)
      .limit(1);

    if (linkedSalesError) throw linkedSalesError;

    if ((linkedSales || []).length) {
      throw new Error('لا يمكن حذف النقطة بعد تسجيل عمليات عليها. يمكنك تعطيلها فقط.');
    }

    const { error } = await client
      .from('showroom_configs')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw error;
    return true;
  },

  async softDeleteConfig({ tenantId, id } = {}) {
    return showroomService.deleteConfig({ tenantId, id });
  },

  async getSales({ tenantId, limit = 20, status, showroomConfigId } = {}) {
    requireTenantId(tenantId);
    requireShowroomConfigId(showroomConfigId);
    const client = requireSupabase();
    let query = client
      .from('showroom_sales')
      .select(SALE_SELECT)
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', showroomConfigId);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const salesWithCustomers = await attachCustomers(client, tenantId, data || []);
    return attachSaleLines(client, tenantId, salesWithCustomers, showroomConfigId);
  },

  async getInvoices(params = {}) {
    return showroomService.getSales(params);
  },

  async createSale({
    tenantId,
    customerId,
    items,
    totalAmount,
    paidAmount = 0,
    paymentMethodId,
    contractNote,
    notes,
    userId,
    showroomConfigId,
  }) {
    requireTenantId(tenantId);
    requireShowroomConfigId(showroomConfigId);
    const client = requireSupabase();
    const saleItems = Array.isArray(items) ? items : [];
    const safeTotalAmount = Math.max(toMoney(totalAmount), 0);
    const safePaidAmount = Math.min(Math.max(toMoney(paidAmount), 0), safeTotalAmount);
    const remainingAmount = Math.max(safeTotalAmount - safePaidAmount, 0);
    const saleDate = todayISODate();
    const { data: showroomConfig, error: configError } = await client
      .from('showroom_configs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', showroomConfigId)
      .eq('is_active', true)
      .single();

    if (configError) throw configError;

    const { data: sale, error: saleError } = await client
      .from('showroom_sales')
      .insert([{
        tenant_id: tenantId,
        customer_id: customerId || null,
        showroom_config_id: showroomConfig.id,
        sale_date: saleDate,
        status: 'confirmed',
        total_amount: safeTotalAmount,
        paid_amount: safePaidAmount,
        remaining_amount: remainingAmount,
        notes: contractNote?.trim() || notes?.trim() || null,
        account_move_id: null,
      }])
      .select(SALE_SELECT)
      .single();

    if (saleError) throw saleError;

    const preparedSaleItems = await Promise.all(saleItems.map(async (item) => {
      const productProductId = getProductProductId(item);
      const trackingUnitId = productProductId
        ? await ensureSaleTrackingUnit(client, {
          tenantId,
          item,
          productProductId,
          saleId: sale.id,
          userId,
        })
        : null;

      await saveTrackingUnitLicense(client, {
        tenantId,
        item,
        trackingUnitId,
        userId,
      });

      return {
        item,
        trackingUnitId,
      };
    }));

    const lineRows = preparedSaleItems.map(({ item, trackingUnitId }) => buildSaleLine({
      tenantId,
      saleId: sale.id,
      showroomConfigId: showroomConfig.id,
      item,
      trackingUnitId,
    }));

    let lines = [];
    if (lineRows.length) {
      const { data: createdLines, error: linesError } = await client
        .from('showroom_sale_lines')
        .insert(lineRows)
        .select();

      if (linesError) throw linesError;
      lines = (createdLines || []).map((line, index) => ({
        ...line,
        serialNumber: saleItems[index]?.serialNumber || '',
        trackingIdentifiers: Array.isArray(saleItems[index]?.trackingIdentifiers) ? saleItems[index].trackingIdentifiers : [],
      }));

      const attributeRows = lines.flatMap((line, index) => {
        const itemAttributes = getLineAttributes(saleItems[index]);

        return itemAttributes.map((attribute) => ({
          tenant_id: tenantId,
          transaction_line_id: line.id,
          attribute_id: attribute.attributeId,
          attribute_value_id: attribute.attributeValueId,
          value_text: attribute.valueText,
        }));
      });

      if (attributeRows.length) {
        const { error: attributesError } = await client
          .from('transaction_line_attributes')
          .insert(attributeRows);

        if (attributesError) throw attributesError;
      }

      lines = await attachLineDetails(client, tenantId, lines);
    }

    let payments = [];
    if (safePaidAmount > 0) {
      const { data: createdPayments, error: paymentError } = await client
        .from('showroom_sale_payments')
        .insert([{
          tenant_id: tenantId,
          sale_id: sale.id,
          amount: safePaidAmount,
          payment_date: saleDate,
          payment_method: paymentMethodId || null,
          notes: null,
        }])
        .select();

      if (paymentError) throw paymentError;
      payments = createdPayments || [];
    }

    const saleWithCustomer = await attachCustomers(client, tenantId, sale);

    // Create stock moves if the inventory module is installed
    const inventoryActive = await isInventoryInstalled(tenantId);
    if (inventoryActive) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const saleItem = saleItems[i] ?? {};
        const productProductId = line.product_product_id ?? getProductProductId(saleItem);
        const isService = (saleItem?.productType ?? saleItem?.product_type) === 'service';

        if (!isService && productProductId) {
          const quantity = Math.max(toMoney(line.quantity) || 1, 1);
          const isSerial = (saleItem?.tracking ?? saleItem?.tracking_type) === 'serial' || Boolean(line.tracking_unit_id);

          // Record the outgoing stock move
          await client.from('stock_moves').insert({
            tenant_id: tenantId,
            product_product_id: productProductId,
            move_type: 'out',
            quantity,
            created_by: userId ?? null,
            notes: `showroom_sale:${sale.id}`,
          });

          // Decrease quant (showroom allows selling without stock validation)
          if (!isSerial) {
            const { data: existingQuant } = await client
              .from('stock_quants')
              .select('id, quantity_on_hand')
              .eq('tenant_id', tenantId)
              .eq('product_product_id', productProductId)
              .limit(1)
              .maybeSingle();

            if (existingQuant) {
              const nextQty = Number(existingQuant.quantity_on_hand) - quantity;
              await client.from('stock_quants').update({ quantity_on_hand: nextQty }).eq('id', existingQuant.id);
            } else {
              await client.from('stock_quants').insert({
                tenant_id: tenantId,
                product_product_id: productProductId,
                quantity_on_hand: -quantity,
              });
            }
          }
        }
      }
    }

    return {
      ...saleWithCustomer,
      lines,
      payments,
    };
  },

  async getSaleDetails({ tenantId, saleId, showroomConfigId }) {
    requireTenantId(tenantId);
    requireShowroomConfigId(showroomConfigId);
    const client = requireSupabase();
    const { data: sale, error: saleError } = await client
      .from('showroom_sales')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', showroomConfigId)
      .eq('id', saleId)
      .single();

    if (saleError) throw saleError;

    const [{ data: lines, error: linesError }, { data: payments, error: paymentsError }] = await Promise.all([
      client
        .from('showroom_sale_lines')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('sale_id', saleId)
        .order('created_at', { ascending: true }),
      client
        .from('showroom_sale_payments')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('sale_id', saleId)
        .order('created_at', { ascending: true }),
    ]);

    if (linesError) throw linesError;
    if (paymentsError) throw paymentsError;

    const saleWithCustomer = await attachCustomers(client, tenantId, sale);
    const linesWithAttributes = await attachLineDetails(client, tenantId, lines || []);

    return {
      ...saleWithCustomer,
      lines: linesWithAttributes,
      payments: payments || [],
    };
  },

  async deleteSale({ tenantId, saleId, showroomConfigId }) {
    requireTenantId(tenantId);
    requireShowroomConfigId(showroomConfigId);
    const client = requireSupabase();

    const { data: sale, error: saleError } = await client
      .from('showroom_sales')
      .select('id, tenant_id, showroom_config_id, created_at')
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', showroomConfigId)
      .eq('id', saleId)
      .single();

    if (saleError) throw saleError;

    const { data: lines, error: linesError } = await client
      .from('showroom_sale_lines')
      .select('id, product_product_id, tracking_unit_id, quantity')
      .eq('tenant_id', tenantId)
      .eq('sale_id', saleId);

    if (linesError) throw linesError;

    const saleLines = lines || [];
    const lineIds = saleLines.map((line) => line.id).filter(Boolean);

    const trackingUnitIdsToDelete = await restoreTrackingUnits(client, {
      tenantId,
      saleId,
      saleCreatedAt: sale.created_at,
      lines: saleLines,
    });

    const quantityLines = saleLines.filter((line) => !line.tracking_unit_id);
    for (const line of quantityLines) {
      await restoreQuantityStock(client, {
        tenantId,
        productProductId: line.product_product_id,
        quantity: line.quantity,
      });
    }

    const { error: movesDeleteError } = await client
      .from('stock_moves')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('notes', `showroom_sale:${saleId}`);

    if (movesDeleteError) throw movesDeleteError;

    if (lineIds.length) {
      const { error: attributesDeleteError } = await client
        .from('transaction_line_attributes')
        .delete()
        .eq('tenant_id', tenantId)
        .in('transaction_line_id', lineIds);

      if (attributesDeleteError) throw attributesDeleteError;
    }

    const { error: paymentsDeleteError } = await client
      .from('showroom_sale_payments')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('sale_id', saleId);

    if (paymentsDeleteError) throw paymentsDeleteError;

    const { error: linesDeleteError } = await client
      .from('showroom_sale_lines')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('sale_id', saleId);

    if (linesDeleteError) throw linesDeleteError;

    await deleteTrackingUnits(client, {
      tenantId,
      trackingUnitIds: trackingUnitIdsToDelete,
    });

    const { error: saleDeleteError } = await client
      .from('showroom_sales')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', showroomConfigId)
      .eq('id', saleId);

    if (saleDeleteError) throw saleDeleteError;

    return { ok: true, saleId };
  },

  async paySaleRemaining({ tenantId, saleId, showroomConfigId, amount, notes, paymentMethod = 'دفعة' }) {
    requireTenantId(tenantId);
    requireShowroomConfigId(showroomConfigId);
    const client = requireSupabase();
    const { data: sale, error: saleError } = await client
      .from('showroom_sales')
      .select('id, tenant_id, total_amount, paid_amount, remaining_amount')
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', showroomConfigId)
      .eq('id', saleId)
      .single();

    if (saleError) throw saleError;

    const totalAmount = Math.max(toMoney(sale?.total_amount), 0);
    const paidAmount = Math.max(toMoney(sale?.paid_amount), 0);
    const remainingAmount = Math.max(toMoney(sale?.remaining_amount ?? totalAmount - paidAmount), 0);
    const paymentAmount = Math.min(Math.max(toMoney(amount), 0), remainingAmount);

    if (remainingAmount <= 0 || paymentAmount <= 0) {
      return showroomService.getSaleDetails({ tenantId, saleId, showroomConfigId });
    }

    const paymentDate = todayISODate();
    const { error: paymentError } = await client
      .from('showroom_sale_payments')
      .insert([{
        tenant_id: tenantId,
        sale_id: saleId,
        amount: paymentAmount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        notes: notes?.trim() || null,
      }]);

    if (paymentError) throw paymentError;

    const nextPaidAmount = Math.min(paidAmount + paymentAmount, totalAmount);
    const nextRemainingAmount = Math.max(totalAmount - nextPaidAmount, 0);

    const { error: updateError } = await client
      .from('showroom_sales')
      .update({
        paid_amount: nextPaidAmount,
        remaining_amount: nextRemainingAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', showroomConfigId)
      .eq('id', saleId);

    if (updateError) throw updateError;

    return showroomService.getSaleDetails({ tenantId, saleId, showroomConfigId });
  },

  async getInvoiceDetails({ tenantId, invoiceId, showroomConfigId }) {
    return showroomService.getSaleDetails({ tenantId, saleId: invoiceId, showroomConfigId });
  },

  async createInvoiceFromSale() {
    throw new Error('إنشاء فواتير محاسبية غير مفعل داخل نقطة المعرض حاليًا.');
  },

  async updateInvoiceStatus() {
    throw new Error('تحديث فواتير محاسبية غير مفعل داخل نقطة المعرض حاليًا.');
  },
};
