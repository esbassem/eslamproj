import { requireSupabase } from '@/core/lib/supabase';

const PRODUCT_TEMPLATE_COLUMNS =
  'id, tenant_id, category_id, brand_id, name, internal_reference, barcode, product_type, tracking, can_be_sold, can_be_purchased, is_active, sale_price, cost_price, attributes_jsonb, extra_data, default_product_product_id, requires_contract, requires_ownership_transfer, requires_post_sale_documents, requires_license, created_at, updated_at';
const PRODUCT_VARIANT_COLUMNS =
  'id, tenant_id, product_template_id, display_name, sku, barcode, tracking, sale_price, cost_price, is_active, created_at, updated_at';
const ATTRIBUTE_COLUMNS =
  'id, tenant_id, name, behavior, creates_variant, show_in_variant_name, display_type, show_in_pos_filter, is_filterable, use_in_sku, sort_order, is_active, created_at, updated_at';
const ATTRIBUTE_VALUE_COLUMNS =
  'id, tenant_id, attribute_id, name, code, color_hex, image_url, extra_price, show_in_variant_name, sort_order, is_active, created_at, updated_at';
const CATEGORY_ATTRIBUTE_COLUMNS = 'id, tenant_id, category_id, attribute_id, is_required, display_order, created_at';
const TRACKING_IDENTIFIER_TYPE_COLUMNS = 'id, tenant_id, code, name, data_type, is_active, input_schema, created_at';
const CATEGORY_TRACKING_IDENTIFIER_COLUMNS = 'id, tenant_id, category_id, identifier_type_id, is_required, allow_not_available, sequence, created_at';
const TRACKING_UNIT_COLUMNS =
  'id, tenant_id, product_product_id, tracking_number, tracking_type, status, notes, created_at, updated_at';

