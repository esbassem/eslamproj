import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalProductSearch, normalizeProductOption, normalizeTrackingUnitOption } from './productSelection.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('shared products remain service-neutral and normalize product_products ids', () => {
  const model = read('./productSelection.model.js');
  const shared = [
    read('./ProductSearchField.jsx'), read('./TrackingUnitSearchField.jsx'),
    read('./usePagedProductSearch.js'), read('./useTrackingUnitSearch.js'),
  ].join('\n');
  assert.match(model, /productProductId.*product_product_id.*id/s);
  assert.match(model, /identifiers: Array\.isArray/);
  assert.doesNotMatch(shared, /salesService|inventoryService|posService|useAuthorization/);
  assert.doesNotMatch(shared, /شاسيه|موتور|IMEI/);
  assert.equal(normalizeProductOption({ product_product_id: 'variant-1' }).id, 'variant-1');
  assert.equal(normalizeProductOption({ id: 'variant-2', productProductId: 'variant-2' }).productProductId, 'variant-2');
  assert.deepEqual(normalizeTrackingUnitOption({ tracking_unit_id: 'unit-1', tracking_number: 'TRACK-1' }).identifiers, []);
});

test('product and tracking search support injected contracts and pagination', () => {
  const products = read('./usePagedProductSearch.js');
  const units = read('./useTrackingUnitSearch.js');
  const productField = read('./ProductSearchField.jsx');
  const unitField = read('./TrackingUnitSearchField.jsx');
  for (const source of [products, units]) {
    assert.match(source, /pageSize/);
    assert.match(source, /hasMore/);
    assert.match(source, /loadMore/);
  }
  assert.match(productField, /searchProducts/);
  assert.match(unitField, /searchTrackingUnits/);
});

test('local adapters implement stable product pagination without changing ids', async () => {
  const search = createLocalProductSearch([
    { id: 'p-1', displayName: 'Alpha' }, { id: 'p-2', displayName: 'Beta' }, { id: 'p-3', displayName: 'Gamma' },
  ]);
  const first = await search({ page: 1, pageSize: 2 });
  const second = await search({ page: 2, pageSize: 2 });
  assert.deepEqual(first.items.map((item) => item.id), ['p-1', 'p-2']);
  assert.equal(first.hasMore, true);
  assert.deepEqual(second.items.map((item) => item.id), ['p-3']);
  assert.equal(second.hasMore, false);
});

test('sales keeps canonical scoped contracts while using shared fields', () => {
  const product = read('../../features/sales/create/ProductSelector.jsx');
  const unit = read('../../features/sales/create/TrackingUnitSelector.jsx');
  assert.match(product, /salesService\.searchSaleProducts/);
  assert.match(product, /ProductSearchField/);
  assert.match(unit, /salesService\.searchSaleTrackingUnits/);
  assert.match(unit, /branchId, locationId, productId/);
  assert.match(unit, /TrackingUnitSearchField/);
});

test('receiving and dashboard reuse shared product UI without moving workflows', () => {
  const receiving = read('../../features/inventory/components/AddStockDialog.jsx');
  const dashboard = read('../../features/dashboard/components/QuickStockUnitSheet.jsx');
  const completion = read('../../features/inventory/components/CompleteTrackingUnitWizard.jsx');
  assert.match(receiving, /ProductSearchField/);
  assert.match(receiving, /receiveInventory/);
  assert.match(dashboard, /ProductSearchField/);
  assert.match(completion, /ProductSearchField/);
  assert.match(dashboard, /posService\.listSellProducts/);
  assert.match(completion, /posService\.listSellProducts/);
});
