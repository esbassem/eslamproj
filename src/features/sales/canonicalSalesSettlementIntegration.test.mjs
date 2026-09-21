import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeSaleDetails } from './services/salesDetails.model.js';
import { getSettlementErrorDescriptor, resolveSettlementAttempt } from '../settlement/services/settlement.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const page = read('./components/SaleDetails.jsx');
const actions = read('./components/SaleActions.jsx');
const adapter = read('../settlement/components/CanonicalSaleSettlementAction.jsx');
const dialog = read('../settlement/components/SettlementDialog.jsx');
const workspace = read('../settlement/hooks/useSettlementWorkspace.js');
const service = read('../settlement/services/settlement.service.js');

function details({ outstanding = 50000, paymentStatus = 'unpaid' } = {}) {
  return normalizeSaleDetails({
    id: 'sale-1', sale_number: 'SAL-1', status: 'confirmed', version: 3,
    branch: { id: 'branch-1', name: 'Main' }, customer: { id: 'customer-1', name: 'Customer' },
    currency_code: 'EGP', total_amount: 50000,
    payment: { status: paymentStatus, total_amount: 50000, settled_amount: 50000 - outstanding, outstanding_amount: outstanding },
    fulfillment: { status: 'reserved', required_quantity: 1, selected_quantity: 1, reserved_quantity: 1, delivered_quantity: 0, remaining_quantity: 1 },
    lines: [], events: [],
  });
}

test('1. Collect appears only for a Confirmed outstanding sale that backend options allow', () => { assert.match(actions, /commercialStatus !== 'confirmed'/); assert.match(actions, /outstandingAmount/); assert.match(actions, /label="تحصيل"/); assert.match(adapter, /getSettlementOptions\(\{ targetType: 'sale', targetId: saleId \}\)/); assert.match(adapter, /!eligibility\.canSettle\) return null/); });
test('2. Collect is not rendered from the Draft branch', () => { assert.match(actions, /commercialStatus === 'draft'[\s\S]*return <div[\s\S]*تأكيد البيع[\s\S]*\n  }[\s\S]*commercialStatus !== 'confirmed'/); });
test('3. Collect is not rendered for a fully paid sale', () => { assert.match(actions, /outstandingAmount \|\| 0\) > 0 \? <CanonicalSaleSettlementAction/); });
test('4. Collect is hidden without settlement permissions or while permissions load', () => { assert.match(adapter, /can\(SETTLEMENT_PERMISSIONS\.VIEW\) && can\(SETTLEMENT_PERMISSIONS\.COLLECT\)/); assert.match(adapter, /if \(!saleId \|\| isLoading \|\| !canUseSettlement \|\|[\s\S]*\) return null/); });
test('5. Sales opens the existing shared Settlement action', () => { assert.match(actions, /CanonicalSaleSettlementAction/); assert.match(adapter, /<SettlementDialog/); assert.doesNotMatch(page + actions, /SalesPaymentDialog|SalesCollectionModal/); });
test('6. Shared Workspace receives targetType sale', () => { assert.match(adapter, /targetType="sale"/); });
test('7. Shared Workspace receives the canonical sale id', () => { assert.match(adapter, /targetId=\{saleId\}/); assert.match(actions, /saleId=\{sale\.id\}/); });
test('8. Sales contains no payment form or Financial RPC', () => { assert.doesNotMatch(page + actions, /MoneyPaymentFields|paymentMethodId|moneyDestinationId|settle_obligation|financial_payments/); assert.match(dialog, /MoneyPaymentFields/); });
test('9. successful partial settlement refreshes authoritative Sale Details', () => { assert.match(page, /onSettled=\{details\.reload\}/); assert.match(workspace, /await onSettledRef\.current/); });
test('10. refreshed details represent a partial payment', () => { const sale = details({ outstanding: 30000, paymentStatus: 'partially_paid' }); assert.deepEqual([sale.payment.status, sale.payment.settledAmount, sale.payment.outstandingAmount], ['partially_paid', 20000, 30000]); });
test('11. refreshed details represent full payment with zero residual', () => { const sale = details({ outstanding: 0, paymentStatus: 'paid' }); assert.deepEqual([sale.payment.status, sale.payment.outstandingAmount], ['paid', 0]); });
test('12. full payment removes Collect after authoritative refresh', () => { assert.match(actions, /outstandingAmount/); assert.match(page, /onSettled=\{details\.reload\}/); });
test('13. settlement does not mutate Commercial Status optimistically', () => { const sale = details({ outstanding: 30000, paymentStatus: 'partially_paid' }); assert.equal(sale.commercialStatus, 'confirmed'); assert.doesNotMatch(page + actions, /setCommercialStatus/); });
test('14. settlement does not mutate Fulfillment Status', () => { const sale = details({ outstanding: 30000, paymentStatus: 'partially_paid' }); assert.equal(sale.fulfillment.status, 'reserved'); assert.doesNotMatch(page + actions, /setFulfillment|fulfillment\.status\s*=/); });
test('15. backend overpayment rejection is business-friendly', () => { const error = getSettlementErrorDescriptor({ message: 'SETTLEMENT_EXCEEDS_OUTSTANDING', code: '23514' }); assert.match(error.message, /أكبر من المتبقي/); assert.equal(error.shouldRefreshOptions, true); });
test('16. stale residual refreshes Workspace options, action eligibility, and Sale Details', () => { assert.match(workspace, /descriptor\.shouldRefreshOptions[\s\S]*getSettlementOptions[\s\S]*onTargetRefreshRef\.current/); assert.match(adapter, /onTargetRefresh=\{handleTargetRefresh\}/); assert.match(adapter, /payload\.options\.canSettle/); assert.match(page, /onSettlementRefresh=\{details\.reload\}/); });
test('17. retry preserves the Workspace idempotency key', () => { let calls = 0; const makeKey = () => `key-${++calls}`; const payload = { targetType: 'sale', targetId: 'sale-1', mechanism: 'money_payment', amount: 20000, paymentMethodId: 'cash' }; const first = resolveSettlementAttempt(null, payload, makeKey); const retry = resolveSettlementAttempt(first, payload, makeKey); assert.equal(first.idempotencyKey, retry.idempotencyKey); assert.equal(calls, 1); });
test('18. Workspace prevents double submit', () => { assert.match(workspace, /submitLockRef\.current \|\| submitting/); assert.match(dialog, /disabled=\{submitting/); });
test('19. network failure remains an error without exposing raw diagnostics', () => { assert.match(workspace, /catch \(nextError\)[\s\S]*setError\(descriptor\)/); assert.match(service, /if \(error\) throw normalizeSettlementError/); assert.doesNotMatch(dialog, /رمز التشخيص|error\.code/); });
test('20. Settlement integration itself adds no Delivery command', () => { assert.doesNotMatch(adapter + dialog + workspace, /deliver_sale|تسليم البيع|Inventory delivery/i); });
