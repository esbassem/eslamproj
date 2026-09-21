import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  getSaleCancellationReasonMessage,
  normalizeSaleCancellationEligibility,
  resolveSaleCancellationAttempt,
} from './services/salesCancellation.model.js';
import { normalizeSaleDetails } from './services/salesDetails.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const action = read('./components/CanonicalSaleCancellationAction.jsx');
const actions = read('./components/SaleActions.jsx');
const dialog = read('./components/SaleCancellationDialog.jsx');
const hook = read('./hooks/useSaleCancellation.js');
const page = read('./components/SaleDetails.jsx');
const service = read('./services/sales.service.js');
const summary = read('./components/SaleCancellationSummary.jsx');

test('1. Cancel action is limited to a Confirmed backend-eligible Sale', () => {
  assert.match(action, /commercialStatus === 'confirmed'/);
  assert.match(action, /eligibility\?\.canCancel/);
  assert.match(action, />إلغاء البيع<\/Button>/);
});
test('2. Draft does not render the cancellation action', () => {
  assert.match(actions, /commercialStatus === 'draft'/);
  assert.match(action, /if \(!tenantId \|\| !sale\?\.id \|\| !candidate/);
});
test('3. sales.cancel permission controls visibility without role names', () => {
  assert.match(action, /SALE_CANCELLATION_PERMISSION = 'sales\.cancel'/);
  assert.doesNotMatch(action + hook + dialog, /admin|manager|owner/i);
});
test('4. Delivered Sale shows the authoritative Arabic blocker', () => {
  assert.equal(getSaleCancellationReasonMessage('SALE_HAS_DELIVERY'), 'تم تسليم جزء من هذا البيع بالفعل. استخدم إجراء المرتجع بدل الإلغاء.');
});
test('5. Settled Sale shows the authoritative Arabic blocker', () => {
  assert.equal(getSaleCancellationReasonMessage('SALE_HAS_SETTLEMENT'), 'يوجد تحصيل مسجل على هذا البيع. يجب معالجة رد المبلغ قبل إلغاء البيع.');
});
test('6. Reason is required before submit', () => {
  assert.match(hook, /سبب الإلغاء مطلوب/);
  assert.match(dialog, /disabled=\{!cancellation\.canSubmit/);
});
test('7. Eligibility is rechecked immediately before command execution', () => {
  const first = hook.indexOf('getSaleCancellationEligibility', hook.indexOf('const submit'));
  const command = hook.indexOf('cancelSale', first);
  assert.ok(first > 0 && command > first);
});
test('8. Double submit is protected in hook and Sheet', () => {
  assert.match(hook, /submitLockRef\.current \|\| submitting/);
  assert.match(dialog, /if \(!nextOpen && cancellation\.submitting\)/);
});
test('9. Same material payload keeps one idempotency key', () => {
  const payload = { saleId: 'sale-1', expectedVersion: 4, reason: 'طلب العميل' };
  const first = resolveSaleCancellationAttempt(null, payload);
  const retry = resolveSaleCancellationAttempt(first, payload);
  assert.equal(first.idempotencyKey, retry.idempotencyKey);
});
test('10. Changed reason starts a new idempotent attempt', () => {
  const first = resolveSaleCancellationAttempt(null, { saleId: 'sale-1', expectedVersion: 4, reason: 'أ' });
  const changed = resolveSaleCancellationAttempt(first, { saleId: 'sale-1', expectedVersion: 4, reason: 'ب' });
  assert.notEqual(first.idempotencyKey, changed.idempotencyKey);
});
test('11. Version conflict refreshes eligibility and authoritative details', () => {
  assert.match(hook, /SALES_VERSION_CONFLICT/);
  assert.match(hook, /await loadEligibility\(\{ keepError: true \}\)/);
  assert.match(page, /handleCancellationVersionConflict[\s\S]*details\.reload/);
});
test('12. Successful cancellation refreshes Sale Details', () => {
  assert.match(hook, /await onCancelled\?\.\(commandResult\)/);
  assert.match(page, /handleCancelled[\s\S]*details\.reload/);
});
test('13. Cancelled status and original commercial data remain visible', () => {
  const sale = normalizeSaleDetails({ id: 'sale-1', status: 'cancelled', sale_number: 'SAL-1', total_amount: 50000, lines: [{ id: 'line-1', product_id: 'product-1', product_name: 'منتج', quantity: 1, unit_price: 50000 }], payment: { status: 'paid' } });
  assert.equal(sale.commercialStatus, 'cancelled');
  assert.equal(sale.saleNumber, 'SAL-1');
  assert.equal(sale.totalAmount, 50000);
  assert.equal(sale.lines.length, 1);
  assert.equal(sale.payment.status, 'cancelled');
});
test('14. Cancellation audit is normalized without internal identifiers', () => {
  const value = normalizeSaleCancellationEligibility({ sale_id: 'sale-1', can_cancel: false, cancellation: { reason: 'طلب العميل', cancelled_at: '2026-09-08T10:00:00Z', cancelled_by: { name: 'مستخدم' }, financial_reversal_reference: 'REV-1', inventory_release_state: 'released' } });
  assert.equal(value.cancellation.reason, 'طلب العميل');
  assert.deepEqual(Object.keys(value.cancellation).sort(), ['cancelledAt', 'cancelledByName', 'financialReversalReference', 'inventoryReleaseState', 'reason']);
});
test('15. Dialog follows the mobile-safe bottom Sheet pattern', () => {
  assert.match(dialog, /side="bottom"/);
  assert.match(dialog, /max-h-\[94vh\]/);
  assert.match(dialog, /overflow-x-hidden/);
});
test('16. Cancelled details display reason, actor, date and reversal reference', () => {
  for (const label of ['سبب الإلغاء', 'تاريخ الإلغاء', 'نفذ الإلغاء', 'financialReversalReference']) assert.match(summary, new RegExp(label));
});
test('17. UI calls only the Sales cancellation RPC boundary', () => {
  assert.match(service, /rpc\('cancel_sale'/);
  assert.doesNotMatch(action + dialog + hook, /reverse_financial_sale|release_inventory_reservation/);
});
test('18. Frontend sends business inputs only', () => {
  assert.match(service, /p_sale_id: saleId/);
  assert.match(service, /p_expected_version: expectedVersion/);
  assert.match(service, /p_reason: reason/);
  assert.match(service, /p_idempotency_key: idempotencyKey/);
  assert.doesNotMatch(service.slice(service.indexOf('export async function cancelSale')), /account_id|journal_id|debit|credit|reservation_id/);
});
