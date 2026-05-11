import { requireSupabase } from '@/core/lib/supabase';
import { productCategoryTrackingIdentifierService, productVariantService } from '@/features/products/api/products.api';

const PRODUCT_COLUMNS =
  'id, tenant_id, category_id, brand_id, name, internal_reference, barcode, product_type, tracking, can_be_sold, can_be_purchased, is_active, sale_price, cost_price, attributes_jsonb, extra_data, default_product_product_id, created_at, updated_at';
const PRODUCT_VARIANT_COLUMNS =
  'id, tenant_id, product_template_id, display_name, sku, barcode, tracking, sale_price, cost_price, is_active, created_at, updated_at';
const QUANT_COLUMNS = 'id, tenant_id, product_product_id, quantity_on_hand, reserved_quantity, created_at, updated_at';
const SERIAL_COLUMNS = 'id, tenant_id, product_product_id, tracking_number, tracking_type, status, notes, created_at, updated_at';
const MOVE_COLUMNS = 'id, tenant_id, product_product_id, move_type, quantity, created_by, notes, created_at';
const TENANT_USER_COLUMNS = 'id, full_name, email';
const MOVE_TYPES = new Set(['in', 'out', 'inventory', 'return', 'reserve', 'release']);
const SERVICE_STOCK_MESSAGE = 'هذا المنتج خدمة ولا يدعم المخزون';
const SERIAL_UNITS_MESSAGE = 'هذا المنتج متتبع بالسيريال ويجب تحديد الوحدات';

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

function assertStockProduct(product) {
  if (isServiceProduct(product)) throw new Error(SERVICE_STOCK_MESSAGE);
}

function assertQuantityProduct(product) {
  assertStockProduct(product);
  if (isSerialProduct(product)) throw new Error(SERIAL_UNITS_MESSAGE);
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
    notes: record.notes ?? '',
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
    moveType: record.move_type ?? '',
    quantity: numberValue(record.quantity),
    userId: record.created_by ?? null,
    notes: record.notes ?? '',
    createdAt: record.created_at ?? null,
  };
}

