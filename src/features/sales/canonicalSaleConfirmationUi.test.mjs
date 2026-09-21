import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildSaleConfirmationPayload,
  getSaleConfirmationPayloadIssue,
  resolveSaleConfirmationAttempt,
  saleConfirmationFingerprint,
} from './services/salesConfirmation.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./components/SaleDetails.jsx');
const actions = read('./components/SaleActions.jsx');
const dialog = read('./components/SaleConfirmationDialog.jsx');
const hook = read('./hooks/useSaleConfirmation.js');
const detailsHook = read('./hooks/useSaleDetails.js');
const service = read('./services/sales.service.js');
const readinessSource = read('./components/SaleReadiness.jsx');

function saleFixture(overrides = {}) {
  return {
    id: 'sale-1', version: 4, commercialStatus: 'draft', totalAmount: 50200, currencyCode: 'EGP',
    customer: { id: 'customer-1', name: 'عميل الاختبار' }, branch: { id: 'branch-1', name: 'الفرع الرئيسي' },
    draftInventoryLocationId: 'location-1', fulfillment: { location: { id: 'location-1', name: 'المخزن' } },
    lines: [
      { id: 'line-serial', quantity: '1', inventory: { kind: 'serial', trackingUnits: [{ id: 'unit-1', chassisNumber: 'CH-1', engineNumber: 'EN-1' }] } },
      { id: 'line-quantity', quantity: '2', inventory: { kind: 'quantity', trackingUnits: [] } },
      { id: 'line-service', quantity: '1', inventory: { kind: 'service', trackingUnits: [] } },
    ],
    ...overrides,
  };
}

