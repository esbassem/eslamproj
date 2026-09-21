import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildSaleDeliveryLines,
  createInitialSaleDeliverySelection,
  getSaleDeliverySelectionIssue,
  normalizeSaleDeliveryEligibility,
  resolveSaleDeliveryAttempt,
} from './services/salesDelivery.model.js';
import { normalizeSaleDetails } from './services/salesDetails.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./components/SaleDetails.jsx');
const actions = read('./components/SaleActions.jsx');
const action = read('./components/CanonicalSaleDeliveryAction.jsx');
const dialog = read('./components/SaleDeliveryDialog.jsx');
const hook = read('./hooks/useSaleDelivery.js');
const service = read('./services/sales.service.js');
const model = read('./services/salesDelivery.model.js');

function eligibilityFixture(overrides = {}) {
  return normalizeSaleDeliveryEligibility({
    sale_id: 'sale-1', sale_number: 'SAL-1', commercial_status: 'confirmed', version: 4,
    eligible: true, fulfillment_status: 'reserved', required_quantity: 12,
    delivered_quantity: 0, remaining_quantity: 12,
    location: { id: 'location-1', name: 'المخزن الرئيسي' }, blocking_reasons: [],
    deliverable_lines: [
      {
        sale_line_id: 'line-serial', product_id: 'product-serial', product_name: 'موتوسيكل',
        tracking_requirement: 'serial', ordered_quantity: 2, delivered_quantity: 0, remaining_quantity: 2,
        tracking_units: [
          { tracking_unit_id: 'unit-1', tracking_number: 'CH-1', state: 'reserved', deliverable: true },
          { tracking_unit_id: 'unit-2', tracking_number: 'CH-2', state: 'issued', deliverable: false },
        ],
      },
      {
        sale_line_id: 'line-quantity', product_id: 'product-quantity', product_name: 'قطعة غيار',
        tracking_requirement: 'none', ordered_quantity: 10, delivered_quantity: 0, remaining_quantity: 10,
        tracking_units: [],
      },
    ],
    ...overrides,
  });
}

function saleDetailsFixture(overrides = {}) {
  return normalizeSaleDetails({
    id: 'sale-1', sale_number: 'SAL-1', status: 'confirmed', version: 4,
    branch: { id: 'branch-1', name: 'الفرع الرئيسي' }, customer: { id: 'customer-1', name: 'العميل' },
    total_amount: 50000, currency_code: 'EGP',
    payment: { status: 'unpaid', total_amount: 50000, settled_amount: 0, outstanding_amount: 50000 },
    fulfillment: { status: 'reserved', required_quantity: 12, selected_quantity: 12, reserved_quantity: 12, delivered_quantity: 0, remaining_quantity: 12 },
    lines: [{
      id: 'line-serial', product: { id: 'product-serial', name: 'موتوسيكل' }, quantity: 2, unit_price: 20000,
      inventory: { kind: 'serial', status: 'reserved', tracking_units: [{ id: 'unit-1', tracking_number: 'CH-1', chassis_number: 'CH-1', engine_number: 'EN-1', state: 'reserved', attributes: [{ name: 'اللون', value: 'أسود' }] }] },
    }], events: [], ...overrides,
  });
}

