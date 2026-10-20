export function normalizeProductOption(product = {}) {
  const id = product.id ?? product.productProductId ?? product.product_product_id ?? null;
  return {
    ...product,
    id,
    productProductId: product.productProductId ?? product.product_product_id ?? id,
    name: product.name ?? product.displayName ?? product.display_name ?? '',
    code: product.code ?? product.sku ?? product.internalReference ?? product.internal_reference ?? product.barcode ?? '',
    tracking: product.tracking ?? 'none',
    productType: product.productType ?? product.product_type ?? 'goods',
    identifiers: Array.isArray(product.identifiers) ? product.identifiers : [],
    attributes: Array.isArray(product.attributes) ? product.attributes : [],
  };
}

export function normalizeTrackingUnitOption(unit = {}) {
  return {
    ...unit,
    id: unit.id ?? unit.trackingUnitId ?? unit.tracking_unit_id ?? null,
    trackingNumber: unit.trackingNumber ?? unit.tracking_number ?? '',
    identifiers: Array.isArray(unit.identifiers) ? unit.identifiers : [],
    attributes: Array.isArray(unit.attributes) ? unit.attributes : [],
  };
}

export function createLocalProductSearch(products = [], { predicate } = {}) {
  return async ({ search = '', page = 1, pageSize = 20 } = {}) => {
    const query = String(search).trim().toLowerCase();
    const normalized = products.map(normalizeProductOption).filter((product) => (
      (!predicate || predicate(product))
      && (!query || `${product.name} ${product.code} ${product.barcode || ''}`.toLowerCase().includes(query))
    ));
    const safePage = Math.max(1, Number(page) || 1);
    const safePageSize = Math.max(1, Number(pageSize) || 20);
    const from = (safePage - 1) * safePageSize;
    return {
      items: normalized.slice(from, from + safePageSize),
      page: safePage,
      pageSize: safePageSize,
      hasMore: from + safePageSize < normalized.length,
    };
  };
}