test('1. Confirm appears for a Draft with sales.confirm', () => { assert.match(page, /can\('sales\.confirm'\)/); assert.match(actions, /تأكيد البيع/); });
test('2. Confirm is hidden without its permission', () => { assert.match(actions, /canConfirm \?/); });
test('3. Confirm belongs only to the Draft action branch', () => { assert.match(actions, /commercialStatus === 'draft'[\s\S]*تأكيد البيع/); });
test('4. Edit and Confirm coexist behind their distinct permissions', () => { assert.match(actions, /canEditDraft \?/); assert.match(actions, /canConfirm \?/); assert.match(page, /sales\.update_draft/); });
test('5. false readiness blocks a new submit before confirm_sale', () => { assert.match(actions, /disabled=\{!confirmationReady\}/); assert.match(hook, /if \(!isRetry && !readiness\?\.ready\)/); });
test('6. readiness reasons remain business-friendly', () => { assert.match(readinessSource, /أضف بند بيع واحدًا على الأقل/); assert.match(dialog, /SaleReadiness readiness=\{readiness\}/); });
test('7. confirmation sheet shows the required business summary', () => { for (const label of ['العميل', 'الفرع', 'إجمالي البيع', 'عدد البنود', 'القطع المتسلسلة المختارة']) assert.match(dialog, new RegExp(label)); });
test('8. serialized payload contains line unit location and quantity one', () => { const item = buildSaleConfirmationPayload(saleFixture()).inventorySelections[0]; assert.deepEqual(item, { sale_line_id: 'line-serial', tracking_unit_id: 'unit-1', location_id: 'location-1', quantity: 1 }); });
test('9. quantity payload contains one business selection', () => { const item = buildSaleConfirmationPayload(saleFixture()).inventorySelections[1]; assert.deepEqual(item, { sale_line_id: 'line-quantity', tracking_unit_id: null, location_id: 'location-1', quantity: 2 }); });
test('10. service lines send no inventory selection', () => { const payload = buildSaleConfirmationPayload(saleFixture()); assert.equal(payload.inventorySelections.length, 2); assert.ok(payload.inventorySelections.every((item) => item.sale_line_id !== 'line-service')); });
test('11. current expected version is sent to the exact backend contract', () => { assert.equal(buildSaleConfirmationPayload(saleFixture()).expectedVersion, 4); assert.match(service, /rpc\('confirm_sale',[\s\S]*p_expected_version: expectedVersion/); });
test('12. attempt key is retained while the material fingerprint is unchanged', () => { let calls = 0; const createKey = () => `key-${++calls}`; const payload = buildSaleConfirmationPayload(saleFixture()); const first = resolveSaleConfirmationAttempt(null, payload, createKey); const retry = resolveSaleConfirmationAttempt(first, payload, createKey); assert.equal(retry.idempotencyKey, first.idempotencyKey); assert.equal(calls, 1); assert.match(hook, /idempotencyKey: attemptRef\.current\.idempotencyKey/); });
test('13. double click cannot issue a second RPC', () => { assert.match(hook, /if \(submitLockRef\.current\) return null/); assert.match(hook, /submitLockRef\.current = true/); });
test('14. success closes and refreshes the same details page', () => { assert.match(hook, /await onConfirmed\?\.\(result\)/); assert.match(page, /setConfirmOpen\(false\)[\s\S]*await details\.reload\(\)/); });
test('15. refreshed non-Draft details remove Draft Edit and Confirm actions', () => { assert.match(actions, /commercialStatus === 'draft'[\s\S]*تعديل المسودة[\s\S]*تأكيد البيع/); assert.match(page, /details\.reload/); });
test('16. version conflict is explained and refreshed without silent retry', () => { assert.match(hook, /تم تعديل البيع من مستخدم آخر\. تم تحديث البيانات، راجعها ثم أعد التأكيد/); assert.match(hook, /onVersionConflict/); assert.doesNotMatch(hook, /SALES_VERSION_CONFLICT[\s\S]*salesService\.confirmSale/); });
test('17. inventory conflicts use business-facing messages', () => { assert.match(service, /SALE_INVENTORY_UNAVAILABLE: 'المخزون المختار لم يعد متاحًا/); assert.match(service, /SALE_SERIAL_SELECTION_INCOMPLETE: 'اختيار القطع المتسلسلة غير مكتمل/); });
test('18. financial posting failure stays an error', () => { assert.match(service, /SALE_FINANCIAL_BINDING_MISSING: 'تعذر إنشاء الاستحقاق المالي/); assert.match(dialog, /confirmation\.error\.message/); assert.match(hook, /catch \(caught\)/); });
test('19. network retry keeps the same key and material change gets a new attempt', () => { let calls = 0; const createKey = () => `key-${++calls}`; const firstPayload = buildSaleConfirmationPayload(saleFixture()); const first = resolveSaleConfirmationAttempt(null, firstPayload, createKey); const retry = resolveSaleConfirmationAttempt(first, buildSaleConfirmationPayload(saleFixture()), createKey); const changed = resolveSaleConfirmationAttempt(retry, buildSaleConfirmationPayload(saleFixture({ version: 5 })), createKey); assert.equal(first.idempotencyKey, retry.idempotencyKey); assert.notEqual(changed.idempotencyKey, retry.idempotencyKey); assert.equal(calls, 2); assert.notEqual(saleConfirmationFingerprint(firstPayload), changed.fingerprint); assert.match(hook, /if \(!isRetry\) \{[\s\S]*refreshReadiness/); assert.match(hook, /attemptRef\.current = null;[\s\S]*await onConfirmed/); });
test('20. confirmation flow itself adds no direct Settlement Payment or Delivery command', () => { for (const source of [dialog, hook]) assert.doesNotMatch(source, /settle_obligation|collect_showroom_sale_payment|deliver_sale|تأكيد التحصيل|تسليم البيع/); assert.match(actions, /CanonicalSaleDeliveryAction/); });

test('21. confirmation initialization is safe while sale details are still loading', () => {
  assert.deepEqual(buildSaleConfirmationPayload(null), {
    saleId: '',
    expectedVersion: Number.NaN,
    inventorySelections: [],
  });
  assert.match(getSaleConfirmationPayloadIssue(null), /لم يعد مسودة/);
});

test('client rejects incomplete serial intents and preserves one-location semantics', () => {
  assert.match(getSaleConfirmationPayloadIssue(saleFixture({ lines: [{ id: 'line-1', quantity: 2, inventory: { kind: 'serial', trackingUnits: [{ id: 'unit-1' }] } }] })), /غير مكتمل/);
  assert.equal(getSaleConfirmationPayloadIssue(saleFixture()), '');
  assert.match(service, /p_inventory_selections: inventorySelections/);
  assert.doesNotMatch(service.slice(service.indexOf("rpc('confirm_sale'")), /account_id|journal_id|money_destination|debit|credit|receivable_line_id/);
  assert.match(detailsHook, /refreshReadiness/);
});
