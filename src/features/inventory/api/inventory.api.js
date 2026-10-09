import { requireSupabase } from '@/core/lib/supabase';
import { productCategoryTrackingIdentifierService, productVariantService } from '@/features/products/api/products.api';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';

const PRODUCT_COLUMNS =
  'id, tenant_id, category_id, brand_id, name, internal_reference, barcode, product_type, tracking, can_be_sold, can_be_purchased, is_active, sale_price, cost_price, attributes_jsonb, extra_data, default_product_product_id, created_at, updated_at';
const PRODUCT_VARIANT_COLUMNS =
  'id, tenant_id, product_template_id, display_name, sku, barcode, tracking, sale_price, cost_price, is_active, created_at, updated_at';
const QUANT_COLUMNS = 'id, tenant_id, product_product_id, quantity_on_hand, reserved_quantity, created_at, updated_at';
const SERIAL_COLUMNS = 'id, tenant_id, product_product_id, tracking_number, tracking_type, status, data_status, incomplete_reason, notes, current_location_id, created_at, updated_at';
const MOVE_COLUMNS = 'id, tenant_id, product_product_id, tracking_unit_id, move_type, quantity, reference_type, reference_id, source_location_id, destination_location_id, created_by, notes, created_at';
const TENANT_USER_COLUMNS = 'id, full_name, email';
const MOVE_TYPES = new Set(['in', 'out', 'inventory', 'return', 'reserve', 'release']);
const SERVICE_STOCK_MESSAGE = 'هذا المنتج خدمة ولا يدعم المخزون';
const SERIAL_UNITS_MESSAGE = 'هذا المنتج متتبع بالسيريال ويجب تحديد الوحدات';
const TENANT_FILES_BUCKET = 'tenant-files';

