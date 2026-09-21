function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return Math.round(number(value) * 100) / 100;
}

function quantity(value) {
  return Math.round(number(value) * 10000) / 10000;
}

function entity(value) {
  return { id: text(value?.id) || null, name: text(value?.name) };
}

export function normalizeDraftOptions(value = {}) {
  return {
    defaultBranchId: text(value.default_branch_id) || null,
    defaultStockLocationId: text(value.default_stock_location_id) || null,
    branches: Array.isArray(value.branches)
      ? value.branches.map((branch) => ({ ...entity(branch), code: text(branch.code) })).filter((branch) => branch.id)
      : [],
    locations: Array.isArray(value.locations)
      ? value.locations.map((location) => ({
          ...entity(location),
          branchId: text(location.branch_id) || null,
          code: text(location.code),
          locationType: text(location.location_type),
        })).filter((location) => location.id && location.branchId)
      : [],
  };
}

export function normalizeCustomer(value = {}) {
  return { ...entity(value), phone: text(value.phone), address: text(value.address) };
}

export function normalizeProduct(value = {}) {
  return {
    ...entity(value),
    sku: text(value.sku),
    barcode: text(value.barcode),
    tracking: ['none', 'serial'].includes(text(value.tracking)) ? text(value.tracking) : 'none',
    productType: ['goods', 'service'].includes(text(value.product_type)) ? text(value.product_type) : 'goods',
    salePrice: Math.max(number(value.sale_price), 0),
  };
}

export function normalizeTrackingUnit(value = {}) {
  return {
    id: text(value.id),
    trackingNumber: text(value.tracking_number),
    chassisNumber: text(value.chassis_number) || text(value.tracking_number),
    engineNumber: text(value.engine_number),
    locationId: text(value.location_id) || null,
    attributes: Array.isArray(value.attributes)
      ? value.attributes.map((item) => ({ name: text(item.name), value: text(item.value) })).filter((item) => item.name || item.value)
      : [],
  };
}

export function normalizePaged(value = {}, mapper) {
  return {
    items: Array.isArray(value.items) ? value.items.map(mapper).filter((item) => item.id) : [],
    page: Math.max(Math.trunc(number(value.page)), 1),
    pageSize: Math.max(Math.trunc(number(value.page_size)), 1),
    hasMore: value.has_more === true,
  };
}

export function normalizeSaleDraft(value = {}) {
  return {
    id: text(value.id),
    saleNumber: text(value.sale_number) || null,
    status: text(value.status) || 'draft',
    branch: entity(value.branch),
    customer: normalizeCustomer(value.customer),
    effectiveSaleDate: text(value.effective_sale_date),
    currencyCode: text(value.currency_code).toUpperCase() || 'EGP',
    notes: text(value.notes),
    totalAmount: number(value.total_amount),
    version: Math.max(Math.trunc(number(value.version)), 1),
    draftInventoryLocationId: text(value.draft_inventory_location_id) || null,
    lines: Array.isArray(value.lines) ? value.lines.map((line) => {
      const product = normalizeProduct(line.product || {
        id: line.product_id,
        name: line.product_name,
        tracking: line.tracking_requirement,
      });
      const intents = Array.isArray(line.draft_inventory_intents)
        ? line.draft_inventory_intents.map((intent) => ({
            id: text(intent.id),
            locationId: text(intent.location_id) || null,
            trackingUnitId: text(intent.tracking_unit_id) || null,
            trackingNumber: text(intent.tracking_number),
            quantity: number(intent.quantity),
          }))
        : [];
      return {
        key: text(line.id) || crypto.randomUUID(),
        id: text(line.id) || null,
        product,
        description: text(line.description) || product.name,
        quantity: String(number(line.quantity) || 1),
        unitPrice: String(number(line.unit_price)),
        trackingUnit: intents[0]?.trackingUnitId ? {
          id: intents[0].trackingUnitId,
          trackingNumber: intents[0].trackingNumber,
          chassisNumber: intents[0].trackingNumber,
          engineNumber: '',
          locationId: intents[0].locationId,
          attributes: [],
        } : null,
      };
    }).filter((line) => line.product.id) : [],
  };
}

export function createDraftLine(product) {
  return {
    key: crypto.randomUUID(),
    id: null,
    product,
    description: product.name,
    quantity: '1',
    unitPrice: String(product.salePrice),
    trackingUnit: null,
  };
}

export function draftLineTotal(line) {
  return Math.round(quantity(line.quantity) * money(line.unitPrice) * 100) / 100;
}

export function buildDraftCommandPayload({ branchId, customer, effectiveSaleDate, currencyCode, notes, lines, locationId }) {
  return {
    branchId,
    customerId: customer?.id ?? null,
    effectiveSaleDate,
    currencyCode,
    notes: text(notes) || null,
    lines: lines.map((line) => ({
      product_id: line.product.id,
      description: text(line.description) || line.product.name,
      quantity: quantity(line.quantity),
      unit_price: money(line.unitPrice),
    })),
    inventoryIntents: lines.flatMap((line, index) => {
      if (line.product.productType !== 'goods') return [];
      if (line.product.tracking === 'serial') {
        return line.trackingUnit ? [{
          line_position: index + 1,
          location_id: locationId,
          tracking_unit_id: line.trackingUnit.id,
          quantity: 1,
        }] : [];
      }
      return [{
        line_position: index + 1,
        location_id: locationId,
        tracking_unit_id: null,
        quantity: quantity(line.quantity),
      }];
    }),
  };
}

export function validateDraftForm({ branchId, customer, effectiveSaleDate, notes, lines, locationId }) {
  if (!branchId) return 'اختر الفرع.';
  if (!customer?.id) return 'اختر العميل.';
  if (!effectiveSaleDate) return 'حدد تاريخ البيع.';
  if (text(notes).length > 4000) return 'الملاحظات أطول من الحد المسموح.';
  if (!lines.length) return 'أضف بند بيع واحدًا على الأقل.';
  if (lines.some((line) => !line.product?.id)) return 'أحد بنود البيع لا يحتوي على منتج صحيح.';
  if (lines.some((line) => number(line.quantity) <= 0)) return 'الكمية يجب أن تكون أكبر من صفر.';
  if (lines.some((line) => quantity(line.quantity) !== number(line.quantity))) return 'الكمية تسمح بأربع منازل عشرية كحد أقصى.';
  if (lines.some((line) => number(line.unitPrice) < 0)) return 'السعر لا يمكن أن يكون سالبًا.';
  if (lines.some((line) => money(line.unitPrice) !== number(line.unitPrice))) return 'السعر يسمح بمنزلتين عشريتين كحد أقصى.';
  if (lines.some((line) => draftLineTotal(line) < 0)) return 'إجمالي أحد البنود غير صحيح.';
  const stockLines = lines.filter((line) => line.product.productType === 'goods');
  if (stockLines.length && !locationId) return 'اختر موقع المخزون المستخدم في البيع.';
  if (stockLines.some((line) => line.product.tracking === 'serial' && !line.trackingUnit?.id)) {
    return 'اختر القطعة الفعلية لكل منتج متتبع بالسيريال.';
  }
  if (lines.reduce((sum, line) => sum + draftLineTotal(line), 0) <= 0) return 'إجمالي المسودة يجب أن يكون أكبر من صفر.';
  return '';
}