function money(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function stockTrackingValue(payload) {
  if (payload.productType === 'service' || payload.productType === 'consumable') return 'none';
  return payload.tracking ?? 'none';
}

function normalizeProduct(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    name: record.name ?? '',
    categoryId: record.category_id ?? null,
    brandId: record.brand_id ?? null,
    internalReference: record.internal_reference ?? '',
    barcode: record.barcode ?? '',
    productType: record.product_type ?? 'goods',
    tracking: record.tracking ?? 'none',
    canBeSold: record.can_be_sold ?? true,
    canBePurchased: record.can_be_purchased ?? false,
    isActive: record.is_active ?? true,
    salePrice: money(record.sale_price),
    costPrice: money(record.cost_price),
    attributesJsonb: record.attributes_jsonb ?? [],
    defaultProductProductId: record.default_product_product_id ?? null,
    requiresContract: record.requires_contract ?? false,
    requiresOwnershipTransfer: record.requires_ownership_transfer ?? false,
    requiresPostSaleDocuments: record.requires_post_sale_documents ?? false,
    requiresLicense: record.requires_license ?? false,
    variantCount: record.variant_count ?? 0,
    extraData: record.extra_data ?? null,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function normalizeProductVariant(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    productTemplateId: record.product_template_id ?? null,
    displayName: record.display_name ?? '',
    sku: record.sku ?? '',
    barcode: record.barcode ?? '',
    tracking: record.tracking ?? 'none',
    salePrice: money(record.sale_price),
    costPrice: money(record.cost_price),
    isActive: record.is_active ?? true,
    attributeValues: record.attributeValues ?? [],
    attributeValueIds: record.attributeValueIds ?? [],
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function normalizeCategory(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    parentId: record.parent_id ?? null,
    name: record.name ?? '',
    defaultProductType: record.default_product_type ?? '',
    defaultTracking: record.default_tracking ?? 'none',
    defaultCanBeSold: record.default_can_be_sold ?? true,
    defaultCanBePurchased: record.default_can_be_purchased ?? true,
    defaultIsActive: record.default_is_active ?? true,
    defaultRequiresContract: record.default_requires_contract ?? false,
    defaultRequiresOwnershipTransfer: record.default_requires_ownership_transfer ?? false,
    defaultRequiresPostSaleDocuments: record.default_requires_post_sale_documents ?? false,
    defaultRequiresLicense: record.default_requires_license ?? false,
    displayPrefix: record.display_prefix ?? '',
    isActive: record.is_active ?? true,
    sortOrder: record.sort_order ?? 0,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function normalizeBrand(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    name: record.name ?? '',
    code: record.code ?? '',
    logoUrl: record.logo_url ?? '',
    sortOrder: record.sort_order ?? 0,
    isActive: record.is_active ?? true,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function normalizeAttribute(record) {
  if (!record) return null;

  const behavior = record.behavior ?? 'variant';

  return {
    id: record.id,
    tenantId: record.tenant_id,
    name: record.name ?? '',
    behavior,
    createsVariant: record.creates_variant ?? (behavior !== 'informational'),
    showInVariantName: record.show_in_variant_name ?? true,
    displayType: record.display_type ?? 'select',
    showInPosFilter: record.show_in_pos_filter ?? false,
    isFilterable: record.is_filterable ?? false,
    useInSku: record.use_in_sku ?? false,
    sortOrder: Number(record.sort_order) || 0,
    isActive: record.is_active ?? true,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function normalizeAttributeValue(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    attributeId: record.attribute_id ?? null,
    name: record.name ?? '',
    code: record.code ?? '',
    colorHex: record.color_hex ?? '',
    imageUrl: record.image_url ?? '',
    extraPrice: money(record.extra_price),
    showInVariantName: record.show_in_variant_name ?? true,
    sortOrder: record.sort_order ?? 0,
    isActive: record.is_active ?? true,
    attribute: normalizeAttribute(record.attribute),
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function normalizeTrackingUnit(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    productProductId: record.product_product_id ?? null,
    trackingNumber: record.tracking_number ?? '',
    trackingType: record.tracking_type ?? '',
    status: record.status ?? '',
    notes: record.notes ?? '',
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function normalizeCategoryAttributeLink(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    categoryId: record.category_id ?? null,
    attributeId: record.attribute_id ?? null,
    isRequired: record.is_required ?? false,
    displayOrder: Number(record.display_order) || 0,
    createdAt: record.created_at ?? null,
  };
}

function normalizeTrackingIdentifierType(record) {
  if (!record) return null;
  const inputSchema = record.input_schema && typeof record.input_schema === 'object' ? record.input_schema : {};

  return {
    id: record.id,
    tenantId: record.tenant_id,
    code: record.code ?? '',
    name: record.name ?? '',
    dataType: record.data_type === 'numeric' ? 'numeric' : 'text',
    inputSchema,
    hasSlotPattern: Array.isArray(inputSchema.slots) && inputSchema.slots.length > 0,
    slotCount: Array.isArray(inputSchema.slots) ? inputSchema.slots.length : 0,
    slots: Array.isArray(inputSchema.slots) ? inputSchema.slots : [],
    isActive: record.is_active ?? true,
    createdAt: record.created_at ?? null,
  };
}

function normalizeTrackingIdentifierInputSchema(payload) {
  const slots = Array.isArray(payload?.slots)
    ? payload.slots
        .map((slot) => {
          const type = ['english_letter', 'arabic_letter', 'numeric'].includes(slot?.type) ? slot.type : '';
          return { type };
        })
        .filter((_, index) => index < 24)
    : [];

  return payload?.hasSlotPattern && slots.length
    ? {
        version: 1,
        slots,
      }
    : {};
}

function normalizeCategoryTrackingIdentifierLink(record) {
  if (!record) return null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    categoryId: record.category_id ?? null,
    identifierTypeId: record.identifier_type_id ?? null,
    isRequired: record.is_required ?? false,
    allowNotAvailable: record.allow_not_available ?? false,
    sequence: Number(record.sequence) || 0,
    createdAt: record.created_at ?? null,
  };
}

function byId(records) {
  return new Map((records ?? []).map((record) => [record.id, record]));
}

function normalizeAttributeSelection(selection) {
  return [...new Map(
    (selection ?? [])
      .filter(Boolean)
      .map((item) => {
        if (typeof item === 'string') {
          return [item, { attributeId: null, valueId: item, valueName: '', extraPrice: 0 }];
        }

        const valueId = item.valueId ?? item.value_id ?? item.id ?? null;
        if (!valueId) return null;

        return [
          valueId,
          {
            attributeId: item.attributeId ?? item.attribute_id ?? null,
            attributeName: item.attributeName ?? item.attribute_name ?? '',
            attributeBehavior: item.attributeBehavior ?? item.attribute_behavior ?? 'variant',
            createsVariant: item.createsVariant ?? item.creates_variant ?? true,
            attributeShowInVariantName: item.attributeShowInVariantName ?? item.attribute_show_in_variant_name ?? true,
            displayType: item.displayType ?? item.display_type ?? 'select',
            showInPosFilter: item.showInPosFilter ?? item.show_in_pos_filter ?? false,
            isFilterable: item.isFilterable ?? item.is_filterable ?? false,
            useInSku: item.useInSku ?? item.use_in_sku ?? false,
            attributeSortOrder: Number(item.attributeSortOrder ?? item.attribute_sort_order) || 0,
            valueId,
            valueName: item.valueName ?? item.value_name ?? item.name ?? '',
            valueCode: item.valueCode ?? item.value_code ?? item.code ?? '',
            colorHex: item.colorHex ?? item.color_hex ?? '',
            imageUrl: item.imageUrl ?? item.image_url ?? '',
            extraPrice: money(item.extraPrice ?? item.extra_price),
            valueShowInVariantName: item.valueShowInVariantName ?? item.value_show_in_variant_name ?? item.show_in_variant_name ?? true,
            valueSortOrder: Number(item.valueSortOrder ?? item.value_sort_order ?? item.sort_order) || 0,
          },
        ];
      })
      .filter(Boolean),
  ).values()];
}

function makeAttributeSignature(selection) {
  return normalizeAttributeSelection(selection)
    .filter((item) => item.createsVariant !== false)
    .map((item) => item.valueId)
    .sort()
    .join('|');
}

function joinDisplayNameParts(parts) {
  return parts.map((part) => String(part ?? '').trim()).filter(Boolean).join(' / ');
}

function sortSelectionForDisplay(left, right) {
  const orderDiff = (left.attributeSortOrder ?? 0) - (right.attributeSortOrder ?? 0);
  if (orderDiff !== 0) return orderDiff;

  const valueOrderDiff = (left.valueSortOrder ?? 0) - (right.valueSortOrder ?? 0);
  if (valueOrderDiff !== 0) return valueOrderDiff;

  const nameDiff = String(left.attributeName ?? '').localeCompare(String(right.attributeName ?? ''));
  if (nameDiff !== 0) return nameDiff;

  return String(left.valueName ?? '').localeCompare(String(right.valueName ?? ''));
}

function shouldShowSelectionInVariantName(item) {
  return item.attributeShowInVariantName !== false && item.valueShowInVariantName !== false;
}

function buildVariantDisplayName(baseName, selection) {
  const normalizedSelection = normalizeAttributeSelection(selection)
    .filter((item) => item.createsVariant !== false)
    .filter((item) => shouldShowSelectionInVariantName(item))
    .sort(sortSelectionForDisplay);
  const commercialValues = normalizedSelection
    .filter((item) => item.attributeBehavior === 'commercial')
    .map((item) => item.valueName)
    .filter(Boolean);
  const variantValues = normalizedSelection
    .filter((item) => item.attributeBehavior !== 'commercial')
    .map((item) => item.valueName)
    .filter(Boolean);

  return joinDisplayNameParts([baseName, ...commercialValues, ...variantValues]);
}

function buildVariantSku(template, selection) {
  const baseSku = template?.internal_reference?.trim() || '';
  const selectionCodes = normalizeAttributeSelection(selection)
    .filter((item) => item.createsVariant !== false && item.useInSku)
    .map((item) => item.valueCode)
    .filter(Boolean);

  return [baseSku, ...selectionCodes].filter(Boolean).join('-');
}

async function getCategoryDisplayPrefix(client, { tenantId, categoryId }) {
  if (!categoryId) return '';

  const { data, error } = await client
    .from('product_categories')
    .select('display_prefix')
    .eq('tenant_id', tenantId)
    .eq('id', categoryId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.display_prefix?.trim() || '';
}

async function resolveTemplateBaseDisplayName(client, { tenantId, templateRecord }) {
  const prefix = Object.prototype.hasOwnProperty.call(templateRecord ?? {}, 'display_prefix')
    ? templateRecord?.display_prefix?.trim() || ''
    : await getCategoryDisplayPrefix(client, { tenantId, categoryId: templateRecord?.category_id });

  return joinDisplayNameParts([prefix, templateRecord?.name ?? '']);
}

async function listCategoryAttributeLinks(client, { tenantId, categoryIds, attributeIds } = {}) {
  let query = client
    .from('product_category_attributes')
    .select(CATEGORY_ATTRIBUTE_COLUMNS)
    .eq('tenant_id', tenantId);

  const normalizedCategoryIds = [...new Set((categoryIds ?? []).filter(Boolean))];
  const normalizedAttributeIds = [...new Set((attributeIds ?? []).filter(Boolean))];

  if (normalizedCategoryIds.length) {
    query = query.in('category_id', normalizedCategoryIds);
  }

  if (normalizedAttributeIds.length) {
    query = query.in('attribute_id', normalizedAttributeIds);
  }

  const { data, error } = await query
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizeCategoryAttributeLink);
}

async function listCategoryTrackingIdentifierLinks(client, { tenantId, categoryIds, identifierTypeIds } = {}) {
  let query = client
    .from('product_category_tracking_identifiers')
    .select(CATEGORY_TRACKING_IDENTIFIER_COLUMNS)
    .eq('tenant_id', tenantId);

  const normalizedCategoryIds = [...new Set((categoryIds ?? []).filter(Boolean))];
  const normalizedIdentifierTypeIds = [...new Set((identifierTypeIds ?? []).filter(Boolean))];

  if (normalizedCategoryIds.length) {
    query = query.in('category_id', normalizedCategoryIds);
  }

  if (normalizedIdentifierTypeIds.length) {
    query = query.in('identifier_type_id', normalizedIdentifierTypeIds);
  }

  const { data, error } = await query
    .order('sequence', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map(normalizeCategoryTrackingIdentifierLink);
}

async function listCategoryTrackingIdentifierDefinitions(client, { tenantId, categoryId }) {
  if (!categoryId) return [];

  const links = await listCategoryTrackingIdentifierLinks(client, { tenantId, categoryIds: [categoryId] });
  const identifierTypeIds = [...new Set(links.map((link) => link.identifierTypeId).filter(Boolean))];
  if (!identifierTypeIds.length) return [];

  const { data, error } = await client
    .from('product_tracking_identifier_types')
    .select(TRACKING_IDENTIFIER_TYPE_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .in('id', identifierTypeIds);

  if (error) throw new Error(error.message);

  const typesById = byId((data ?? []).map(normalizeTrackingIdentifierType));
  return links
    .map((link) => {
      const type = typesById.get(link.identifierTypeId);
      if (!type) return null;
      return {
        ...link,
        identifierType: type,
        name: type.name,
        code: type.code,
        allowNotAvailable: link.allowNotAvailable,
        dataType: type.dataType,
        inputSchema: type.inputSchema,
        hasSlotPattern: type.hasSlotPattern,
        slotCount: type.slotCount,
        slots: type.slots,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const orderDiff = (left.sequence ?? 0) - (right.sequence ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return String(left.name ?? '').localeCompare(String(right.name ?? ''));
    });
}

async function listCategoryAttributesWithValues(client, { tenantId, categoryId }) {
  if (!categoryId) return [];

  const hierarchy = await getCategoryHierarchy(client, { tenantId, categoryId });
  const links = await listInheritedCategoryAttributeLinks(client, { tenantId, hierarchy });
  const attributeIds = [...new Set(links.map((link) => link.attributeId).filter(Boolean))];

  if (!attributeIds.length) return [];

  const [{ data: attributeRows, error: attributesError }, { data: valueRows, error: valuesError }] = await Promise.all([
    client.from('product_attributes').select(ATTRIBUTE_COLUMNS).eq('tenant_id', tenantId).eq('is_active', true).in('id', attributeIds),
    client
      .from('product_attribute_values')
      .select(ATTRIBUTE_VALUE_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('attribute_id', attributeIds)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ]);

  if (attributesError) throw new Error(attributesError.message);
  if (valuesError) throw new Error(valuesError.message);

  const attributesById = byId((attributeRows ?? []).map(normalizeAttribute));
  const valuesByAttributeId = (valueRows ?? []).map(normalizeAttributeValue).reduce((map, value) => {
    const current = map.get(value.attributeId) ?? [];
    current.push(value);
    map.set(value.attributeId, current);
    return map;
  }, new Map());

  return links
    .map((link) => {
      const attribute = attributesById.get(link.attributeId);
      if (!attribute) return null;

      return {
        ...attribute,
        isRequired: link.isRequired,
        displayOrder: link.displayOrder,
        sourceCategoryId: link.categoryId,
        values: valuesByAttributeId.get(link.attributeId) ?? [],
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const displayOrderDiff = (left.displayOrder ?? 0) - (right.displayOrder ?? 0);
      if (displayOrderDiff !== 0) return displayOrderDiff;

      const attributeOrderDiff = (left.sortOrder ?? 0) - (right.sortOrder ?? 0);
      if (attributeOrderDiff !== 0) return attributeOrderDiff;

      return String(left.name ?? '').localeCompare(String(right.name ?? ''));
    });
}

async function getCategoryHierarchy(client, { tenantId, categoryId }) {
  if (!categoryId) return [];

  const { data, error } = await client
    .from('product_categories')
    .select('id, parent_id')
    .eq('tenant_id', tenantId);

  if (error) throw new Error(error.message);

  const categoriesById = new Map((data ?? []).map((row) => [row.id, row]));
  const hierarchy = [];
  const visited = new Set();
  let currentId = categoryId;

  while (currentId && !visited.has(currentId)) {
    const category = categoriesById.get(currentId);
    if (!category) break;

    hierarchy.push(category.id);
    visited.add(category.id);
    currentId = category.parent_id ?? null;
  }

  return hierarchy;
}

async function listInheritedCategoryAttributeLinks(client, { tenantId, hierarchy }) {
  const categoryIds = [...new Set((hierarchy ?? []).filter(Boolean))];
  if (!categoryIds.length) return [];

  const links = await listCategoryAttributeLinks(client, { tenantId, categoryIds });
  const categoryPriority = new Map(categoryIds.map((id, index) => [id, index]));

  return [...links]
    .sort((left, right) => {
      const categoryDiff = (categoryPriority.get(left.categoryId) ?? Number.MAX_SAFE_INTEGER) - (categoryPriority.get(right.categoryId) ?? Number.MAX_SAFE_INTEGER);
      if (categoryDiff !== 0) return categoryDiff;

      const displayDiff = (left.displayOrder ?? 0) - (right.displayOrder ?? 0);
      if (displayDiff !== 0) return displayDiff;
      return String(left.attributeId).localeCompare(String(right.attributeId));
    })
    .reduce((accumulator, link) => {
      if (accumulator.some((item) => item.attributeId === link.attributeId)) {
        return accumulator;
      }

      accumulator.push(link);
      return accumulator;
    }, []);
}

async function loadAttributeValuesSelection(client, { tenantId, attributeValueIds }) {
  const rawIds = (attributeValueIds ?? []).filter(Boolean);
  const normalizedIds = [...new Set(rawIds)];
  if (rawIds.length !== normalizedIds.length) {
    throw new Error('لا يمكن تكرار نفس قيمة الخاصية أكثر من مرة.');
  }
  if (!normalizedIds.length) return [];

  const valuesById = await loadAttributeValuesMap(client, normalizedIds);
  const missingValueId = normalizedIds.find((valueId) => !valuesById.has(valueId));
  if (missingValueId) {
    throw new Error('إحدى قيم الخصائص المحددة غير موجودة.');
  }

  return normalizedIds.map((valueId) => {
    const value = valuesById.get(valueId);
    return {
      attributeId: value.attributeId,
      attributeName: value.attribute?.name ?? '',
      attributeBehavior: value.attribute?.behavior ?? 'variant',
      createsVariant: value.attribute?.createsVariant ?? true,
      attributeShowInVariantName: value.attribute?.showInVariantName ?? true,
      displayType: value.attribute?.displayType ?? 'select',
      showInPosFilter: value.attribute?.showInPosFilter ?? false,
      isFilterable: value.attribute?.isFilterable ?? false,
      useInSku: value.attribute?.useInSku ?? false,
      attributeSortOrder: value.attribute?.sortOrder ?? 0,
      valueId,
      valueName: value.name,
      valueCode: value.code,
      colorHex: value.colorHex,
      imageUrl: value.imageUrl,
      extraPrice: value.extraPrice,
      valueShowInVariantName: value.showInVariantName,
      valueSortOrder: value.sortOrder,
    };
  });
}

async function syncAttributeCategoryLinks(client, { tenantId, attributeId, categoryIds, behavior }) {
  const isCommercial = behavior === 'commercial';
  const normalizedCategoryIds = [...new Set((categoryIds ?? []).filter(Boolean))];
  const existingLinks = await listCategoryAttributeLinks(client, { tenantId, attributeIds: [attributeId] });
  const existingByCategoryId = new Map(existingLinks.map((link) => [link.categoryId, link]));

  const categoryIdsToDelete = existingLinks
    .map((link) => link.categoryId)
    .filter((categoryId) => !normalizedCategoryIds.includes(categoryId));

  if (categoryIdsToDelete.length) {
    const { error } = await client
      .from('product_category_attributes')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('attribute_id', attributeId)
      .in('category_id', categoryIdsToDelete);

    if (error) throw new Error(error.message);
  }

  if (!normalizedCategoryIds.length) return;

  const rows = normalizedCategoryIds.map((categoryId) => ({
    tenant_id: tenantId,
    category_id: categoryId,
    attribute_id: attributeId,
    is_required: existingByCategoryId.has(categoryId)
      ? (existingByCategoryId.get(categoryId)?.isRequired ?? false)
      : (isCommercial ? true : false),
    display_order: existingByCategoryId.get(categoryId)?.displayOrder ?? 0,
  }));

  const { error } = await client.from('product_category_attributes').upsert(rows, { onConflict: 'tenant_id,category_id,attribute_id' });
  if (error) throw new Error(error.message);
}

async function syncCategoryAttributeLinks(client, { tenantId, categoryId, attributeLinks }) {
  const normalizedLinks = [...new Map(
    (attributeLinks ?? [])
      .filter((item) => item?.attributeId)
      .map((item) => [
        item.attributeId,
        {
          attributeId: item.attributeId,
          isRequired: Boolean(item.isRequired),
          displayOrder: Number(item.displayOrder) || 0,
        },
      ]),
  ).values()];
  const existingLinks = await listCategoryAttributeLinks(client, { tenantId, categoryIds: [categoryId] });
  const attributeIdsToDelete = existingLinks
    .map((link) => link.attributeId)
    .filter((attributeId) => !normalizedLinks.some((item) => item.attributeId === attributeId));

  if (attributeIdsToDelete.length) {
    const { error } = await client
      .from('product_category_attributes')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('category_id', categoryId)
      .in('attribute_id', attributeIdsToDelete);

    if (error) throw new Error(error.message);
  }

  if (!normalizedLinks.length) return;

  const rows = normalizedLinks.map((item) => ({
    tenant_id: tenantId,
    category_id: categoryId,
    attribute_id: item.attributeId,
    is_required: item.isRequired,
    display_order: item.displayOrder,
  }));

  const { error } = await client.from('product_category_attributes').upsert(rows, { onConflict: 'tenant_id,category_id,attribute_id' });
  if (error) throw new Error(error.message);
}

async function syncCategoryTrackingIdentifierLinks(client, { tenantId, categoryId, trackingIdentifierLinks }) {
  const normalizedLinks = [...new Map(
    (trackingIdentifierLinks ?? [])
      .filter((item) => item?.identifierTypeId)
      .map((item) => [
        item.identifierTypeId,
        {
          identifierTypeId: item.identifierTypeId,
          isRequired: Boolean(item.isRequired),
          allowNotAvailable: Boolean(item.allowNotAvailable),
          sequence: Number(item.sequence) || 0,
        },
      ]),
  ).values()];

  const { error: deleteError } = await client
    .from('product_category_tracking_identifiers')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('category_id', categoryId);

  if (deleteError) throw new Error(deleteError.message);
  if (!normalizedLinks.length) return;

  const rows = normalizedLinks.map((item) => ({
    tenant_id: tenantId,
    category_id: categoryId,
    identifier_type_id: item.identifierTypeId,
    is_required: item.isRequired,
    allow_not_available: item.allowNotAvailable,
    sequence: item.sequence,
  }));

  const { error } = await client.from('product_category_tracking_identifiers').insert(rows);
  if (error) throw new Error(error.message);
}

async function loadAttributeValuesMap(client, ids) {
  const valueIds = [...new Set((ids ?? []).filter(Boolean))];
  if (!valueIds.length) return new Map();

  const { data, error } = await client
    .from('product_attribute_values')
    .select(ATTRIBUTE_VALUE_COLUMNS)
    .in('id', valueIds);

  if (error) throw new Error(error.message);
  const values = (data ?? []).map(normalizeAttributeValue);
  const attributeIds = [...new Set(values.map((value) => value.attributeId).filter(Boolean))];
  let attributesById = new Map();

  if (attributeIds.length) {
    const { data: attributeRows, error: attributesError } = await client
      .from('product_attributes')
      .select(ATTRIBUTE_COLUMNS)
      .in('id', attributeIds);

    if (attributesError) throw new Error(attributesError.message);
    attributesById = byId((attributeRows ?? []).map(normalizeAttribute));
  }

  return byId(values.map((value) => ({
    ...value,
    attribute: attributesById.get(value.attributeId) ?? null,
  })));
}

async function listVariantsByTemplateIds(client, { tenantId, templateIds }) {
  const ids = [...new Set((templateIds ?? []).filter(Boolean))];
  if (!ids.length) return [];

  const { data: variantsData, error: variantsError } = await client
    .from('product_products')
    .select(PRODUCT_VARIANT_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('product_template_id', ids)
    .order('created_at', { ascending: true });

  if (variantsError) throw new Error(variantsError.message);

  const variants = (variantsData ?? []).map(normalizeProductVariant);
  const variantIds = variants.map((variant) => variant.id);

  if (!variantIds.length) return variants;

  const { data: linkRows, error: linksError } = await client
    .from('product_product_attribute_values')
    .select('product_product_id, attribute_id, attribute_value_id')
    .eq('tenant_id', tenantId)
    .in('product_product_id', variantIds);

  if (linksError) throw new Error(linksError.message);

  const attributeValueIds = [...new Set((linkRows ?? []).map((row) => row.attribute_value_id).filter(Boolean))];
  const attributeValuesById = await loadAttributeValuesMap(client, attributeValueIds);
  const linksByVariantId = (linkRows ?? []).reduce((map, row) => {
    const current = map.get(row.product_product_id) ?? [];
    const value = attributeValuesById.get(row.attribute_value_id);
    current.push({
      attributeId: row.attribute_id ?? value?.attributeId ?? null,
      attributeName: value?.attribute?.name ?? '',
      attributeBehavior: value?.attribute?.behavior ?? 'variant',
      createsVariant: value?.attribute?.createsVariant ?? true,
      attributeShowInVariantName: value?.attribute?.showInVariantName ?? true,
      displayType: value?.attribute?.displayType ?? 'select',
      showInPosFilter: value?.attribute?.showInPosFilter ?? false,
      isFilterable: value?.attribute?.isFilterable ?? false,
      useInSku: value?.attribute?.useInSku ?? false,
      attributeSortOrder: value?.attribute?.sortOrder ?? 0,
      valueId: row.attribute_value_id,
      valueName: value?.name ?? '',
      valueCode: value?.code ?? '',
      colorHex: value?.colorHex ?? '',
      imageUrl: value?.imageUrl ?? '',
      extraPrice: value?.extraPrice ?? 0,
      valueShowInVariantName: value?.showInVariantName ?? true,
      valueSortOrder: value?.sortOrder ?? 0,
    });
    map.set(row.product_product_id, current);
    return map;
  }, new Map());

  return variants.map((variant) => {
    const attributeValues = normalizeAttributeSelection(linksByVariantId.get(variant.id) ?? []);
    return normalizeProductVariant({
      ...variant,
      attributeValues,
      attributeValueIds: attributeValues.map((item) => item.valueId),
    });
  });
}

async function getTemplateRecord(client, { tenantId, productTemplateId }) {
  const { data, error } = await client
    .from('product_templates')
    .select(PRODUCT_TEMPLATE_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', productTemplateId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error('المنتج غير موجود.');
  return data;
}

async function syncDefaultVariant(client, { tenantId, templateRecord }) {
  const resolvedVariant = await getOrCreateVariant(client, {
    tenantId,
    productTemplateId: templateRecord.id,
    selection: [],
    templateRecord,
    salePriceOverride: money(templateRecord.sale_price),
    costPriceOverride: money(templateRecord.cost_price),
  });

  if (templateRecord.default_product_product_id !== resolvedVariant.id) {
    const { error } = await client
      .from('product_templates')
      .update({ default_product_product_id: resolvedVariant.id })
      .eq('id', templateRecord.id);

    if (error) throw new Error(error.message);
  }

  return resolvedVariant;
}

async function refreshTemplateVariantDisplayNames(client, { tenantId, templateRecord }) {
  const baseName = await resolveTemplateBaseDisplayName(client, { tenantId, templateRecord });
  const variants = await listVariantsByTemplateIds(client, { tenantId, templateIds: [templateRecord.id] });

  for (const variant of variants) {
    const nextDisplayName = buildVariantDisplayName(baseName, variant.attributeValues);
    const nextSku = buildVariantSku(templateRecord, variant.attributeValues) || null;
    if (nextDisplayName === variant.displayName && nextSku === (variant.sku || null)) continue;

    const { error } = await client
      .from('product_products')
      .update({
        display_name: nextDisplayName,
        sku: nextSku,
        updated_at: new Date().toISOString(),
      })
      .eq('id', variant.id);

    if (error) throw new Error(error.message);
  }
}

async function refreshTemplatesByAttributeIds(client, { tenantId, attributeIds }) {
  const normalizedAttributeIds = [...new Set((attributeIds ?? []).filter(Boolean))];
  if (!normalizedAttributeIds.length) return;

  const { data: variantLinkRows, error: variantLinksError } = await client
    .from('product_product_attribute_values')
    .select('product_product_id')
    .eq('tenant_id', tenantId)
    .in('attribute_id', normalizedAttributeIds);

  if (variantLinksError) throw new Error(variantLinksError.message);

  const variantIds = [...new Set((variantLinkRows ?? []).map((row) => row.product_product_id).filter(Boolean))];
  if (!variantIds.length) return;

  const { data: variantRows, error: variantsError } = await client
    .from('product_products')
    .select('id, product_template_id')
    .eq('tenant_id', tenantId)
    .in('id', variantIds);

  if (variantsError) throw new Error(variantsError.message);

  const templateIds = [...new Set((variantRows ?? []).map((row) => row.product_template_id).filter(Boolean))];
  if (!templateIds.length) return;

  const { data: templateRows, error: templatesError } = await client
    .from('product_templates')
    .select(PRODUCT_TEMPLATE_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', templateIds);

  if (templatesError) throw new Error(templatesError.message);

  for (const templateRecord of templateRows ?? []) {
    await refreshTemplateVariantDisplayNames(client, { tenantId, templateRecord });
  }
}

async function getOrCreateVariant(
  client,
  { tenantId, productTemplateId, attributeValueIds, selection, templateRecord, salePriceOverride, costPriceOverride },
) {
  const template = templateRecord ?? await getTemplateRecord(client, { tenantId, productTemplateId });
  const baseName = await resolveTemplateBaseDisplayName(client, { tenantId, templateRecord: template });
  const normalizedSelection = normalizeAttributeSelection(
    selection ?? await loadAttributeValuesSelection(client, { tenantId, attributeValueIds }),
  );
  const variantSelection = normalizedSelection.filter((item) => item.createsVariant !== false);
  const signature = makeAttributeSignature(variantSelection);
  const variants = await listVariantsByTemplateIds(client, { tenantId, templateIds: [productTemplateId] });
  const existingVariant = variants.find((variant) => makeAttributeSignature(variant.attributeValues) === signature);
  const nextDisplayName = buildVariantDisplayName(baseName, variantSelection);
  const nextSku = buildVariantSku(template, variantSelection) || null;

  if (existingVariant) {
    const body = {
      display_name: nextDisplayName,
      sku: nextSku,
      barcode: template.barcode?.trim() || null,
      tracking: template.tracking ?? 'none',
      is_active: template.is_active ?? true,
      updated_at: new Date().toISOString(),
    };

    if (salePriceOverride !== undefined) {
      body.sale_price = money(salePriceOverride);
    }

    if (costPriceOverride !== undefined) {
      body.cost_price = money(costPriceOverride);
    }

    const { error } = await client.from('product_products').update(body).eq('id', existingVariant.id);
    if (error) throw new Error(error.message);

    return normalizeProductVariant({
      ...existingVariant,
      ...body,
      attributeValues: existingVariant.attributeValues,
      attributeValueIds: existingVariant.attributeValueIds,
    });
  }

  const { data: createdVariant, error: variantError } = await client
    .from('product_products')
    .insert({
      tenant_id: tenantId,
      product_template_id: productTemplateId,
      display_name: nextDisplayName,
      sku: nextSku,
      barcode: template.barcode?.trim() || null,
      tracking: template.tracking ?? 'none',
      sale_price: money(salePriceOverride ?? (money(template.sale_price) + variantSelection.reduce((sum, item) => sum + money(item.extraPrice), 0))),
      cost_price: money(costPriceOverride ?? template.cost_price),
      is_active: template.is_active ?? true,
    })
    .select(PRODUCT_VARIANT_COLUMNS)
    .single();

  if (variantError) throw new Error(variantError.message);

  if (variantSelection.length) {
    const { error: linkError } = await client.from('product_product_attribute_values').insert(
      variantSelection.map((item) => ({
        tenant_id: tenantId,
        product_product_id: createdVariant.id,
        attribute_id: item.attributeId,
        attribute_value_id: item.valueId,
      })),
    );

    if (linkError) throw new Error(linkError.message);
  }

  return normalizeProductVariant({
    ...createdVariant,
    attributeValues: variantSelection,
    attributeValueIds: variantSelection.map((item) => item.valueId),
  });
}

async function safeCount(client, table, column, value) {
  const { count, error } = await client.from(table).select(column, { count: 'exact', head: true }).eq(column, value);
  if (error) return 0;
  return count ?? 0;
}

async function getProductUsageCounts(client, productId) {
  const { data: variantRows } = await client.from('product_products').select('id').eq('product_template_id', productId);
  const variantIds = (variantRows ?? []).map((variant) => variant.id).filter(Boolean);
  const variantCounts = await Promise.all(
    variantIds.flatMap((productProductId) => [
      safeCount(client, 'pos_order_lines', 'product_product_id', productProductId),
      safeCount(client, 'showroom_sale_lines', 'product_product_id', productProductId),
      safeCount(client, 'stock_tracking_units', 'product_product_id', productProductId),
      safeCount(client, 'stock_moves', 'product_product_id', productProductId),
      safeCount(client, 'stock_quants', 'product_product_id', productProductId),
      safeCount(client, 'account_move_lines', 'product_product_id', productProductId),
    ]),
  );
  const purchaseOrderCount = await safeCount(client, 'purchase_order_lines', 'product_template_id', productId);

  const salesCount = variantCounts.filter((_, index) => index % 6 <= 1).reduce((sum, count) => sum + count, 0);
  const stockCount = variantCounts.filter((_, index) => index % 6 >= 2 && index % 6 <= 4).reduce((sum, count) => sum + count, 0);
  const accountingCount = variantCounts.filter((_, index) => index % 6 === 5).reduce((sum, count) => sum + count, 0);
  const purchaseCount = purchaseOrderCount + accountingCount;

  return {
    salesCount,
    stockCount,
    purchaseCount,
    total: salesCount + stockCount + purchaseCount,
  };
}

// Check if a specific product_product row is referenced in any transaction table.
async function countVariantUsageById(client, productProductId) {
  const counts = await Promise.all([
    safeCount(client, 'stock_moves', 'product_product_id', productProductId),
    safeCount(client, 'stock_quants', 'product_product_id', productProductId),
    safeCount(client, 'stock_tracking_units', 'product_product_id', productProductId),
    safeCount(client, 'pos_order_lines', 'product_product_id', productProductId),
    safeCount(client, 'showroom_sale_lines', 'product_product_id', productProductId),
    safeCount(client, 'account_move_lines', 'product_product_id', productProductId),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

export const productsService = {
  async listProducts(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('product_templates')
      .select(PRODUCT_TEMPLATE_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    const variants = await listVariantsByTemplateIds(client, { tenantId, templateIds: (data ?? []).map((record) => record.id) });
    const variantCountByTemplateId = variants.reduce((map, variant) => {
      map.set(variant.productTemplateId, (map.get(variant.productTemplateId) ?? 0) + 1);
      return map;
    }, new Map());

    return (data ?? []).map((record) =>
      normalizeProduct({
        ...record,
        variant_count: variantCountByTemplateId.get(record.id) ?? 0,
      }),
    );
  },

  async createProduct({ tenantId, payload }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('product_templates')
      .insert({
        tenant_id: tenantId,
        name: payload.name.trim(),
        category_id: payload.categoryId || null,
        internal_reference: payload.internalReference?.trim() || null,
        barcode: payload.barcode?.trim() || null,
        product_type: payload.productType,
        tracking: stockTrackingValue(payload),
        can_be_sold: payload.canBeSold ?? true,
        can_be_purchased: payload.canBePurchased ?? true,
        is_active: payload.isActive ?? true,
        sale_price: money(payload.salePrice),
        cost_price: money(payload.costPrice),
        attributes_jsonb: payload.attributesJsonb ?? [],
        requires_contract: payload.requiresContract ?? false,
        requires_ownership_transfer: payload.requiresOwnershipTransfer ?? false,
        requires_post_sale_documents: payload.requiresPostSaleDocuments ?? false,
        requires_license: payload.requiresLicense ?? false,
      })
      .select(PRODUCT_TEMPLATE_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    const defaultVariant = await syncDefaultVariant(client, { tenantId, templateRecord: data });
    await refreshTemplateVariantDisplayNames(client, {
      tenantId,
      templateRecord: data,
    });
    return normalizeProduct({ ...data, default_product_product_id: defaultVariant.id, variant_count: 1 });
  },

  async updateProduct({ id, payload }) {
    const client = requireSupabase();
    const body = {
      name: payload.name.trim(),
      category_id: payload.categoryId || null,
      barcode: payload.barcode?.trim() || null,
      product_type: payload.productType,
      attributes_jsonb: payload.attributesJsonb ?? [],
    };

    if (Object.prototype.hasOwnProperty.call(payload, 'extraData')) {
      body.extra_data = payload.extraData ?? null;
    }

    body.tracking = stockTrackingValue(payload);

    if (Object.prototype.hasOwnProperty.call(payload, 'canBeSold')) {
      body.can_be_sold = payload.canBeSold;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'canBePurchased')) {
      body.can_be_purchased = payload.canBePurchased;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'salePrice')) {
      body.sale_price = money(payload.salePrice);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'costPrice')) {
      body.cost_price = money(payload.costPrice);
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'internalReference')) {
      body.internal_reference = payload.internalReference?.trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'isActive')) {
      body.is_active = payload.isActive;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'requiresContract')) {
      body.requires_contract = payload.requiresContract;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'requiresOwnershipTransfer')) {
      body.requires_ownership_transfer = payload.requiresOwnershipTransfer;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'requiresPostSaleDocuments')) {
      body.requires_post_sale_documents = payload.requiresPostSaleDocuments;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'requiresLicense')) {
      body.requires_license = payload.requiresLicense;
    }

    const { data, error } = await client
      .from('product_templates')
      .update(body)
      .eq('id', id)
      .select(PRODUCT_TEMPLATE_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    const defaultVariant = await syncDefaultVariant(client, { tenantId: data.tenant_id, templateRecord: data });
    await refreshTemplateVariantDisplayNames(client, {
      tenantId: data.tenant_id,
      templateRecord: data,
    });
    return normalizeProduct({ ...data, default_product_product_id: defaultVariant.id });
  },

  async toggleProduct(id, isActive) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('product_templates')
      .update({ is_active: isActive })
      .eq('id', id)
      .select(PRODUCT_TEMPLATE_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    await client.from('product_products').update({ is_active: isActive, updated_at: new Date().toISOString() }).eq('product_template_id', id);
    return normalizeProduct(data);
  },

  async deleteProduct(id) {
    const client = requireSupabase();
    const usageCounts = await getProductUsageCounts(client, id);

    if (usageCounts.total > 0) {
      throw new Error('لا يمكن حذف المنتج لأنه مستخدم في مبيعات أو مخزون أو مشتريات.');
    }

    const { error } = await client.from('product_templates').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  },

  async getProductDetails({ tenantId, productId }) {
    const client = requireSupabase();
    const [products, categories] = await Promise.all([
      this.listProducts(tenantId),
      productCategoryService.listCategories(tenantId),
    ]);
    const product = products.find((item) => item.id === productId) ?? null;
    const usageCounts = await getProductUsageCounts(client, productId);

    return {
      product,
      category: byId(categories).get(product?.categoryId) ?? null,
      posUsageCount: usageCounts.salesCount,
      stockUsageCount: usageCounts.stockCount,
      accountingUsageCount: usageCounts.purchaseCount,
    };
  },
};

export const productCategoryService = {
  async listCategories(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('product_categories')
      .select('id, tenant_id, parent_id, name, default_product_type, default_tracking, default_can_be_sold, default_can_be_purchased, default_is_active, default_requires_contract, default_requires_ownership_transfer, default_requires_post_sale_documents, default_requires_license, display_prefix, is_active, sort_order, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeCategory);
  },

  async saveCategory({ tenantId, id, payload }) {
    const client = requireSupabase();
    const body = {
      tenant_id: tenantId,
      name: payload.name.trim(),
      parent_id: payload.parentId || null,
      default_product_type: payload.defaultProductType || null,
      default_tracking: payload.defaultTracking || 'none',
      default_can_be_sold: payload.defaultCanBeSold ?? true,
      default_can_be_purchased: payload.defaultCanBePurchased ?? true,
      default_is_active: payload.defaultIsActive ?? true,
      default_requires_contract: payload.defaultRequiresContract ?? false,
      default_requires_ownership_transfer: payload.defaultRequiresOwnershipTransfer ?? false,
      default_requires_post_sale_documents: payload.defaultRequiresPostSaleDocuments ?? false,
      default_requires_license: payload.defaultRequiresLicense ?? false,
      display_prefix: payload.displayPrefix?.trim() || null,
      is_active: payload.isActive,
    };

    if (Object.prototype.hasOwnProperty.call(payload, 'sortOrder')) {
      body.sort_order = Number(payload.sortOrder) || 0;
    }

    const query = id
      ? client.from('product_categories').update(body).eq('id', id)
      : client.from('product_categories').insert(body);
    const { data, error } = await query.select('id, tenant_id, parent_id, name, default_product_type, default_tracking, default_can_be_sold, default_can_be_purchased, default_is_active, default_requires_contract, default_requires_ownership_transfer, default_requires_post_sale_documents, default_requires_license, display_prefix, is_active, sort_order, created_at, updated_at').single();

    if (error) throw new Error(error.message);
    if (Object.prototype.hasOwnProperty.call(payload, 'attributeLinks')) {
      await syncCategoryAttributeLinks(client, {
        tenantId,
        categoryId: data.id,
        attributeLinks: payload.attributeLinks,
      });
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'trackingIdentifierLinks')) {
      await syncCategoryTrackingIdentifierLinks(client, {
        tenantId,
        categoryId: data.id,
        trackingIdentifierLinks: payload.trackingIdentifierLinks,
      });
    }

    if (id) {
      const { data: templateRows, error: templatesError } = await client
        .from('product_templates')
        .select(PRODUCT_TEMPLATE_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('category_id', data.id);

      if (templatesError) throw new Error(templatesError.message);

      for (const templateRecord of templateRows ?? []) {
        await refreshTemplateVariantDisplayNames(client, {
          tenantId,
          templateRecord: {
            ...templateRecord,
            display_prefix: data.display_prefix,
          },
        });
      }
    }

    return normalizeCategory(data);
  },

  async toggleCategory(id, isActive) {
    const client = requireSupabase();
    const { data, error } = await client.from('product_categories').update({ is_active: isActive }).eq('id', id).select('id, tenant_id, parent_id, name, default_product_type, default_tracking, default_can_be_sold, default_can_be_purchased, default_is_active, display_prefix, is_active, sort_order, created_at, updated_at').single();
    if (error) throw new Error(error.message);
    return normalizeCategory(data);
  },

  async deleteCategory(id) {
    const client = requireSupabase();
    const { count, error: productsError } = await client
      .from('product_templates')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', id);

    if (productsError) throw new Error(productsError.message);
    if ((count ?? 0) > 0) {
      throw new Error('لا يمكن حذف التصنيف لأنه مربوط بمنتجات.');
    }

    const { error } = await client.from('product_categories').delete().eq('id', id);
    if (error) throw new Error(error.message);
    return true;
  },
};

export const productBrandService = {
  async listBrands(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('product_brands')
      .select('id, tenant_id, name, code, logo_url, sort_order, is_active, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeBrand);
  },

  async saveBrand({ tenantId, id, payload }) {
    const client = requireSupabase();
    const body = {
      tenant_id: tenantId,
      name: payload.name.trim(),
      code: payload.code?.trim() || null,
      is_active: payload.isActive,
    };

    if (Object.prototype.hasOwnProperty.call(payload, 'logoUrl')) {
      body.logo_url = payload.logoUrl?.trim() || null;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'sortOrder')) {
      body.sort_order = Number(payload.sortOrder) || 0;
    }

    const query = id ? client.from('product_brands').update(body).eq('id', id) : client.from('product_brands').insert(body);
    const { data, error } = await query.select('id, tenant_id, name, code, logo_url, sort_order, is_active, created_at, updated_at').single();

    if (error) throw new Error(error.message);
    return normalizeBrand(data);
  },

  async toggleBrand(id, isActive) {
    const client = requireSupabase();
    const { data, error } = await client.from('product_brands').update({ is_active: isActive }).eq('id', id).select('id, tenant_id, name, code, logo_url, sort_order, is_active, created_at, updated_at').single();
    if (error) throw new Error(error.message);
    return normalizeBrand(data);
  },
};

export const productAttributeService = {
  async listAttributes(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('product_attributes')
      .select(ATTRIBUTE_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeAttribute);
  },

  async saveAttribute({ tenantId, id, payload }) {
    const client = requireSupabase();
    const body = {
      tenant_id: tenantId,
      name: payload.name.trim(),
      behavior: payload.behavior || 'variant',
      creates_variant: payload.createsVariant ?? true,
      show_in_variant_name: payload.showInVariantName ?? true,
      display_type: payload.displayType || 'select',
      show_in_pos_filter: payload.showInPosFilter ?? false,
      is_filterable: payload.isFilterable ?? false,
      use_in_sku: payload.useInSku ?? false,
      sort_order: Number(payload.sortOrder) || 0,
      is_active: payload.isActive,
    };
    const query = id ? client.from('product_attributes').update(body).eq('id', id) : client.from('product_attributes').insert(body);
    const { data, error } = await query.select(ATTRIBUTE_COLUMNS).single();
    if (error) throw new Error(error.message);
    if (Object.prototype.hasOwnProperty.call(payload, 'categoryIds')) {
      await syncAttributeCategoryLinks(client, {
        tenantId,
        attributeId: data.id,
        categoryIds: payload.categoryIds,
        behavior: payload.behavior,
      });
    }
    await refreshTemplatesByAttributeIds(client, { tenantId, attributeIds: [data.id] });
    return normalizeAttribute(data);
  },

  async toggleAttribute(id, isActive) {
    const client = requireSupabase();
    const { data, error } = await client.from('product_attributes').update({ is_active: isActive }).eq('id', id).select(ATTRIBUTE_COLUMNS).single();
    if (error) throw new Error(error.message);
    await refreshTemplatesByAttributeIds(client, { tenantId: data.tenant_id, attributeIds: [data.id] });
    return normalizeAttribute(data);
  },

  async deleteAttribute(id) {
    const client = requireSupabase();
    const { data: attributeRow, error: attributeError } = await client
      .from('product_attributes')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();

    if (attributeError) throw new Error(attributeError.message);
    if (!attributeRow) throw new Error('الخاصية غير موجودة.');

    const [{ count: categoryLinksCount, error: categoryLinksError }, { count: productUsageCount, error: productUsageError }] = await Promise.all([
      client
        .from('product_category_attributes')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', attributeRow.tenant_id)
        .eq('attribute_id', id),
      client
        .from('product_product_attribute_values')
        .select('product_product_id', { count: 'exact', head: true })
        .eq('tenant_id', attributeRow.tenant_id)
        .eq('attribute_id', id),
    ]);

    if (categoryLinksError) throw new Error(categoryLinksError.message);
    if (productUsageError) throw new Error(productUsageError.message);

    if ((categoryLinksCount ?? 0) > 0) {
      throw new Error('لا يمكن حذف الخاصية لأنها مرتبطة بتصنيف واحد أو أكثر.');
    }

    if ((productUsageCount ?? 0) > 0) {
      throw new Error('لا يمكن حذف الخاصية لأنها مستخدمة داخل منتج واحد أو أكثر.');
    }

    const { error: deleteValuesError } = await client
      .from('product_attribute_values')
      .delete()
      .eq('tenant_id', attributeRow.tenant_id)
      .eq('attribute_id', id);

    if (deleteValuesError) throw new Error(deleteValuesError.message);

    const { error: deleteAttributeError } = await client
      .from('product_attributes')
      .delete()
      .eq('tenant_id', attributeRow.tenant_id)
      .eq('id', id);

    if (deleteAttributeError) throw new Error(deleteAttributeError.message);
    return true;
  },
};

export const productCategoryAttributeService = {
  async listLinks(tenantId) {
    const client = requireSupabase();
    return listCategoryAttributeLinks(client, { tenantId });
  },

  async listCategoryAttributes({ tenantId, categoryId }) {
    const client = requireSupabase();
    return listCategoryAttributesWithValues(client, { tenantId, categoryId });
  },
};

export const productTrackingIdentifierService = {
  async listTypes(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('product_tracking_identifier_types')
      .select(TRACKING_IDENTIFIER_TYPE_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeTrackingIdentifierType);
  },

  async saveType({ tenantId, id, payload }) {
    const client = requireSupabase();
    const body = {
      tenant_id: tenantId,
      name: payload.name.trim(),
      code: payload.code.trim(),
      data_type: payload.dataType === 'numeric' ? 'numeric' : 'text',
      is_active: payload.isActive ?? true,
      input_schema: normalizeTrackingIdentifierInputSchema(payload),
    };
    const query = id
      ? client.from('product_tracking_identifier_types').update(body).eq('tenant_id', tenantId).eq('id', id)
      : client.from('product_tracking_identifier_types').insert(body);
    const { data, error } = await query.select(TRACKING_IDENTIFIER_TYPE_COLUMNS).single();

    if (error) throw new Error(error.message);
    return normalizeTrackingIdentifierType(data);
  },

  async toggleType({ tenantId, id, isActive }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('product_tracking_identifier_types')
      .update({ is_active: isActive })
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select(TRACKING_IDENTIFIER_TYPE_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    return normalizeTrackingIdentifierType(data);
  },

  async deleteType({ tenantId, id }) {
    const client = requireSupabase();
    const [{ count: categoryLinksCount, error: categoryLinksError }, { count: valuesCount, error: valuesError }] = await Promise.all([
      client
        .from('product_category_tracking_identifiers')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('identifier_type_id', id),
      client
        .from('stock_tracking_unit_identifiers')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('identifier_type_id', id),
    ]);

    if (categoryLinksError) throw new Error(categoryLinksError.message);
    if (valuesError) throw new Error(valuesError.message);

    if ((categoryLinksCount ?? 0) > 0) {
      throw new Error('لا يمكن حذف التعريف لأنه مرتبط بتصنيف واحد أو أكثر.');
    }

    if ((valuesCount ?? 0) > 0) {
      throw new Error('لا يمكن حذف التعريف لأنه مستخدم داخل وحدات مخزون.');
    }

    const { error } = await client
      .from('product_tracking_identifier_types')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw new Error(error.message);
    return true;
  },
};

export const productCategoryTrackingIdentifierService = {
  async listLinks(tenantId) {
    const client = requireSupabase();
    return listCategoryTrackingIdentifierLinks(client, { tenantId });
  },

  async listCategoryIdentifiers({ tenantId, categoryId }) {
    const client = requireSupabase();
    return listCategoryTrackingIdentifierDefinitions(client, { tenantId, categoryId });
  },
};

export const productAttributeValueService = {
  async listValues(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('product_attribute_values')
      .select(ATTRIBUTE_VALUE_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeAttributeValue);
  },

  async saveValue({ tenantId, id, payload }) {
    const client = requireSupabase();
    const body = {
      tenant_id: tenantId,
      attribute_id: payload.attributeId,
      name: payload.name.trim(),
      code: payload.code?.trim() || null,
      color_hex: payload.colorHex?.trim() || null,
      image_url: payload.imageUrl?.trim() || null,
      extra_price: money(payload.extraPrice),
      show_in_variant_name: payload.showInVariantName ?? true,
      sort_order: Number(payload.sortOrder) || 0,
      is_active: payload.isActive,
    };
    const query = id
      ? client.from('product_attribute_values').update(body).eq('id', id)
      : client.from('product_attribute_values').insert(body);
    const { data, error } = await query.select(ATTRIBUTE_VALUE_COLUMNS).single();
    if (error) throw new Error(error.message);
    await refreshTemplatesByAttributeIds(client, { tenantId, attributeIds: [data.attribute_id] });
    return normalizeAttributeValue(data);
  },

  async toggleValue(id, isActive) {
    const client = requireSupabase();
    const { data, error } = await client.from('product_attribute_values').update({ is_active: isActive }).eq('id', id).select(ATTRIBUTE_VALUE_COLUMNS).single();
    if (error) throw new Error(error.message);
    await refreshTemplatesByAttributeIds(client, { tenantId: data.tenant_id, attributeIds: [data.attribute_id] });
    return normalizeAttributeValue(data);
  },
};

export const trackingUnitService = {
  async listTrackingUnits({ tenantId, productId }) {
    const client = requireSupabase();
    let query = client.from('stock_tracking_units').select(TRACKING_UNIT_COLUMNS).eq('tenant_id', tenantId);

    if (productId) {
      query = query.eq('product_product_id', productId);
    }

    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map(normalizeTrackingUnit);
  },

  async updateTrackingUnit({ id, payload }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('stock_tracking_units')
      .update({
        status: payload.status?.trim() || null,
        notes: payload.notes?.trim() || null,
      })
      .eq('id', id)
      .select(TRACKING_UNIT_COLUMNS)
      .single();

    if (error) throw new Error(error.message);
    return normalizeTrackingUnit(data);
  },
};

export const productVariantService = {
  async getVariant({ tenantId, id }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('product_products')
      .select(PRODUCT_VARIANT_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return null;

    const variants = await listVariantsByTemplateIds(client, { tenantId, templateIds: [data.product_template_id] });
    return variants.find((variant) => variant.id === id) ?? null;
  },

  async listVariants({ tenantId, productTemplateId }) {
    const client = requireSupabase();
    return listVariantsByTemplateIds(client, { tenantId, templateIds: [productTemplateId] });
  },

  async resolveVariant({ tenantId, productTemplateId, attributeValueIds }) {
    const client = requireSupabase();
    return getOrCreateVariant(client, {
      tenantId,
      productTemplateId,
      attributeValueIds,
    });
  },

  async generateVariants({ tenantId, productTemplateId, valueIdsByAttribute }) {
    const client = requireSupabase();
    const templateRecord = await getTemplateRecord(client, { tenantId, productTemplateId });
    const rawSelectedGroups = Object.entries(valueIdsByAttribute ?? {})
      .map(([attributeId, valueIds]) => ({
        attributeId,
        valueIds: [...new Set((valueIds ?? []).filter(Boolean))],
      }))
      .filter((group) => group.valueIds.length);

    if (!rawSelectedGroups.length) {
      const defaultVariant = await syncDefaultVariant(client, { tenantId, templateRecord });
      return { createdCount: 0, variants: [defaultVariant] };
    }

    const allValueIds = rawSelectedGroups.flatMap((group) => group.valueIds);
    const valuesById = await loadAttributeValuesMap(client, allValueIds);
    const selectedGroups = rawSelectedGroups.filter((group) =>
      group.valueIds.some((valueId) => valuesById.get(valueId)?.attribute?.createsVariant !== false),
    );

    if (!selectedGroups.length) {
      const defaultVariant = await syncDefaultVariant(client, { tenantId, templateRecord });
      return { createdCount: 0, variants: [defaultVariant] };
    }

    const combinations = selectedGroups.reduce(
      (accumulator, group) =>
        accumulator.flatMap((partial) =>
          group.valueIds.map((valueId) => [
            ...partial,
            {
              attributeId: group.attributeId,
              attributeName: valuesById.get(valueId)?.attribute?.name ?? '',
              attributeBehavior: valuesById.get(valueId)?.attribute?.behavior ?? 'variant',
              createsVariant: valuesById.get(valueId)?.attribute?.createsVariant ?? true,
              attributeShowInVariantName: valuesById.get(valueId)?.attribute?.showInVariantName ?? true,
              displayType: valuesById.get(valueId)?.attribute?.displayType ?? 'select',
              showInPosFilter: valuesById.get(valueId)?.attribute?.showInPosFilter ?? false,
              isFilterable: valuesById.get(valueId)?.attribute?.isFilterable ?? false,
              useInSku: valuesById.get(valueId)?.attribute?.useInSku ?? false,
              attributeSortOrder: valuesById.get(valueId)?.attribute?.sortOrder ?? 0,
              valueId,
              valueName: valuesById.get(valueId)?.name ?? '',
              valueCode: valuesById.get(valueId)?.code ?? '',
              colorHex: valuesById.get(valueId)?.colorHex ?? '',
              imageUrl: valuesById.get(valueId)?.imageUrl ?? '',
              extraPrice: valuesById.get(valueId)?.extraPrice ?? 0,
              valueShowInVariantName: valuesById.get(valueId)?.showInVariantName ?? true,
              valueSortOrder: valuesById.get(valueId)?.sortOrder ?? 0,
            },
          ]),
        ),
      [[]],
    );

    const existingVariants = await listVariantsByTemplateIds(client, { tenantId, templateIds: [productTemplateId] });
    const existingSignatures = new Set(existingVariants.map((variant) => makeAttributeSignature(variant.attributeValues)));
    const nextVariants = [];
    let createdCount = 0;

    for (const combination of combinations) {
      const signature = makeAttributeSignature(combination);
      if (existingSignatures.has(signature)) {
        const existingVariant = existingVariants.find((variant) => makeAttributeSignature(variant.attributeValues) === signature);
        if (existingVariant) nextVariants.push(existingVariant);
        continue;
      }

      const variant = await getOrCreateVariant(client, {
        tenantId,
        productTemplateId,
        selection: combination,
        templateRecord,
        salePriceOverride: money(templateRecord.sale_price) + combination.reduce((sum, item) => sum + money(item.extraPrice), 0),
        costPriceOverride: money(templateRecord.cost_price),
      });

      createdCount += 1;
      existingSignatures.add(signature);
      nextVariants.push(variant);
    }

    // Deactivate or delete the Default Variant (empty signature) if real variants now exist.
    // The default variant is the one automatically created when no attribute values are set.
    if (createdCount > 0) {
      const defaultVariant = existingVariants.find((v) => makeAttributeSignature(v.attributeValues) === '');
      const realVariantsExist = nextVariants.some((v) => makeAttributeSignature(v.attributeValues) !== '');

      if (defaultVariant && realVariantsExist) {
        const usageCount = await countVariantUsageById(client, defaultVariant.id);
        if (usageCount === 0) {
          // Not referenced anywhere — safe to delete
          await client.from('product_products').delete().eq('id', defaultVariant.id);
        } else {
          // Referenced in transactions — deactivate instead of delete
          await client.from('product_products')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', defaultVariant.id);
        }
      }
    }

    const variants = await listVariantsByTemplateIds(client, { tenantId, templateIds: [productTemplateId] });
    return { createdCount, variants };
  },

  async getTemplateVariantContext({ tenantId, productTemplateId }) {
    const client = requireSupabase();
    const templateRecord = await getTemplateRecord(client, { tenantId, productTemplateId });
    const product = normalizeProduct(templateRecord);
    const variants = await listVariantsByTemplateIds(client, { tenantId, templateIds: [productTemplateId] });
    const attributes = await listCategoryAttributesWithValues(client, {
      tenantId,
      categoryId: templateRecord.category_id,
    });

    return {
      product,
      attributes,
      variants,
    };
  },
};