test('1. Deliver is absent for Draft', () => { assert.match(action, /commercialStatus === 'confirmed'/); assert.match(actions, /commercialStatus === 'draft'/); });
test('2. Deliver appears for a backend-eligible Confirmed deliverable Sale', () => { assert.match(action, /getSaleDeliveryEligibility/); assert.match(action, /options\.eligible/); assert.match(action, />تسليم<\/Button>/); });
test('3. Deliver is hidden without sales.deliver', () => { assert.match(action, /SALE_DELIVERY_PERMISSION = 'sales\.deliver'/); assert.match(action, /!canDeliver/); });
test('4. Deliver is absent for Fully Delivered', () => { assert.match(action, /fulfillment\?\.status !== 'delivered'/); });
test('5. Deliver is absent when fulfillment is Not Required', () => { assert.match(action, /fulfillment\?\.status !== 'not_required'/); });
test('6. Backend eligibility is loaded again whenever the Sheet opens', () => { assert.match(hook, /if \(!open\)/); assert.match(hook, /void loadEligibility\(\{ resetSelection: true \}\)/); });
test('7. Only backend-deliverable serialized units are rendered', () => { assert.match(dialog, /trackingUnits\.filter\(\(unit\) => unit\.deliverable\)/); assert.match(dialog, /type="checkbox"/); });
test('8. Serialized business details include chassis and engine', () => { assert.match(dialog, /شاسيه:/); assert.match(dialog, /موتور:/); assert.match(dialog, /details\.attributes/); });
test('9. Quantity UI shows ordered delivered and remaining values', () => { for (const label of ['المطلوب', 'تم تسليمه', 'المتبقي']) assert.match(dialog, new RegExp(label)); });
test('10. Partial quantity creates the exact business payload', () => { const options = eligibilityFixture(); const selection = createInitialSaleDeliverySelection(options); selection.quantities['line-quantity'] = '4'; const line = buildSaleDeliveryLines(options, selection).find((item) => item.sale_line_id === 'line-quantity'); assert.deepEqual(line, { sale_line_id: 'line-quantity', quantity: 4 }); });
test('11. Full quantity creates the exact remaining quantity payload', () => { const options = eligibilityFixture(); const selection = createInitialSaleDeliverySelection(options); const line = buildSaleDeliveryLines(options, selection).find((item) => item.sale_line_id === 'line-quantity'); assert.equal(line.quantity, 10); });
test('12. Service lines are not synthesized in the Delivery form', () => { const options = eligibilityFixture(); assert.equal(options.deliverableLines.some((line) => line.trackingRequirement === 'service'), false); assert.doesNotMatch(dialog, /inventory not required|خدمة —/); });
test('13. Payload contains only sale line quantity and required tracking unit', () => { const options = eligibilityFixture(); const lines = buildSaleDeliveryLines(options, createInitialSaleDeliverySelection(options)); assert.deepEqual(Object.keys(lines[0]).sort(), ['quantity', 'sale_line_id', 'tracking_unit_id']); assert.deepEqual(Object.keys(lines.at(-1)).sort(), ['quantity', 'sale_line_id']); assert.doesNotMatch(model, /reservation_id|stock_move_id/); });
test('14. Backend eligibility version is sent as expected_version', () => { assert.match(hook, /expectedVersion: eligibility\?\.version/); assert.match(service, /p_expected_version: expectedVersion/); });
test('15. Retry with unchanged payload keeps the same idempotency key', () => { let count = 0; const key = () => `key-${++count}`; const payload = { saleId: 'sale-1', expectedVersion: 4, deliveryLines: [{ sale_line_id: 'line-1', quantity: 4 }] }; const first = resolveSaleDeliveryAttempt(null, payload, key); const retry = resolveSaleDeliveryAttempt(first, payload, key); assert.equal(first.idempotencyKey, retry.idempotencyKey); assert.equal(count, 1); });
test('16. Submit lock prevents duplicate Delivery calls', () => { assert.match(hook, /submitLockRef\.current \|\| submitting/); assert.match(hook, /submitLockRef\.current = true/); assert.match(dialog, /disabled=\{!delivery\.canSubmit \|\| delivery\.submitting/); });
test('17. Successful Delivery refreshes authoritative Sale Details', () => { assert.match(hook, /await onDeliveredRef\.current/); assert.match(page, /onDelivered=\{handleDelivered\}/); assert.match(page, /handleDelivered[\s\S]*details\.reload/); });
test('18. Partial fulfillment remains a Delivery candidate', () => { assert.match(action, /status !== 'delivered'/); assert.equal(saleDetailsFixture({ fulfillment: { status: 'partially_delivered', required_quantity: 10, delivered_quantity: 4, remaining_quantity: 6 } }).fulfillment.status, 'partially_delivered'); });
test('19. Full fulfillment removes the action after authoritative refresh', () => { assert.match(action, /payload\.eligibility\.eligible/); assert.match(action, /\(!actionReady && !open\)/); });
test('20. Delivery leaves Commercial Status unchanged', () => { assert.equal(saleDetailsFixture({ fulfillment: { status: 'delivered', required_quantity: 1, delivered_quantity: 1, remaining_quantity: 0 } }).commercialStatus, 'confirmed'); assert.doesNotMatch(hook + dialog, /setCommercialStatus/); });
test('21. Delivery leaves Payment Status unchanged', () => { assert.equal(saleDetailsFixture({ fulfillment: { status: 'delivered', required_quantity: 1, delivered_quantity: 1, remaining_quantity: 0 } }).payment.status, 'unpaid'); assert.doesNotMatch(hook + dialog, /setPaymentStatus/); });
test('22. Version conflict refreshes eligibility and Sale Details without silent retry', () => { assert.match(hook, /SALES_VERSION_CONFLICT[\s\S]*loadEligibility[\s\S]*onVersionConflictRef\.current/); assert.match(hook, /تم تحديث البيع أو تنفيذ عملية عليه من مستخدم آخر/); assert.match(page, /handleDeliveryVersionConflict[\s\S]*details\.reload/); });
test('23. Stale eligibility errors refresh both eligibility and Sale Details with a safe notice', () => { assert.match(hook, /isAuthoritativeSaleDeliveryError[\s\S]*loadEligibility[\s\S]*onTargetRefreshRef\.current/); assert.match(action, /onTargetRefresh=\{handleTargetRefresh\}/); assert.match(page, /handleDeliveryRefresh[\s\S]*setActionNotice[\s\S]*details\.reload/); });
test('24. Over-delivery is explained in Arabic', () => { const options = eligibilityFixture(); const selection = createInitialSaleDeliverySelection(options); selection.quantities['line-quantity'] = '11'; assert.match(getSaleDeliverySelectionIssue(options, selection), /أكبر من المتبقي/); assert.match(service, /INVENTORY_OVER_DELIVERY: 'الكمية المطلوبة أكبر من المتبقي/); });
test('25. Delivery adds no payment policy or paid-state guard', () => { assert.doesNotMatch(action + dialog + hook + model, /outstandingAmount|payment\.status|remaining = 0|full payment requirement/i); });
test('26. Sales calls only deliver_sale and never Inventory Delivery directly', () => { const deliveryService = service.slice(service.indexOf('export async function getSaleDeliveryEligibility')); assert.match(deliveryService, /rpc\('deliver_sale'/); assert.doesNotMatch(deliveryService + hook + dialog, /commit_inventory_delivery|inventory_deliveries|inventory_delivery_lines/); });
