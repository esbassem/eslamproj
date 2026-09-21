import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHistoricalSaleRead, indexHistoricalSales } from './services/historicalSales.model.js';

test('historical read overlays original identity and evidence without changing commercial facts', () => {
  const sale = { id: 'sale-1', saleNumber: 'SAL-2026-900000001', totalAmount: 100,
    currencyCode: 'EGP', payment: { status: 'unpaid' }, fulfillment: { status: 'unreserved' },
    lines: [{ id: 'line-1', quantity: '1', inventory: { status: 'unreserved' } }] };
  const source = { sale_id: 'sale-1', is_historical: true, source_system: 'showroom',
    source_sale_number: '2026-000001', canonical_sale_number: sale.saleNumber, classification: 'B',
    payment: { status: 'partially_paid', total_amount: 100, settled_amount: 40, outstanding_amount: 60, currency_code: 'EGP' },
    fulfillment: { status: 'delivered', required_quantity: 1, delivered_quantity: 1, remaining_quantity: 0 },
    lines: [{ sale_line_id: 'line-1', inventory: { kind: 'serial', status: 'delivered', delivered_quantity: 1,
      tracking_units: [{ id: 'unit-1', tracking_number: 'SER-1', state: 'delivered' }] } }] };
  const result = applyHistoricalSaleRead(sale, source);
  assert.equal(result.saleNumber, '2026-000001');
  assert.equal(result.canonicalSaleNumber, 'SAL-2026-900000001');
  assert.equal(result.isHistorical, true);
  assert.equal(result.payment.outstandingAmount, 60);
  assert.equal(result.lines[0].inventory.trackingUnits[0].trackingNumber, 'SER-1');
  assert.equal(indexHistoricalSales([source]).get('sale-1'), source);
});

test('ordinary canonical sales are untouched', () => {
  const sale = { id: 'sale-2', saleNumber: 'SAL-2026-000001' };
  assert.equal(applyHistoricalSaleRead(sale, null), sale);
});
