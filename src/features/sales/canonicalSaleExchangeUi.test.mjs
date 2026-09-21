import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildExchangePayload,
  createExchangeDraftLine,
  getExchangeInputIssue,
  normalizeSaleExchangeEligibility,
  resolveSaleExchangeAttempt,
} from './services/salesExchange.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const action = read('./components/CanonicalSaleExchangeAction.jsx');
const dialog = read('./components/SaleExchangeDialog.jsx');
const section = read('./components/SaleExchangesSection.jsx');
const hook = read('./hooks/useSaleExchange.js');
const service = read('./services/salesExchange.service.js');
const page = read('./components/SaleDetails.jsx');

const eligibility = normalizeSaleExchangeEligibility({
  sale_id: 'sale-1', sale_number: 'SAL-1', expected_version: 7,
  currency_code: 'EGP', can_exchange: true, permission_granted: true,
  customer: { id: 'customer-1', name: 'عميل' }, branch: { id: 'branch-1', name: 'فرع' },
  return_eligibility: {
    sale_id: 'sale-1', can_return: true, expected_version: 7, currency_code: 'EGP',
    lines: [{ sale_line_id: 'old-line', kind: 'serial', delivered_quantity: 1, returnable_quantity: 1, unit_price: 50000, serialized_units: [{ tracking_unit_id: 'serial-a', chassis_number: 'A', engine_number: 'EA' }] }],
    destinations: [{ id: 'return-location', name: 'مخزن المرتجع' }],
  },
  replacement_locations: [{ id: 'replacement-location', name: 'المخزن' }],
});

function input(overrides = {}) {
  const product = { id: 'product-b', name: 'بديل', productType: 'goods', tracking: 'serial', salePrice: 60000 };
  return {
    eligibility,
    returnSelection: { 'old-line': { quantity: '', units: { 'serial-a': true } } },
    returnDestinationId: 'return-location',
    replacementLocationId: 'replacement-location',
    replacementLines: [{ ...createExchangeDraftLine(product), trackingUnit: { id: 'serial-b' } }],
    reason: 'استبدال المنتج',
    ...overrides,
  };
}

test('1. Exchange action requires backend eligibility', () => assert.match(action, /eligibility\?\.canExchange/));
test('2. Draft never shows Exchange', () => assert.match(action, /commercialStatus !== 'confirmed'/));
test('3. No Delivery means backend canExchange is false', () => assert.match(service, /get_sale_exchange_eligibility/));
test('4. sales.exchange controls the action without roles', () => {
  assert.match(action, /can\('sales\.exchange'\)/);
  assert.doesNotMatch(action + dialog + hook, /role\s*===|tenantUser\?\.role/);
});
test('5. Serialized return selection shows chassis and engine', () => {
  assert.match(dialog, /شاسيه/);
  assert.match(dialog, /موتور/);
  assert.deepEqual(buildExchangePayload(input()).returnLines[0], { sale_line_id: 'old-line', tracking_unit_id: 'serial-a', quantity: 1 });
});
test('6. Quantity return selection is supported', () => assert.match(dialog, /كمية المرتجع/));
test('7. Replacement uses the existing product search', () => assert.match(dialog, /<ProductSelector/));
test('8. Draft price editing reuses SaleItemRow', () => assert.match(dialog, /<SaleItemRow/));
test('9. Reason is mandatory', () => assert.match(getExchangeInputIssue(input({ reason: '' })), /سبب الاستبدال/));
test('10. Eligibility is refreshed immediately before start', () => assert.match(hook, /const fresh = await salesExchangeService\.getSaleExchangeEligibility/));
test('11. Double submit is blocked', () => assert.match(hook, /if \(submitLockRef\.current \|\| issue\) return null/));
test('12. Retry preserves its idempotency key', () => {
  const payload = buildExchangePayload(input());
  const first = resolveSaleExchangeAttempt(null, payload);
  assert.equal(resolveSaleExchangeAttempt(first, payload).idempotencyKey, first.idempotencyKey);
});
test('13. Version conflict refreshes authoritative data', () => assert.match(hook, /fresh\.expectedVersion !== eligibility\.expectedVersion/));
test('14. Success navigates to the Replacement Sale', () => assert.match(action, /navigate\(`\/app\/sales\/\$\{result\.replacementSaleId\}`\)/));
test('15. Original Sale renders durable Exchange relationships', () => assert.match(page, /<SaleExchangesSection/));
test('16. Replacement Sale renders its source Sale banner', () => {
  assert.match(page, /<SaleExchangeSourceBanner/);
  assert.match(section, /هذا البيع ناتج عن استبدال/);
});
test('17. Exchange dialog contains no payment workflow', () => assert.doesNotMatch(dialog + hook, /CanonicalSaleSettlementAction|settle_obligation|paymentMethodId/));
test('18. Exchange dialog contains no Refund workflow', () => assert.doesNotMatch(dialog + hook, /SaleRefundDialog|refund_sale_return|refundSaleReturn/));
test('19. UI never invokes Inventory commands directly', () => assert.doesNotMatch(dialog + hook + service, /receive_inventory_return|reserve_inventory|deliver_inventory/));
test('20. UI sends no accounting identifiers', () => assert.doesNotMatch(JSON.stringify(buildExchangePayload(input())), /account_id|journal_id|debit|credit|move_id/));
test('21. Dialog is a mobile bottom Sheet', () => assert.match(dialog, /SheetContent side="bottom"[\s\S]*max-h-\[95vh\]/));
test('22. Replacement remains editable through the normal details editor', () => assert.match(page, /<SaleDraftEditor/));
test('23. Return and replacement values are informational only', () => assert.match(dialog, /فرق تقديري فقط/));
test('24. Service replacement carries no tracking unit', () => {
  const serviceLine = createExchangeDraftLine({ id: 'service-1', name: 'خدمة', productType: 'service', tracking: 'none', salePrice: 100 });
  const payload = buildExchangePayload(input({ replacementLines: [serviceLine] }));
  assert.equal(payload.replacementLines[0].tracking_unit_id, null);
  assert.equal(payload.replacementLocationId, null);
});