function byId(records) {
  return new Map((records ?? []).map((record) => [record.id, record]));
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

async function validateCategoryAttributeSelection({ tenantId, productTemplateId, attributeValueIds }) {
  const context = await productVariantService.getTemplateVariantContext({
    tenantId,
    productTemplateId,
  });
  const rawSelectedIds = (attributeValueIds ?? []).filter(Boolean);
  const selectedIds = [...new Set(rawSelectedIds)];

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

  const selectedAttributeIds = new Set(selectedAttributeIdsList);
  const missingRequiredAttribute = (context.attributes ?? []).find(
    (attribute) => attribute.isRequired && !selectedAttributeIds.has(attribute.id),
  );

  if (missingRequiredAttribute) {
    throw new Error(`اختر قيمة "${missingRequiredAttribute.name}" قبل الحفظ.`);
  }

  return {
    ...context,
    selectedIds,
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

async function validateTrackingIdentifierValues({ tenantId, categoryId, serials, valuesBySerial }) {
  if (!categoryId) return { definitions: [], valuesBySerial: {} };

  const definitions = await productCategoryTrackingIdentifierService.listCategoryIdentifiers({ tenantId, categoryId });
  if (!definitions.length) return { definitions: [], valuesBySerial: {} };

  const normalizedValues = {};

  for (const serial of serials) {
    const currentValues = valuesBySerial?.[serial] ?? {};
    normalizedValues[serial] = {};

    for (const definition of definitions) {
      const rawValue = String(currentValues[definition.identifierTypeId] ?? '').trim();
      const slots = getIdentifierSlots(definition);

      if (definition.isRequired && !rawValue) {
        throw new Error(`أدخل قيمة "${definition.name}" للوحدة ${serial}.`);
      }

      if (slots.length && rawValue && slots.every((slot) => slot.type === 'numeric') && !isNumericIdentifierValue(rawValue)) {
        throw new Error(`قيمة "${definition.name}" يجب أن تكون رقمية.`);
      }

      validateIdentifierValueAgainstSchema(definition, rawValue);

      if (rawValue) {
        normalizedValues[serial][definition.identifierTypeId] = rawValue;
      }
    }
  }

  return { definitions, valuesBySerial: normalizedValues };
}

async function saveTrackingUnitIdentifiers(client, { tenantId, units, valuesBySerial }) {
  const rows = [];

  for (const unit of units ?? []) {
    const values = valuesBySerial?.[unit.trackingNumber] ?? {};
    for (const [identifierTypeId, value] of Object.entries(values)) {
      if (!value) continue;
      rows.push({
        tenant_id: tenantId,
        tracking_unit_id: unit.id,
        identifier_type_id: identifierTypeId,
        value,
      });
    }
  }

  if (!rows.length) return;

  const { error } = await client.from('stock_tracking_unit_identifiers').insert(rows);
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

export const inventoryService = {
  async listProducts(tenantId) {
    const client = requireSupabase();
    const productsMap = await loadProductsMap(client, tenantId);
    return Array.from(productsMap.values())
      .filter((product) => product?.isActive && !isServiceProduct(product))
      .sort((left, right) => String(left.name).localeCompare(String(right.name)));
  },

  async addStock({ tenantId, productId, productProductId, attributeValueIds, quantity, serialNumbers, trackingIdentifierValuesBySerial, userId }) {
    const client = requireSupabase();
    const product = await getProduct(client, { tenantId, productId });
    assertStockProduct(product);
    const productTemplateId = product.productTemplateId;
    const attributeSelection = await validateCategoryAttributeSelection({ tenantId, productTemplateId, attributeValueIds });
    const resolvedVariant =
      (await resolveInventoryVariant({ tenantId, productTemplateId, productProductId, attributeValueIds: attributeSelection.selectedIds })) ??
      (productProductId ? await productVariantService.getVariant({ tenantId, id: productProductId }) : null);
    const activeVariantId = resolvedVariant?.id ?? productProductId ?? product.id;

    if (isSerialProduct(product)) {
      const rawSerials = (serialNumbers ?? []).map((item) => item.trim()).filter(Boolean);
      const serials = [...new Set(rawSerials)];
      if (!serials.length) throw new Error(SERIAL_UNITS_MESSAGE);
      if (rawSerials.length !== serials.length) {
        throw new Error('يوجد IMEI / Serial مكرر داخل الإدخال الحالي.');
      }
      const trackingIdentifierValidation = await validateTrackingIdentifierValues({
        tenantId,
        categoryId: product.categoryId,
        serials,
        valuesBySerial: trackingIdentifierValuesBySerial,
      });

      const rows = serials.map((serial) => ({
        tenant_id: tenantId,
        product_product_id: activeVariantId,
        tracking_number: serial,
        tracking_type: 'serial',
        status: 'in_stock',
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
      });
      await createMove(client, {
        tenantId,
        productProductId: activeVariantId,
        moveType: 'in',
        quantity: serials.length,
        userId,
      });
      return { quantity: serials.length };
    }

    assertQuantityProduct(product);
    const nextQuantity = numberValue(quantity);
    if (nextQuantity <= 0) throw new Error('أدخل كمية صحيحة.');

    await increaseQuant(client, { tenantId, productProductId: activeVariantId, quantity: nextQuantity });
    await createMove(client, { tenantId, productProductId: activeVariantId, moveType: 'in', quantity: nextQuantity, userId });
    return { quantity: nextQuantity };
  },

  async getStock({ tenantId }) {
    const client = requireSupabase();
    const [productsMap, quantsResult, serialResult] = await Promise.all([
      loadProductsMap(client, tenantId),
      client.from('stock_quants').select(QUANT_COLUMNS).eq('tenant_id', tenantId),
      client.from('stock_tracking_units').select(SERIAL_COLUMNS).eq('tenant_id', tenantId).eq('status', 'in_stock'),
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

  async getSerialUnits({ tenantId, productId, productProductId, status }) {
    const client = requireSupabase();
    if (productId && productId !== 'all') {
      const product = await getProduct(client, { tenantId, productId });
      assertSerialProduct(product);
    }

    let query = client.from('stock_tracking_units').select(SERIAL_COLUMNS).eq('tenant_id', tenantId);

    if (productId && productId !== 'all') query = query.eq('product_product_id', productId);
    if (productProductId && productProductId !== 'all') query = query.eq('product_product_id', productProductId);
    if (status && status !== 'all') query = query.eq('status', status);

    const [{ data, error }, productsMap] = await Promise.all([query.order('created_at', { ascending: false }), loadProductsMap(client, tenantId)]);
    if (error) throw new Error(error.message);

    return (data ?? []).map(normalizeSerial).map((unit) => ({
      ...unit,
      product: productsMap.get(unit.productProductId) ?? null,
    }));
  },

  async getStockMoves({ tenantId }) {
    const client = requireSupabase();
    const [{ data, error }, productsMap] = await Promise.all([
      client.from('stock_moves').select(MOVE_COLUMNS).eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(200),
      loadProductsMap(client, tenantId),
    ]);
    if (error) throw new Error(error.message);
    const moves = (data ?? []).map(normalizeMove);
    const usersById = await loadUsersById(client, tenantId, moves.map((move) => move.userId));

    return moves.map((move) => ({
      ...move,
      product: productsMap.get(move.productProductId) ?? null,
      userName: usersById.get(move.userId) ?? move.userId ?? '-',
    }));
  },

  async consumeStock({ tenantId, productId, productProductId, quantity, userId }) {
    const client = requireSupabase();
    const product = await getProduct(client, { tenantId, productId });
    assertQuantityProduct(product);

    const activeVariantId = productProductId ?? product.id;
    await decreaseQuant(client, { tenantId, productProductId: activeVariantId, quantity });
    return createMove(client, { tenantId, productProductId: activeVariantId, moveType: 'out', quantity, userId });
  },

  async consumeSerial({ tenantId, productId, productProductId, serialUnitId, userId }) {
    const client = requireSupabase();
    const product = await getProduct(client, { tenantId, productId });
    assertSerialProduct(product);
    const activeVariantId = productProductId ?? product.id;

    const { data: unit, error: unitError } = await client
      .from('stock_tracking_units')
      .select(SERIAL_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', serialUnitId)
      .eq('product_product_id', activeVariantId)
      .eq('status', 'in_stock')
      .maybeSingle();

    if (unitError) throw new Error(unitError.message);
    if (!unit) throw new Error(SERIAL_UNITS_MESSAGE);

    const { error } = await client.from('stock_tracking_units').update({ status: 'sold' }).eq('id', serialUnitId);
    if (error) throw new Error(error.message);

    await createMove(client, {
      tenantId,
      productProductId: unit.product_product_id ?? activeVariantId,
      moveType: 'out',
      quantity: 1,
      userId,
    });
    return normalizeSerial({ ...unit, status: 'sold' });
  },

  async adjustStock({ tenantId, productId, productProductId, quantity, userId }) {
    const client = requireSupabase();
    const product = await getProduct(client, { tenantId, productId });
    assertQuantityProduct(product);

    const nextQuantity = numberValue(quantity);
    if (nextQuantity < 0) throw new Error('الكمية لا يمكن أن تكون سالبة.');

    const activeVariantId = productProductId ?? product.id;
    const existing = await getQuantRecord(client, { tenantId, productProductId: activeVariantId });
    const currentQuantity = numberValue(existing?.quantity);
    const difference = nextQuantity - currentQuantity;

    if (existing) {
      const { error } = await client.from('stock_quants').update({ quantity_on_hand: nextQuantity }).eq('id', existing.id);
      if (error) throw new Error(error.message);
    } else if (nextQuantity > 0) {
      const { error } = await client.from('stock_quants').insert({
        tenant_id: tenantId,
        product_product_id: activeVariantId,
        quantity_on_hand: nextQuantity,
      });
      if (error) throw new Error(error.message);
    }

    if (difference !== 0) {
      await createMove(client, {
        tenantId,
        productProductId: activeVariantId,
        moveType: 'inventory',
        quantity: Math.abs(difference),
        userId,
        notes: difference > 0 ? 'تسوية زيادة' : 'تسوية نقص',
      });
    }

    return { quantity: nextQuantity };
  },
};