function numberValue(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function normalizeProduct(record) {
  if (!record) return null;
  return {
    id: record.id,
    tenantId: record.tenant_id,
    name: record.name ?? '',
    categoryId: record.category_id ?? null,
    barcode: record.barcode ?? '',
    code: record.internal_reference ?? '',
    productType: record.product_type ?? 'goods',
    tracking: record.tracking ?? 'none',
    isActive: record.is_active ?? true,
    attributesJsonb: record.attributes_jsonb ?? [],
    defaultProductProductId: record.default_product_product_id ?? null,
  };
}

function normalizeInventoryVariant(record) {
  if (!record) return null;
  const template = record.product_template ?? record.productTemplate ?? null;
  const displayName = record.display_name ?? template?.name ?? '';

  return {
    id: record.id,
    tenantId: record.tenant_id,
    productTemplateId: record.product_template_id ?? template?.id ?? null,
    defaultProductProductId: record.id,
    name: displayName,
    displayName,
    templateName: template?.name ?? '',
    categoryId: template?.category_id ?? null,
    barcode: record.barcode ?? template?.barcode ?? '',
    code: record.sku ?? template?.internal_reference ?? '',
    productType: template?.product_type ?? 'goods',
    tracking: record.tracking ?? template?.tracking ?? 'none',
    isActive: record.is_active ?? true,
    attributesJsonb: template?.attributes_jsonb ?? [],
  };
}

function isServiceProduct(product) {
  return product?.productType === 'service';
}

function isSerialProduct(product) {
  return product?.tracking === 'serial';
}

function isTrackedProduct(product) {
  return product?.tracking === 'serial' || product?.tracking === 'lot';
}

function assertStockProduct(product) {
  if (isServiceProduct(product)) throw new Error(SERVICE_STOCK_MESSAGE);
}

function assertQuantityProduct(product) {
  assertStockProduct(product);
  if (isTrackedProduct(product)) throw new Error(SERIAL_UNITS_MESSAGE);
}

function assertSerialProduct(product) {
  assertStockProduct(product);
  if (!isSerialProduct(product)) throw new Error(SERIAL_UNITS_MESSAGE);
}

function normalizeQuant(record) {
  if (!record) return null;
  return {
    id: record.id,
    tenantId: record.tenant_id,
    productId: record.product_product_id,
    productProductId: record.product_product_id,
    quantity: numberValue(record.quantity_on_hand),
    updatedAt: record.updated_at ?? null,
    createdAt: record.created_at ?? null,
  };
}

function normalizeSerial(record) {
  if (!record) return null;
  return {
    id: record.id,
    tenantId: record.tenant_id,
    productId: record.product_product_id,
    productProductId: record.product_product_id,
    trackingNumber: record.tracking_number ?? '',
    trackingType: record.tracking_type ?? 'serial',
    status: record.status ?? 'in_stock',
    dataStatus: record.data_status ?? 'complete',
    incompleteReason: record.incomplete_reason ?? null,
    isIncomplete: ['incomplete', 'needs_review'].includes(record.data_status),
    hasDataConsistencyWarning: (record.data_status ?? 'complete') === 'complete' && !record.product_product_id,
    notes: record.notes ?? '',
    currentLocationId: record.current_location_id ?? null,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function normalizeMove(record) {
  if (!record) return null;
  return {
    id: record.id,
    tenantId: record.tenant_id,
    productId: record.product_product_id,
    productProductId: record.product_product_id,
    trackingUnitId: record.tracking_unit_id ?? null,
    moveType: record.move_type ?? '',
    quantity: numberValue(record.quantity),
    referenceType: record.reference_type ?? '',
    referenceId: record.reference_id ?? null,
    sourceLocationId: record.source_location_id ?? null,
    destinationLocationId: record.destination_location_id ?? null,
    userId: record.created_by ?? null,
    notes: record.notes ?? '',
    createdAt: record.created_at ?? null,
  };
}

function byId(records) {
  return new Map((records ?? []).map((record) => [record.id, record]));
}

function getFileExtension(file) {
  const nameExtension = String(file?.name || '').split('.').pop();
  const mimeExtension = String(file?.type || '').split('/').pop();
  return (nameExtension && nameExtension !== file?.name ? nameExtension : mimeExtension || 'jpg')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase() || 'jpg';
}

function assertTrackingUnitImage(file) {
  if (!file) return;
  if (!file.type?.startsWith('image/')) {
    throw new Error('يمكن رفع صور فقط لصورة الشاسيه أو الموتور.');
  }
}

async function getProduct(client, { tenantId, productId }) {
  const { data, error } = await client
    .from('product_products')
    .select(`
      ${PRODUCT_VARIANT_COLUMNS},
      product_template:product_template_id (
        ${PRODUCT_COLUMNS}
      )
    `)
    .eq('tenant_id', tenantId)
    .eq('id', productId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('المنتج غير موجود.');
  return normalizeInventoryVariant(data);
}

async function getQuantRecord(client, { tenantId, productProductId }) {
  if (!productProductId) return null;

  const { data, error } = await client
    .from('stock_quants')
    .select(QUANT_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('product_product_id', productProductId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return normalizeQuant(data);
}

async function resolveInventoryVariant({ tenantId, productTemplateId, productProductId, attributeValueIds }) {
  if (productProductId) {
    const variant = await productVariantService.getVariant({ tenantId, id: productProductId });
    if (!variant) throw new Error('النسخة المحددة غير موجودة.');
    return variant;
  }

  if ((attributeValueIds ?? []).length) {
    return productVariantService.resolveVariant({ tenantId, productTemplateId, attributeValueIds });
  }

  return null;
}

async function validateCategoryAttributeSelection({ tenantId, productTemplateId, attributeValueIds, textAttributeRows }) {
  const context = await productVariantService.getTemplateVariantContext({
    tenantId,
    productTemplateId,
  });
  const rawSelectedIds = (attributeValueIds ?? []).filter(Boolean);
  const selectedIds = [...new Set(rawSelectedIds)];
  const normalizedTextRows = (Array.isArray(textAttributeRows) ? textAttributeRows : [])
    .map((row) => ({
      attributeId: row?.attributeId ?? row?.attribute_id,
      attributeValueId: null,
      valueText: String(row?.valueText ?? row?.value_text ?? '').trim(),
    }))
    .filter((row) => row.attributeId && row.valueText);

  if (rawSelectedIds.length !== selectedIds.length) {
    throw new Error('لا يمكن إرسال قيم خصائص مكررة.');
  }

  if (!(context.attributes ?? []).length) {
    return { ...context, selectedIds: [] };
  }

  const valueToAttributeId = new Map();
  for (const attribute of context.attributes ?? []) {
    for (const value of attribute.values ?? []) {
      valueToAttributeId.set(value.id, attribute.id);
    }
  }

  const invalidSelection = selectedIds.find((valueId) => !valueToAttributeId.has(valueId));
  if (invalidSelection) {
    throw new Error('تم اختيار قيمة غير مرتبطة بتصنيف هذا المنتج.');
  }

  const selectedAttributeIdsList = selectedIds.map((valueId) => valueToAttributeId.get(valueId));
  if (selectedAttributeIdsList.length !== new Set(selectedAttributeIdsList).size) {
    throw new Error('لا يمكن اختيار أكثر من قيمة لنفس الخاصية.');
  }

  const contextAttributeIds = new Set((context.attributes ?? []).map((attribute) => attribute.id));
  const invalidTextSelection = normalizedTextRows.find((row) => !contextAttributeIds.has(row.attributeId));
  if (invalidTextSelection) {
    throw new Error('تم إدخال قيمة خاصية غير مرتبطة بتصنيف هذا المنتج.');
  }

  const selectedAttributeIds = new Set([...selectedAttributeIdsList, ...normalizedTextRows.map((row) => row.attributeId)]);
  const selectedAttributeRows = [
    ...selectedIds.map((valueId) => ({
      attributeId: valueToAttributeId.get(valueId),
      attributeValueId: valueId,
      valueText: null,
    })),
    ...normalizedTextRows,
  ];
  const missingRequiredAttribute = (context.attributes ?? []).find(
    (attribute) => attribute.isRequired && !selectedAttributeIds.has(attribute.id),
  );

  if (missingRequiredAttribute) {
    throw new Error(`اختر قيمة "${missingRequiredAttribute.name}" قبل الحفظ.`);
  }

  return {
    ...context,
    selectedIds,
    selectedAttributeRows,
  };
}

async function increaseQuant(client, { tenantId, productProductId, quantity }) {
  const existing = await getQuantRecord(client, { tenantId, productProductId });
  const nextQuantity = numberValue(existing?.quantity) + numberValue(quantity);

  if (existing) {
    const { error } = await client.from('stock_quants').update({ quantity_on_hand: nextQuantity }).eq('id', existing.id);
    if (error) throw new Error(error.message);
    return nextQuantity;
  }

  const { error } = await client.from('stock_quants').insert({
    tenant_id: tenantId,
    product_product_id: productProductId,
    quantity_on_hand: nextQuantity,
  });
  if (error) throw new Error(error.message);
  return nextQuantity;
}

async function decreaseQuant(client, { tenantId, productProductId, quantity }) {
  const existing = await getQuantRecord(client, { tenantId, productProductId });
  const currentQuantity = numberValue(existing?.quantity);
  const requestedQuantity = numberValue(quantity);

  if (!existing || currentQuantity < requestedQuantity) {
    throw new Error('لا يوجد مخزون كافٍ لهذا المنتج.');
  }

  const { error } = await client
    .from('stock_quants')
    .update({ quantity_on_hand: currentQuantity - requestedQuantity })
    .eq('id', existing.id);

  if (error) throw new Error(error.message);
  return currentQuantity - requestedQuantity;
}

async function createMove(client, { tenantId, productProductId, moveType, quantity, userId, notes }) {
  const safeMoveType = MOVE_TYPES.has(moveType) ? moveType : 'inventory';
  const body = {
    tenant_id: tenantId,
    product_product_id: productProductId,
    move_type: safeMoveType,
    quantity: numberValue(quantity),
    created_by: userId ?? null,
  };

  if (notes) {
    body.notes = notes;
  }

  const { data, error } = await client.from('stock_moves').insert(body).select(MOVE_COLUMNS).single();

  if (error) throw new Error(error.message);
  return normalizeMove(data);
}

function isNumericIdentifierValue(value) {
  return /^\d+(\.\d+)?$/.test(String(value ?? '').trim());
}

function getIdentifierSlots(definition) {
  const schemaSlots = definition?.inputSchema?.slots ?? definition?.input_schema?.slots ?? definition?.slots ?? [];
  return Array.isArray(schemaSlots) ? schemaSlots : [];
}

function isAllowedIdentifierCharacter(character, type) {
  if (!type) return true;
  if (type === 'numeric') return /^\d$/.test(character);
  if (type === 'english_letter') return /^[A-Za-z]$/.test(character);
  if (type === 'arabic_letter') return /^[\u0621-\u064A]$/.test(character);
  return true;
}

function validateIdentifierValueAgainstSchema(definition, value) {
  const slots = getIdentifierSlots(definition);
  if (!slots.length || !value) return true;

  const characters = Array.from(String(value));
  if (characters.length !== slots.length) {
    throw new Error(`قيمة "${definition.name}" يجب أن تكون ${slots.length} خانة.`);
  }

  const invalidIndex = characters.findIndex((character, index) => !isAllowedIdentifierCharacter(character, slots[index]?.type));
  if (invalidIndex >= 0) {
    throw new Error(`الخانة ${invalidIndex + 1} في "${definition.name}" لا تطابق نوع الخانة المطلوب.`);
  }

  return true;
}

function normalizeIdentifierInput(input) {
  if (input && typeof input === 'object') {
    return {
      value: String(input.value ?? '').trim(),
      isNotAvailable: Boolean(input.isNotAvailable),
    };
  }

  return {
    value: String(input ?? '').trim(),
    isNotAvailable: false,
  };
}

async function validateTrackingIdentifierValues({ tenantId, categoryId, serials, valuesBySerial }) {
  if (!categoryId) return { definitions: [], valuesBySerial: {} };

  const definitions = await productCategoryTrackingIdentifierService.listCategoryIdentifiers({ tenantId, categoryId });
  if (!definitions.length) return { definitions: [], valuesBySerial: {} };

  const normalizedValues = {};

  for (const serial of serials) {
    const currentValues = valuesBySerial?.[serial] ?? {};
    normalizedValues[serial] = {};

    for (const definition of definitions) {
      const { value: rawValue, isNotAvailable } = normalizeIdentifierInput(currentValues[definition.identifierTypeId]);
      const slots = getIdentifierSlots(definition);

      if (definition.isRequired && !rawValue && !(definition.allowNotAvailable && isNotAvailable)) {
        throw new Error(`أدخل قيمة "${definition.name}" للوحدة ${serial}.`);
      }

      if (isNotAvailable && !definition.allowNotAvailable) {
        throw new Error(`لا يمكن اختيار "لا يوجد" في "${definition.name}".`);
      }

      if (slots.length && rawValue && slots.every((slot) => slot.type === 'numeric') && !isNumericIdentifierValue(rawValue)) {
        throw new Error(`قيمة "${definition.name}" يجب أن تكون رقمية.`);
      }

      validateIdentifierValueAgainstSchema(definition, rawValue);

      if (rawValue || isNotAvailable) {
        normalizedValues[serial][definition.identifierTypeId] = {
          value: rawValue || null,
          isNotAvailable,
        };
      }
    }
  }

  return { definitions, valuesBySerial: normalizedValues };
}

async function saveTrackingUnitIdentifiers(client, { tenantId, units, valuesBySerial, userId }) {
  const rows = [];

  for (const unit of units ?? []) {
    const values = valuesBySerial?.[unit.trackingNumber] ?? {};
    for (const [identifierTypeId, input] of Object.entries(values)) {
      const { value, isNotAvailable } = normalizeIdentifierInput(input);
      if (!value && !isNotAvailable) continue;
      rows.push({
        tenant_id: tenantId,
        tracking_unit_id: unit.id,
        identifier_type_id: identifierTypeId,
        value: isNotAvailable ? null : value,
        is_not_available: isNotAvailable,
      });
    }
  }

  if (!rows.length) return;

  const currentTenantUserId = await resolveCurrentTenantUserId(client, { tenantId, tenantUserId: userId });
  const { error } = await client
    .from('stock_tracking_unit_identifiers')
    .insert(rows.map((row) => ({ ...row, created_by: currentTenantUserId })));
  if (error) {
    if (error.code === '23505') {
      throw new Error('هذه القيمة مستخدمة بالفعل في وحدة أخرى.');
    }
    throw new Error(error.message);
  }
}

async function saveTrackingUnitAttributes(client, { tenantId, units, baseAttributes, valuesBySerial }) {
  const rows = [];

  for (const unit of units ?? []) {
    const serialAttributes = valuesBySerial?.[unit.trackingNumber] ?? [];
    const nextAttributes = [...(baseAttributes ?? []), ...(Array.isArray(serialAttributes) ? serialAttributes : [])];
    const seenAttributes = new Set();

    for (const attribute of nextAttributes) {
      const attributeId = attribute?.attributeId ?? attribute?.attribute_id;
      const attributeValueId = attribute?.attributeValueId ?? attribute?.attribute_value_id ?? null;
      const valueText = attribute?.valueText ?? attribute?.value_text ?? null;
      const dedupeKey = `${attributeId}:${attributeValueId ?? valueText ?? ''}`;

      if (!attributeId || (!attributeValueId && !valueText) || seenAttributes.has(dedupeKey)) continue;
      seenAttributes.add(dedupeKey);

      rows.push({
        tenant_id: tenantId,
        tracking_unit_id: unit.id,
        attribute_id: attributeId,
        attribute_value_id: attributeValueId,
        value_text: valueText,
      });
    }
  }

  if (!rows.length) return;

  const { error } = await client.from('stock_tracking_unit_attributes').insert(rows);
  if (error) throw new Error(error.message);
}

async function loadProductsMap(client, tenantId) {
  const { data, error } = await client
    .from('product_products')
    .select(`
      ${PRODUCT_VARIANT_COLUMNS},
      product_template:product_template_id (
        id,
        tenant_id,
        name,
        category_id,
        barcode,
        internal_reference,
        product_type,
        tracking,
        is_active,
        attributes_jsonb
      )
    `)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(error.message);
  return byId((data ?? []).map(normalizeInventoryVariant));
}

async function loadUsersById(client, tenantId, userIds) {
  const ids = [...new Set((userIds ?? []).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await client
    .from('tenant_users')
    .select(TENANT_USER_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', ids);

  if (error) return new Map();
  return new Map((data ?? []).map((user) => [user.id, user.full_name || user.email || user.id]));
}

export function normalizeTrackingIdentifierValue(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9\u0621-\u064A]/g, '')
    .toUpperCase();
}

export const inventoryService = {
  async listReceivingLocations({ tenantId } = {}) {
    const client = requireSupabase();
    if (!tenantId) return [];
    const { data, error } = await client
      .from('stock_locations')
      .select('id, tenant_id, branch_id, name, code, location_type, is_active, branch:branches!stock_locations_branch_tenant_fkey(id, name)')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('location_type', ['internal', 'showroom'])
      .order('name');
    if (error) throw new Error(error.message);
    return (data ?? []).map((location) => ({
      id: location.id,
      branchId: location.branch_id,
      branchName: location.branch?.name || '',
      name: location.name,
      code: location.code,
      locationType: location.location_type,
    }));
  },

  async uploadReceivingAttachment({ tenantId, trackingUnitId, documentType, file } = {}) {
    const client = requireSupabase();
    if (!tenantId || !trackingUnitId || !documentType || !file) return null;
    assertTrackingUnitImage(file);
    const extension = getFileExtension(file);
    const filePath = `${tenantId}/tracking-units/${trackingUnitId}/${documentType}-${crypto.randomUUID()}.${extension}`;
    const { error } = await client.storage.from(TENANT_FILES_BUCKET).upload(filePath, file, {
      cacheControl: '3600', contentType: file.type || 'image/jpeg', upsert: false,
    });
    if (error) throw new Error(error.message || 'تعذر رفع صورة القطعة.');
    return {
      bucket_name: TENANT_FILES_BUCKET,
      file_path: filePath,
      document_type: documentType,
      original_file_name: file.name || null,
      mime_type: file.type || null,
      file_size: file.size || null,
    };
  },

  async receiveInventory({ branchId, destinationLocationId, sourceType, sourceId, lines, idempotencyKey } = {}) {
    const client = requireSupabase();
    if (!branchId || !destinationLocationId) throw new Error('اختر موقع الاستلام.');
    const { data, error } = await client.rpc('receive_inventory', {
      p_branch_id: branchId,
      p_destination_location_id: destinationLocationId,
      p_source_type: sourceType,
      p_source_id: sourceId,
      p_lines: lines,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async getTransferAvailability({ branchId, locationId, productId } = {}) {
    if (!branchId || !locationId || !productId) return null;
    const { data, error } = await requireSupabase().rpc('get_inventory_availability', {
      p_branch_id: branchId,
      p_product_id: productId,
      p_quantity: 1,
      p_location_id: locationId,
      p_tracking_unit_id: null,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async transferInventory({ sourceBranchId, sourceLocationId, destinationBranchId, destinationLocationId, sourceType, sourceId, lines, notes, idempotencyKey } = {}) {
    const { data, error } = await requireSupabase().rpc('transfer_inventory', {
      p_source_branch_id: sourceBranchId,
      p_source_location_id: sourceLocationId,
      p_destination_branch_id: destinationBranchId,
      p_destination_location_id: destinationLocationId,
      p_source_type: sourceType,
      p_source_id: sourceId,
      p_lines: lines,
      p_notes: notes || null,
      p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async listInventoryCounts({ tenantId } = {}) {
    const { data, error } = await requireSupabase().from('inventory_counts')
      .select('id, branch_id, location_id, scope_type, state, started_at, submitted_at, posted_at')
      .eq('tenant_id', tenantId).order('started_at', { ascending: false }).limit(50);
    if (error) throw new Error(error.message);
    return data ?? [];
  },

  async listCountQuantityProductIds({ tenantId, locationId } = {}) {
    if (!tenantId || !locationId) return [];
    const { data, error } = await requireSupabase().from('stock_quants')
      .select('product_product_id').eq('tenant_id', tenantId).eq('location_id', locationId);
    if (error) throw new Error(error.message);
    return [...new Set((data || []).map((item) => item.product_product_id).filter(Boolean))];
  },

  async startInventoryCount({ branchId, locationId, scopeType = 'full_location', productIds = [], idempotencyKey } = {}) {
    const { data, error } = await requireSupabase().rpc('start_inventory_count', {
      p_branch_id: branchId, p_location_id: locationId, p_scope_type: scopeType,
      p_product_ids: productIds, p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async getInventoryCount({ countId } = {}) {
    const { data, error } = await requireSupabase().rpc('get_inventory_count', { p_count_id: countId });
    if (error) throw new Error(error.message);
    return data;
  },

  async getInventoryCountUnits({ tenantId, trackingUnitIds = [] } = {}) {
    const client = requireSupabase();
    const ids = [...new Set(trackingUnitIds.filter(Boolean))];
    if (!tenantId || !ids.length) return [];
    const [{ data: units, error: unitsError }, { data: identifiers, error: identifiersError },
      { data: types, error: typesError }, { data: states, error: statesError }] = await Promise.all([
      client.from('stock_tracking_units').select(SERIAL_COLUMNS).eq('tenant_id', tenantId).in('id', ids),
      client.from('stock_tracking_unit_identifiers').select('tracking_unit_id, identifier_type_id, value')
        .eq('tenant_id', tenantId).in('tracking_unit_id', ids),
      client.from('product_tracking_identifier_types').select('id, name, code').eq('tenant_id', tenantId),
      client.from('inventory_tracking_unit_states').select('tracking_unit_id, state, current_location_id, version')
        .eq('tenant_id', tenantId).in('tracking_unit_id', ids),
    ]);
    if (unitsError) throw new Error(unitsError.message);
    if (identifiersError) throw new Error(identifiersError.message);
    if (typesError) throw new Error(typesError.message);
    if (statesError) throw new Error(statesError.message);
    const typesById = new Map((types || []).map((type) => [type.id, type]));
    const identifiersByUnit = (identifiers || []).reduce((map, item) => {
      const list = map.get(item.tracking_unit_id) || [];
      list.push({ ...item, type: typesById.get(item.identifier_type_id) });
      map.set(item.tracking_unit_id, list);
      return map;
    }, new Map());
    const statesByUnit = new Map((states || []).map((state) => [state.tracking_unit_id, state]));
    return (units || []).map((row) => {
      const unit = normalizeSerial(row);
      const unitIdentifiers = identifiersByUnit.get(row.id) || [];
      const isChassis = (item) => /chassis|شاسيه/i.test(`${item.type?.code || ''} ${item.type?.name || ''}`);
      const isEngine = (item) => /engine|motor|موتور|محرك/i.test(`${item.type?.code || ''} ${item.type?.name || ''}`);
      const state = statesByUnit.get(row.id);
      return {
        ...unit,
        chassisNumber: unitIdentifiers.find(isChassis)?.value || '',
        engineNumber: unitIdentifiers.find(isEngine)?.value || '',
        canonicalState: state?.state || '',
        currentLocationId: state?.current_location_id || unit.currentLocationId || null,
        canonicalVersion: state?.version ?? null,
      };
    });
  },

  async saveInventoryCountObservations({ countId, observations, idempotencyKey } = {}) {
    const { data, error } = await requireSupabase().rpc('save_inventory_count_observations', {
      p_count_id: countId, p_observations: observations, p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async submitInventoryCount({ countId, idempotencyKey } = {}) {
    const { data, error } = await requireSupabase().rpc('submit_inventory_count', { p_count_id: countId, p_idempotency_key: idempotencyKey });
    if (error) throw new Error(error.message);
    return data;
  },

  async postInventoryAdjustment({ countId, decisions, reason, idempotencyKey } = {}) {
    const { data, error } = await requireSupabase().rpc('post_inventory_adjustment', {
      p_count_id: countId, p_variance_decisions: decisions, p_reason: reason, p_idempotency_key: idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async getTrackingUnitDocumentationStatus({ trackingUnitId } = {}) {
    if (!trackingUnitId) return null;
    const { data, error } = await requireSupabase().rpc('get_inventory_unit_documentation_status', {
      p_tracking_unit_id: trackingUnitId,
    });
    if (error) throw new Error(error.message);
    return data;
  },

  async searchSerialUnitsByIdentifiers({
    tenantId,
    chassisNumber = '',
    engineNumber = '',
    trackingNumber = '',
    limit = 10,
  } = {}) {
    const client = requireSupabase();
    const normalizedChassis = normalizeTrackingIdentifierValue(chassisNumber);
    const normalizedEngine = normalizeTrackingIdentifierValue(engineNumber);
    const normalizedTracking = normalizeTrackingIdentifierValue(trackingNumber);

    if (!tenantId) throw new Error('لا توجد شركة نشطة.');
    if (Math.max(normalizedChassis.length, normalizedEngine.length, normalizedTracking.length) < 6) return { matchSource: '', units: [] };

    const { data: typeRows, error: typesError } = await client
      .from('product_tracking_identifier_types')
      .select('id, name, code')
      .eq('tenant_id', tenantId);
    if (typesError) throw new Error(typesError.message);

    const isChassisType = (type) => /chassis|شاسيه/i.test(`${type.code || ''} ${type.name || ''}`);
    const isEngineType = (type) => /engine|motor|موتور|محرك/i.test(`${type.code || ''} ${type.name || ''}`);
    const chassisTypeIds = (typeRows || []).filter(isChassisType).map((type) => type.id);
    const engineTypeIds = (typeRows || []).filter(isEngineType).map((type) => type.id);

    if (!chassisTypeIds.length) throw new Error('تعريف رقم الشاسيه غير موجود في إعدادات الشركة.');

    const findMatchingRows = async (typeIds, value) => {
      if (!typeIds.length || value.length < 6) return [];
      const queryByLoosePattern = async (searchValue) => {
        const loosePattern = `%${Array.from(searchValue).join('%')}`;
        const { data, error } = await client
          .from('stock_tracking_unit_identifiers')
          .select('tracking_unit_id, identifier_type_id, value')
          .eq('tenant_id', tenantId)
          .in('identifier_type_id', typeIds)
          .ilike('value', loosePattern)
          .order('created_at', { ascending: false })
          .limit(Math.max(Number(limit) || 10, 1) * 5);
        if (error) throw new Error(error.message);
        return data || [];
      };

      const exactCandidates = await queryByLoosePattern(value);
      const exactRows = exactCandidates.filter(
        (row) => normalizeTrackingIdentifierValue(row.value) === value,
      );
      if (exactRows.length) return exactRows;

      const suffix = value.slice(-6);
      return (await queryByLoosePattern(suffix)).filter(
        (row) => normalizeTrackingIdentifierValue(row.value).endsWith(suffix),
      );
    };

    let matchSource = 'tracking';
    let directUnits = [];
    if (normalizedTracking.length >= 6) {
      const loosePattern = `%${Array.from(normalizedTracking).join('%')}`;
      const { data, error } = await client.from('stock_tracking_units').select(SERIAL_COLUMNS)
        .eq('tenant_id', tenantId).ilike('tracking_number', loosePattern).limit(Math.max(Number(limit) || 10, 1) * 5);
      if (error) throw new Error(error.message);
      directUnits = (data || []).filter((unit) => {
        const normalized = normalizeTrackingIdentifierValue(unit.tracking_number);
        return normalized === normalizedTracking || normalized.endsWith(normalizedTracking.slice(-6));
      });
    }

    let matchedRows = [];
    if (!directUnits.length) {
      const [chassisRows, engineRows] = await Promise.all([
        findMatchingRows(chassisTypeIds, normalizedChassis),
        findMatchingRows(engineTypeIds, normalizedEngine),
      ]);
      matchSource = chassisRows.length && engineRows.length ? 'identifiers' : chassisRows.length ? 'chassis' : 'engine';
      matchedRows = [...chassisRows, ...engineRows];
    }

    const unitIds = [...new Set([
      ...directUnits.map((unit) => unit.id),
      ...matchedRows.map((row) => row.tracking_unit_id),
    ].filter(Boolean))];
    if (!unitIds.length) return { matchSource, units: [] };

    const [{ data: unitRows, error: unitsError }, { data: identifierRows, error: identifiersError }, { data: stateRows, error: statesError }] = await Promise.all([
      client.from('stock_tracking_units').select(SERIAL_COLUMNS).eq('tenant_id', tenantId).in('id', unitIds),
      client
        .from('stock_tracking_unit_identifiers')
        .select('id, tracking_unit_id, identifier_type_id, value, is_not_available')
        .eq('tenant_id', tenantId)
        .in('tracking_unit_id', unitIds),
      client.from('inventory_tracking_unit_states')
        .select('tracking_unit_id, state, current_location_id, version')
        .eq('tenant_id', tenantId).in('tracking_unit_id', unitIds),
    ]);
    if (unitsError) throw new Error(unitsError.message);
    if (identifiersError) throw new Error(identifiersError.message);
    if (statesError) throw new Error(statesError.message);

    const locationIds = [...new Set((stateRows || []).map((row) => row.current_location_id).filter(Boolean))];
    const { data: locationRows, error: locationsError } = locationIds.length
      ? await client.from('stock_locations').select('id, name, branch:branches!stock_locations_branch_tenant_fkey(id, name)')
        .eq('tenant_id', tenantId).in('id', locationIds)
      : { data: [], error: null };
    if (locationsError) throw new Error(locationsError.message);

    const productIds = [...new Set((unitRows || []).map((unit) => unit.product_product_id).filter(Boolean))];
    const { data: productRows, error: productsError } = productIds.length
      ? await client
        .from('product_products')
        .select(`
          ${PRODUCT_VARIANT_COLUMNS},
          product_template:product_template_id (
            id, tenant_id, name, category_id, barcode, internal_reference,
            product_type, tracking, is_active, attributes_jsonb
          )
        `)
        .eq('tenant_id', tenantId)
        .in('id', productIds)
      : { data: [], error: null };
    if (productsError) throw new Error(productsError.message);

    const typesById = new Map((typeRows || []).map((type) => [type.id, type]));
    const productsById = byId((productRows || []).map(normalizeInventoryVariant));
    const statesByUnitId = new Map((stateRows || []).map((row) => [row.tracking_unit_id, row]));
    const locationsById = new Map((locationRows || []).map((row) => [row.id, row]));
    const identifiersByUnitId = (identifierRows || []).reduce((map, row) => {
      const current = map.get(row.tracking_unit_id) || [];
      const type = typesById.get(row.identifier_type_id);
      current.push({
        id: row.id,
        identifierTypeId: row.identifier_type_id,
        code: type?.code || '',
        label: type?.name || 'رقم تتبع',
        value: row.value || '',
        isNotAvailable: row.is_not_available ?? false,
      });
      map.set(row.tracking_unit_id, current);
      return map;
    }, new Map());

    return {
      matchSource,
      units: (unitRows || []).map((row) => {
        const unit = normalizeSerial(row);
        const identifiers = identifiersByUnitId.get(row.id) || [];
        const chassis = identifiers.find((identifier) => isChassisType({ code: identifier.code, name: identifier.label }));
        const engine = identifiers.find((identifier) => isEngineType({ code: identifier.code, name: identifier.label }));
        const storedChassis = normalizeTrackingIdentifierValue(chassis?.value);
        const storedEngine = normalizeTrackingIdentifierValue(engine?.value);
        const state = statesByUnitId.get(row.id);
        const location = locationsById.get(state?.current_location_id);

        return {
          ...unit,
          product: productsById.get(unit.productProductId) || null,
          trackingIdentifiers: identifiers,
          chassisNumber: chassis?.value || '',
          engineNumber: engine?.value || '',
          canonicalState: state?.state || '',
          canonicalVersion: state?.version ?? null,
          currentLocationId: state?.current_location_id || unit.currentLocationId || null,
          currentLocationName: location?.name || '',
          currentBranchName: location?.branch?.name || '',
          chassisMatchType: storedChassis === normalizedChassis
            ? 'exact'
            : storedChassis.endsWith(normalizedChassis.slice(-6)) ? 'suffix' : '',
        engineMatchType: normalizedEngine && storedEngine === normalizedEngine
          ? 'exact'
          : normalizedEngine.length >= 6 && storedEngine.endsWith(normalizedEngine.slice(-6)) ? 'suffix' : '',
        };
      }).sort((left, right) => {
        const leftRank = left.chassisMatchType === 'exact' ? 0 : left.chassisMatchType === 'suffix' ? 1 : 2;
        const rightRank = right.chassisMatchType === 'exact' ? 0 : right.chassisMatchType === 'suffix' ? 1 : 2;
        return leftRank - rightRank || String(right.createdAt || '').localeCompare(String(left.createdAt || ''));
      }).slice(0, Math.max(Number(limit) || 10, 1)),
    };
  },

  async listProducts(tenantId) {
    const client = requireSupabase();
    const productsMap = await loadProductsMap(client, tenantId);
    return Array.from(productsMap.values())
      .filter((product) => product?.isActive && !isServiceProduct(product))
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  },

  async addStock({
    tenantId,
    productId,
    productProductId,
    attributeValueIds,
    textAttributeRows,
    quantity,
    serialNumbers,
    trackingIdentifierValuesBySerial,
    trackingUnitAttributesBySerial,
    userId,
    allowIncompleteUnit = false,
    dataStatus = 'complete',
    incompleteReason = null,
    registrationSource = null,
  }) {
    throw new Error('مسار إضافة المخزون القديم مغلق. استخدم استلام المخزون Canonical.');
    /* c8 ignore start -- retained temporarily for non-runtime migration reference */
    const client = requireSupabase();
    if (allowIncompleteUnit) {
      if (registrationSource !== 'jawab') {
        throw new Error('لا يمكن تسجيل قطعة غير مكتملة خارج مسار استلام الجواب.');
      }
      if (productId || productProductId) {
        throw new Error('القطعة غير المكتملة يجب ألا ترتبط بمنتج مؤقت.');
      }
      if (dataStatus !== 'incomplete' || incompleteReason !== 'missing_product') {
        throw new Error('حالة القطعة غير المكتملة غير صحيحة.');
      }

      const rawUnitKeys = (serialNumbers ?? []).map((item) => String(item || '').trim()).filter(Boolean);
      const unitKeys = [...new Set(rawUnitKeys)];
      if (!unitKeys.length) throw new Error('أدخل رقم الشاسيه قبل تسجيل القطعة.');
      if (rawUnitKeys.length !== unitKeys.length) throw new Error('يوجد رقم تتبع مكرر داخل الإدخال الحالي.');

      const rows = unitKeys.map((unitKey) => ({
        tenant_id: tenantId,
        product_product_id: null,
        tracking_number: unitKey,
        tracking_type: 'serial',
        status: 'in_stock',
        data_status: 'incomplete',
        incomplete_reason: 'missing_product',
      }));
      const { data: insertedUnits, error: serialError } = await client
        .from('stock_tracking_units')
        .insert(rows)
        .select(SERIAL_COLUMNS);
      if (serialError) {
        if (serialError.code === '23505') throw new Error('رقم الشاسيه أو التتبع مسجل مسبقًا داخل الشركة.');
        throw new Error(serialError.message);
      }
      try {
        await saveTrackingUnitIdentifiers(client, {
          tenantId,
          units: (insertedUnits ?? []).map(normalizeSerial),
          valuesBySerial: trackingIdentifierValuesBySerial,
          userId,
        });
      } catch (identifierError) {
        const insertedIds = (insertedUnits || []).map((unit) => unit.id).filter(Boolean);
        if (insertedIds.length) {
          await client.from('stock_tracking_units').delete().eq('tenant_id', tenantId).in('id', insertedIds);
        }
        throw identifierError;
      }
      return { quantity: unitKeys.length, units: (insertedUnits ?? []).map(normalizeSerial) };
    }

    if (!productId) throw new Error('اختر منتجًا أولاً.');
    const product = await getProduct(client, { tenantId, productId });
    assertStockProduct(product);
    const productTemplateId = product.productTemplateId;

    if (isTrackedProduct(product)) {
      const activeVariantId = productProductId ?? product.id;
      const rawUnitKeys = (serialNumbers ?? []).map((item) => String(item || '').trim()).filter(Boolean);
      const unitKeys = [...new Set(rawUnitKeys)];
      if (!unitKeys.length) throw new Error(SERIAL_UNITS_MESSAGE);
      if (rawUnitKeys.length !== unitKeys.length) {
        throw new Error('يوجد رقم تتبع مكرر داخل الإدخال الحالي.');
      }
      const trackingIdentifierValidation = await validateTrackingIdentifierValues({
        tenantId,
        categoryId: product.categoryId,
        serials: unitKeys,
        valuesBySerial: trackingIdentifierValuesBySerial,
      });
      const selectedValueIds = [...new Set((attributeValueIds ?? []).filter(Boolean))];
      const { data: valueRows, error: valueRowsError } = selectedValueIds.length
        ? await client
          .from('product_attribute_values')
          .select('id, attribute_id')
          .eq('tenant_id', tenantId)
          .in('id', selectedValueIds)
        : { data: [], error: null };

      if (valueRowsError) throw new Error(valueRowsError.message);

      const valueAttributeRows = (valueRows ?? []).map((row) => ({
        attributeId: row.attribute_id,
        attributeValueId: row.id,
        valueText: null,
      }));
      const textRows = (Array.isArray(textAttributeRows) ? textAttributeRows : [])
        .map((row) => ({
          attributeId: row?.attributeId ?? row?.attribute_id,
          attributeValueId: null,
          valueText: String(row?.valueText ?? row?.value_text ?? '').trim(),
        }))
        .filter((row) => row.attributeId && row.valueText);

      const rows = unitKeys.map((unitKey) => ({
        tenant_id: tenantId,
        product_product_id: activeVariantId,
        tracking_number: unitKey || null,
        tracking_type: product.tracking,
        status: 'in_stock',
        data_status: 'complete',
        incomplete_reason: null,
      }));

      const { data: insertedUnits, error: serialError } = await client.from('stock_tracking_units').insert(rows).select(SERIAL_COLUMNS);
      if (serialError) {
        if (serialError.code === '23505' || serialError.message?.includes('stock_tracking_units_tenant_tracking_number_unique')) {
          throw new Error('يوجد IMEI / Serial مكرر مسبقًا داخل هذا الـ tenant.');
        }
        throw new Error(serialError.message);
      }
      await saveTrackingUnitIdentifiers(client, {
        tenantId,
        units: (insertedUnits ?? []).map(normalizeSerial),
        valuesBySerial: trackingIdentifierValidation.valuesBySerial,
        userId,
      });
      await saveTrackingUnitAttributes(client, {
        tenantId,
        units: (insertedUnits ?? []).map(normalizeSerial),
        baseAttributes: [...valueAttributeRows, ...textRows],
        valuesBySerial: trackingUnitAttributesBySerial,
      });
      await createMove(client, {
        tenantId,
        productProductId: activeVariantId,
        moveType: 'in',
        quantity: unitKeys.length,
        userId,
      });
      return { quantity: unitKeys.length, units: (insertedUnits ?? []).map(normalizeSerial) };
    }

    assertQuantityProduct(product);
    const attributeSelection = await validateCategoryAttributeSelection({ tenantId, productTemplateId, attributeValueIds, textAttributeRows });
    const resolvedVariant =
      (await resolveInventoryVariant({ tenantId, productTemplateId, productProductId, attributeValueIds: attributeSelection.selectedIds })) ??
      (productProductId ? await productVariantService.getVariant({ tenantId, id: productProductId }) : null);
    const activeVariantId = resolvedVariant?.id ?? productProductId ?? product.id;
    const nextQuantity = numberValue(quantity);
    if (nextQuantity <= 0) throw new Error('أدخل كمية صحيحة.');

    await increaseQuant(client, { tenantId, productProductId: activeVariantId, quantity: nextQuantity });
    await createMove(client, { tenantId, productProductId: activeVariantId, moveType: 'in', quantity: nextQuantity, userId });
    return { quantity: nextQuantity };
    /* c8 ignore stop */
  },

  async saveTrackingUnitLicense({ tenantId, trackingUnitId, license = {}, userId } = {}) {
    const client = requireSupabase();
    if (!tenantId) throw new Error('لا توجد شركة نشطة.');
    if (!trackingUnitId) throw new Error('تعذر تحديد وحدة التتبع المطلوبة.');

    const status = license.status || '';
    const number = String(license.number ?? '').trim();
    const expiresAt = license.expiresAt || null;

    if (!status) throw new Error('اختر حالة الترخيص.');
    if (status === 'licensed' && !number) throw new Error('رقم الرخصة مطلوب عندما تكون الحالة مرخص.');
    if (status === 'licensed' && !expiresAt) throw new Error('تاريخ انتهاء الترخيص مطلوب عندما تكون الحالة مرخص.');

    const createdBy = userId || await resolveCurrentTenantUserId(client, { tenantId });

    const { error: updateError } = await client
      .from('stock_tracking_unit_licenses')
      .update({ is_current: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', tenantId)
      .eq('tracking_unit_id', trackingUnitId)
      .eq('is_current', true);

    if (updateError) throw new Error(updateError.message);

    const { error: insertError } = await client
      .from('stock_tracking_unit_licenses')
      .insert({
        tenant_id: tenantId,
        tracking_unit_id: trackingUnitId,
        license_status: status,
        license_number: number || null,
        license_issued_at: license.issuedAt || null,
        license_expires_at: expiresAt,
        issuing_authority: String(license.issuingAuthority ?? '').trim() || null,
        notes: String(license.notes ?? '').trim() || null,
        is_current: true,
        created_by: createdBy,
      });

    if (insertError) {
      if (insertError.code === '23505') throw new Error('رقم الرخصة مستخدم بالفعل داخل نفس الشركة.');
      throw new Error(insertError.message);
    }

    return true;
  },

  async saveTrackingUnitAttachment({ tenantId, trackingUnitId, documentType, file, userId } = {}) {
    const client = requireSupabase();
    if (!tenantId) throw new Error('لا توجد شركة نشطة.');
    if (!trackingUnitId) throw new Error('تعذر تحديد القطعة الفريدة.');
    if (!documentType) throw new Error('تعذر تحديد نوع الصورة.');
    if (!file) return null;

    assertTrackingUnitImage(file);

    const createdBy = userId || await resolveCurrentTenantUserId(client, { tenantId });
    const extension = getFileExtension(file);
    const path = `${tenantId}/tracking-units/${trackingUnitId}/${documentType}-${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await client.storage.from(TENANT_FILES_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

    if (uploadError) {
      throw new Error(uploadError.message || 'تعذر رفع صورة القطعة.');
    }

    const { error: attachmentError } = await client.from('ir_attachments').insert({
      tenant_id: tenantId,
      bucket_name: TENANT_FILES_BUCKET,
      file_path: path,
      document_type: documentType,
      related_model: 'stock_tracking_units',
      related_id: trackingUnitId,
      original_file_name: file.name || null,
      mime_type: file.type || null,
      file_size: file.size || null,
      created_by: createdBy,
    });

    if (attachmentError) {
      await client.storage.from(TENANT_FILES_BUCKET).remove([path]);
      throw new Error(attachmentError.message || 'تم رفع الصورة لكن تعذر ربطها بالقطعة.');
    }

    return { path, bucket: TENANT_FILES_BUCKET, documentType };
  },

  async getStock({ tenantId }) {
    const client = requireSupabase();
    const [productsMap, quantsResult, serialResult] = await Promise.all([
      loadProductsMap(client, tenantId),
      client.from('stock_quants').select(QUANT_COLUMNS).eq('tenant_id', tenantId),
      client.from('stock_tracking_units').select(SERIAL_COLUMNS).eq('tenant_id', tenantId).eq('status', 'in_stock').eq('data_status', 'complete').not('product_product_id', 'is', null),
    ]);

    if (quantsResult.error) throw new Error(quantsResult.error.message);
    if (serialResult.error) throw new Error(serialResult.error.message);

    const quantsByProduct = byId((quantsResult.data ?? []).map(normalizeQuant).map((quant) => ({ ...quant, id: quant.productProductId })));
    const serialCounts = (serialResult.data ?? []).map(normalizeSerial).reduce((counts, unit) => {
      counts.set(unit.productProductId, (counts.get(unit.productProductId) ?? 0) + 1);
      return counts;
    }, new Map());

    return Array.from(productsMap.values())
      .filter((product) => !isServiceProduct(product))
      .map((product) => ({
        product,
        quantity: isSerialProduct(product) ? 0 : quantsByProduct.get(product.id)?.quantity ?? 0,
        availableSerials: isSerialProduct(product) ? serialCounts.get(product.id) ?? 0 : 0,
      }))
      .filter((item) => (item.product.tracking === 'serial' ? item.availableSerials > 0 : item.quantity > 0));
  },

  async getSerialUnits({ tenantId, productId, productProductId, status, dataStatus = 'all', includeIncomplete = true }) {
    const client = requireSupabase();
    if (productId && productId !== 'all') {
      const product = await getProduct(client, { tenantId, productId });
      assertSerialProduct(product);
    }

    let query = client.from('stock_tracking_units').select(SERIAL_COLUMNS).eq('tenant_id', tenantId);

    if (productId && productId !== 'all') query = query.eq('product_product_id', productId);
    if (productProductId && productProductId !== 'all') query = query.eq('product_product_id', productProductId);
    if (status && status !== 'all') query = query.eq('status', status);
    if (dataStatus && dataStatus !== 'all') query = query.eq('data_status', dataStatus);
    if (!includeIncomplete || (productId && productId !== 'all') || (productProductId && productProductId !== 'all')) {
      query = query.eq('data_status', 'complete').not('product_product_id', 'is', null);
    }

    const [{ data, error }, productsMap] = await Promise.all([query.order('created_at', { ascending: false }), loadProductsMap(client, tenantId)]);
    if (error) throw new Error(error.message);

    const units = (data ?? []).map(normalizeSerial);
    const unitIds = units.map((unit) => unit.id);
    if (!unitIds.length) return [];
    const [identifierRowsResult, attributeRowsResult, identifierTypesResult, attributeDefinitionsResult, attributeValuesResult] = await Promise.all([
      client.from('stock_tracking_unit_identifiers').select('tracking_unit_id, identifier_type_id, value, is_not_available').eq('tenant_id', tenantId).in('tracking_unit_id', unitIds),
      client.from('stock_tracking_unit_attributes').select('tracking_unit_id, attribute_id, attribute_value_id, value_text').eq('tenant_id', tenantId).in('tracking_unit_id', unitIds),
      client.from('product_tracking_identifier_types').select('id, name, code').eq('tenant_id', tenantId),
      client.from('product_attributes').select('id, name').eq('tenant_id', tenantId),
      client.from('product_attribute_values').select('id, name').eq('tenant_id', tenantId),
    ]);
    for (const result of [identifierRowsResult, attributeRowsResult, identifierTypesResult, attributeDefinitionsResult, attributeValuesResult]) {
      if (result.error) throw new Error(result.error.message);
    }
    const identifierTypes = byId(identifierTypesResult.data || []);
    const attributeDefinitions = byId(attributeDefinitionsResult.data || []);
    const attributeValues = byId(attributeValuesResult.data || []);
    const identifiersByUnit = new Map();
    for (const row of identifierRowsResult.data || []) {
      const type = identifierTypes.get(row.identifier_type_id);
      const current = identifiersByUnit.get(row.tracking_unit_id) || [];
      current.push({ name: type?.name || type?.code || 'رقم تعريف', code: type?.code || '', value: row.is_not_available ? 'غير متاح' : row.value || '-' });
      identifiersByUnit.set(row.tracking_unit_id, current);
    }
    const attributesByUnit = new Map();
    for (const row of attributeRowsResult.data || []) {
      const current = attributesByUnit.get(row.tracking_unit_id) || [];
      current.push({ name: attributeDefinitions.get(row.attribute_id)?.name || 'خاصية', value: attributeValues.get(row.attribute_value_id)?.name || row.value_text || '-' });
      attributesByUnit.set(row.tracking_unit_id, current);
    }
    const identifierValue = (items, pattern) => items.find((item) => pattern.test(`${item.code} ${item.name}`))?.value || '';
    return units.map((unit) => {
      const identifiers = identifiersByUnit.get(unit.id) || [];
      const attributes = attributesByUnit.get(unit.id) || [];
      return {
        ...unit,
        product: productsMap.get(unit.productProductId) ?? null,
        identifiers,
        attributes,
        chassisNumber: identifierValue(identifiers, /chassis|شاسيه/i) || unit.trackingNumber,
        engineNumber: identifierValue(identifiers, /engine|motor|موتور|محرك/i),
        attributesText: attributes.map((item) => `${item.name}: ${item.value}`).join('، '),
      };
    });
  },

  async getTrackingUnitDetails({ tenantId, trackingUnitId }) {
    const client = requireSupabase();
    const [identifiersResult, attributesResult] = await Promise.all([
      client.from('stock_tracking_unit_identifiers').select('identifier_type_id, value, is_not_available').eq('tenant_id', tenantId).eq('tracking_unit_id', trackingUnitId),
      client.from('stock_tracking_unit_attributes').select('attribute_id, attribute_value_id, value_text').eq('tenant_id', tenantId).eq('tracking_unit_id', trackingUnitId),
    ]);
    if (identifiersResult.error) throw new Error(identifiersResult.error.message);
    if (attributesResult.error) throw new Error(attributesResult.error.message);

    const identifierTypeIds = [...new Set((identifiersResult.data || []).map((row) => row.identifier_type_id).filter(Boolean))];
    const attributeIds = [...new Set((attributesResult.data || []).map((row) => row.attribute_id).filter(Boolean))];
    const attributeValueIds = [...new Set((attributesResult.data || []).map((row) => row.attribute_value_id).filter(Boolean))];
    const [typesResult, attributeDefinitionsResult, attributeValuesResult] = await Promise.all([
      identifierTypeIds.length ? client.from('product_tracking_identifier_types').select('id, name, code').eq('tenant_id', tenantId).in('id', identifierTypeIds) : Promise.resolve({ data: [], error: null }),
      attributeIds.length ? client.from('product_attributes').select('id, name').eq('tenant_id', tenantId).in('id', attributeIds) : Promise.resolve({ data: [], error: null }),
      attributeValueIds.length ? client.from('product_attribute_values').select('id, name').eq('tenant_id', tenantId).in('id', attributeValueIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (typesResult.error) throw new Error(typesResult.error.message);
    if (attributeDefinitionsResult.error) throw new Error(attributeDefinitionsResult.error.message);
    if (attributeValuesResult.error) throw new Error(attributeValuesResult.error.message);
    const types = byId(typesResult.data || []);
    const definitions = byId(attributeDefinitionsResult.data || []);
    const values = byId(attributeValuesResult.data || []);
    return {
      identifiers: (identifiersResult.data || []).map((row) => ({
        id: row.identifier_type_id,
        name: types.get(row.identifier_type_id)?.name || types.get(row.identifier_type_id)?.code || 'رقم تعريف',
        code: types.get(row.identifier_type_id)?.code || '',
        value: row.is_not_available ? 'غير متاح' : row.value || '-',
      })),
      attributes: (attributesResult.data || []).map((row) => ({
        id: row.attribute_id,
        name: definitions.get(row.attribute_id)?.name || 'خاصية',
        value: values.get(row.attribute_value_id)?.name || row.value_text || '-',
      })),
    };
  },

  async listJawabIdentifierDefinitions({ tenantId } = {}) {
    const client = requireSupabase();
    if (!tenantId) return [];
    const { data, error } = await client
      .from('product_tracking_identifier_types')
      .select('id, code, name, data_type, input_schema, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true);
    if (error) throw new Error(error.message);
    return (data || [])
      .filter((item) => /chassis|شاسيه|engine|motor|موتور|محرك/i.test(`${item.code || ''} ${item.name || ''}`))
      .map((item) => ({
        identifierTypeId: item.id,
        code: item.code || '',
        name: item.name || 'رقم تعريف',
        dataType: item.data_type || 'text',
        inputSchema: item.input_schema || {},
        isRequired: /chassis|شاسيه/i.test(`${item.code || ''} ${item.name || ''}`),
        allowNotAvailable: false,
      }));
  },

  async canCompleteTrackingUnit({ tenantId } = {}) {
    const client = requireSupabase();
    if (!tenantId) return false;
    const { data, error } = await client.rpc('can_complete_tracking_unit', { p_tenant_id: tenantId });
    if (error) throw new Error(error.message);
    return Boolean(data);
  },

  async getTrackingUnitCompletionContext({ tenantId, trackingUnitId } = {}) {
    const client = requireSupabase();
    if (!tenantId || !trackingUnitId) throw new Error('تعذر تحديد القطعة.');
    const [{ data: unit, error: unitError }, { data: identifiers, error: identifiersError }, { data: attributes, error: attributesError }] = await Promise.all([
      client.from('stock_tracking_units').select(SERIAL_COLUMNS).eq('tenant_id', tenantId).eq('id', trackingUnitId).single(),
      client.from('stock_tracking_unit_identifiers').select('identifier_type_id, value, is_not_available').eq('tenant_id', tenantId).eq('tracking_unit_id', trackingUnitId),
      client.from('stock_tracking_unit_attributes').select('attribute_id, attribute_value_id, value_text').eq('tenant_id', tenantId).eq('tracking_unit_id', trackingUnitId),
    ]);
    if (unitError) throw new Error(unitError.message);
    if (identifiersError) throw new Error(identifiersError.message);
    if (attributesError) throw new Error(attributesError.message);
    return {
      unit: normalizeSerial(unit),
      identifiers: identifiers || [],
      attributes: attributes || [],
    };
  },

  async completeIncompleteTrackingUnit({ tenantId, trackingUnitId, productProductId, identifierValues = [], attributeValues = [] } = {}) {
    const client = requireSupabase();
    if (!tenantId || !trackingUnitId || !productProductId) throw new Error('بيانات استكمال القطعة غير مكتملة.');
    const { data, error } = await client.rpc('complete_incomplete_tracking_unit', {
      p_tenant_id: tenantId,
      p_tracking_unit_id: trackingUnitId,
      p_product_product_id: productProductId,
      p_identifier_values: identifierValues,
      p_attribute_values: attributeValues,
    });
    if (error) throw new Error(error.message || 'تعذر استكمال بيانات القطعة.');
    return data;
  },

  async getStockMoves({ tenantId }) {
    const client = requireSupabase();
    const [{ data, error }, productsMap] = await Promise.all([
      client.from('stock_moves').select(MOVE_COLUMNS).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(200),
      loadProductsMap(client, tenantId),
    ]);
    if (error) throw new Error(error.message);
    const moves = (data ?? []).map(normalizeMove);
    const locationIds = [...new Set(moves.flatMap((move) => [move.sourceLocationId, move.destinationLocationId]).filter(Boolean))];
    const [{ data: locationRows }, usersById] = await Promise.all([
      locationIds.length
        ? client.from('stock_locations').select('id, name, branch:branches!stock_locations_branch_tenant_fkey(name)').eq('tenant_id', tenantId).in('id', locationIds)
        : Promise.resolve({ data: [] }),
      loadUsersById(client, tenantId, moves.map((move) => move.userId)),
    ]);
    const locationsById = new Map((locationRows ?? []).map((location) => [location.id, `${location.branch?.name ? `${location.branch.name} — ` : ''}${location.name}`]));

    return moves.map((move) => ({
      ...move,
      product: productsMap.get(move.productProductId) ?? null,
      userName: usersById.get(move.userId) ?? move.userId ?? '-',
      sourceLocationName: locationsById.get(move.sourceLocationId) ?? '',
      destinationLocationName: locationsById.get(move.destinationLocationId) ?? '',
    }));
  },

  async consumeStock({ tenantId, productId, productProductId, quantity, userId }) {
    void tenantId; void productId; void productProductId; void quantity; void userId;
    throw new Error('تم إيقاف الصرف القديم للمخزون. استخدم الحجز والتسليم المعتمدين.');
  },

  async consumeSerial({ tenantId, productId, productProductId, serialUnitId, userId }) {
    void tenantId; void productId; void productProductId; void serialUnitId; void userId;
    throw new Error('تم إيقاف صرف الوحدات المتسلسلة القديم. استخدم الحجز والتسليم المعتمدين.');
  },

};
