import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildSettlementOptionsRpcArgs,
  buildSettleObligationRpcArgs,
  createInitialSettlementForm,
  createSettlementPayloadFingerprint,
  getSettlementErrorDescriptor,
  normalizeSettlementOptions,
  normalizeSettlementResult,
  resolveSettlementAttempt,
  validateMoneyPaymentInput,
} from './services/settlement.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const serviceSource = read('./services/settlement.service.js');
const hookSource = read('./hooks/useSettlementWorkspace.js');
const dialogSource = read('./components/SettlementDialog.jsx');
const moneyFieldsSource = read('./components/MoneyPaymentFields.jsx');
const salesAdapterSource = read('./components/CanonicalSaleSettlementAction.jsx');

const rawOptions = (outstandingAmount = 50000) => ({
  target: { type: 'sale', id: 'sale-1', reference: 'SAL-0001', status: 'confirmed', account_id: 'hidden' },
  party: { type: 'customer', id: 'customer-1', name: 'عميل الاختبار' },
  branch: { id: 'branch-1', name: 'فرع الاختبار' },
  currency_code: 'EGP',
  original_obligation: 50000,
  outstanding_amount: outstandingAmount,
  settleable_amount: outstandingAmount,
  can_settle: outstandingAmount > 0,
  reason_codes: outstandingAmount > 0 ? [] : ['OBLIGATION_ALREADY_SETTLED'],
  settlement_mechanisms: outstandingAmount > 0 ? [{
    code: 'money_payment',
    payment_methods: [
      {
        id: 'cash-method',
        name: 'نقدي',
        code: 'cash',
        type: 'cash',
        requires_reference: false,
        requires_money_destination: true,
        account_id: 'hidden',
        money_destinations: [
          { id: 'drawer-1', name: 'عهدتي', type: 'employee_cash_custody', is_own_custody: true, journal_id: 'hidden' },
        ],
      },
      {
        id: 'card-method',
        name: 'بطاقة',
        code: 'card',
        type: 'card',
        requires_reference: true,
        requires_money_destination: false,
        money_destinations: [],
      },
    ],
  }] : [],
});

test('service RPC contracts contain business inputs only, including optional fields', () => {
  assert.deepEqual(buildSettlementOptionsRpcArgs({ targetType: ' SALE ', targetId: ' sale-1 ' }), {
    p_target_type: 'sale',
    p_target_id: 'sale-1',
  });
  const args = buildSettleObligationRpcArgs({
    targetType: 'sale',
    targetId: 'sale-1',
    mechanism: 'money_payment',
    amount: 20000,
    paymentMethodId: 'cash-method',
    moneyDestinationId: 'drawer-1',
    referenceNumber: ' R-1 ',
    notes: ' test ',
    idempotencyKey: 'attempt-1',
  });
  assert.deepEqual(args, {
    p_target_type: 'sale',
    p_target_id: 'sale-1',
    p_mechanism: 'money_payment',
    p_amount: 20000,
    p_payment_method_id: 'cash-method',
    p_idempotency_key: 'attempt-1',
    p_money_destination_id: 'drawer-1',
    p_reference_number: 'R-1',
    p_notes: 'test',
  });
  for (const forbidden of ['account_id', 'journal_id', 'receivable_line_id', 'open_item_id', 'debit', 'credit', 'move_id', 'allocation_id']) {
    assert.equal(Object.hasOwn(args, forbidden), false);
  }
  assert.match(serviceSource, /rpc\('get_settlement_options', args\)/);
  assert.match(serviceSource, /rpc\('settle_obligation', args\)/);
});

test('authoritative options are normalized and implementation identifiers are discarded', () => {
  const options = normalizeSettlementOptions(rawOptions(), { targetType: 'sale', targetId: 'sale-1' });
  assert.equal(options.outstandingAmount, 50000);
  assert.equal(options.party.name, 'عميل الاختبار');
  assert.equal(options.settlementMechanisms[0].paymentMethods[0].moneyDestinations[0].name, 'عهدتي');
  assert.equal(options.settlementMechanisms[0].paymentMethods[0].moneyDestinations[0].isOwnCustody, true);
  const serialized = JSON.stringify(options);
  assert.doesNotMatch(serialized, /account_id|journal_id|receivable_line|open_item|debit|credit|move_id|allocation_id/);
});

test('partial/full input, method, destination, reference, and amount rules are enforced locally', () => {
  const options = normalizeSettlementOptions(rawOptions());
  const cash = options.settlementMechanisms[0].paymentMethods[0];
  const card = options.settlementMechanisms[0].paymentMethods[1];
  assert.equal(validateMoneyPaymentInput({ amount: 20000, outstandingAmount: 50000, paymentMethod: cash, moneyDestinationId: 'drawer-1' }), null);
  assert.equal(validateMoneyPaymentInput({ amount: 0.29, outstandingAmount: 50000, paymentMethod: cash, moneyDestinationId: 'drawer-1' }), null);
  assert.equal(validateMoneyPaymentInput({ amount: 50000, outstandingAmount: 50000, paymentMethod: cash, moneyDestinationId: 'drawer-1' }), null);
  assert.match(validateMoneyPaymentInput({ amount: 0, outstandingAmount: 50000, paymentMethod: cash }), /مبلغًا صحيحًا/);
  assert.match(validateMoneyPaymentInput({ amount: 50001, outstandingAmount: 50000, paymentMethod: cash, moneyDestinationId: 'drawer-1' }), /أكبر من الرصيد/);
  assert.match(validateMoneyPaymentInput({ amount: 20000, outstandingAmount: 50000, paymentMethod: cash }), /مكان التحصيل/);
  assert.match(validateMoneyPaymentInput({ amount: 20000, outstandingAmount: 50000, paymentMethod: card }), /رقم المرجع/);
});

test('attempt key survives retry and changes only with a material payload change or completed attempt', () => {
  let keyCounter = 0;
  const keyFactory = () => `key-${++keyCounter}`;
  const base = {
    targetType: 'sale', targetId: 'sale-1', mechanism: 'money_payment', amount: 20000,
    paymentMethodId: 'cash-method', moneyDestinationId: 'drawer-1', referenceNumber: null, notes: null,
  };
  const first = resolveSettlementAttempt(null, base, keyFactory);
  const retry = resolveSettlementAttempt(first, { ...base, amount: '20000.00' }, keyFactory);
  const changedAmount = resolveSettlementAttempt(retry, { ...base, amount: 30000 }, keyFactory);
  const completedThenNew = resolveSettlementAttempt(null, base, keyFactory);
  assert.equal(first.idempotencyKey, retry.idempotencyKey);
  assert.notEqual(retry.idempotencyKey, changedAmount.idempotencyKey);
  assert.notEqual(changedAmount.idempotencyKey, completedThenNew.idempotencyKey);
  assert.equal(createSettlementPayloadFingerprint(base), createSettlementPayloadFingerprint({ ...base, amount: '20000.0' }));
});

test('backend state and permission errors are business-friendly and trigger authoritative refresh only when appropriate', () => {
  const changed = getSettlementErrorDescriptor({ message: 'SETTLEMENT_EXCEEDS_OUTSTANDING', code: '23514' });
  const permission = getSettlementErrorDescriptor({ message: 'SETTLEMENT_COLLECT_DENIED', code: '42501' });
  const network = getSettlementErrorDescriptor({ message: 'Failed to fetch' });
  const integrity = getSettlementErrorDescriptor({ message: 'SETTLEMENT_RESIDUAL_INTEGRITY_FAILURE', code: '23514' });
  assert.match(changed.message, /تغيّر الرصيد/);
  assert.equal(changed.shouldRefreshOptions, true);
  assert.match(permission.message, /صلاحية/);
  assert.equal(permission.shouldRefreshOptions, true);
  assert.equal(network.shouldRefreshOptions, false);
  assert.equal(integrity.code, 'SETTLEMENT_RESIDUAL_INTEGRITY_FAILURE');
  assert.match(hookSource, /if \(descriptor\.shouldRefreshOptions\)[\s\S]*getSettlementOptions/);
});

test('50k sale UI contract supports 20k then 30k using authoritative readbacks', () => {
  const firstOptions = normalizeSettlementOptions(rawOptions(50000));
  const firstForm = createInitialSettlementForm(firstOptions, null, { reset: true });
  assert.equal(firstForm.amount, '50000');
  assert.equal(validateMoneyPaymentInput({
    amount: 20000,
    outstandingAmount: firstOptions.outstandingAmount,
    paymentMethod: firstOptions.settlementMechanisms[0].paymentMethods[0],
    moneyDestinationId: 'drawer-1',
  }), null);
  const firstResult = normalizeSettlementResult({
    success: true, amount: 20000, currency_code: 'EGP', outstanding_before: 50000, outstanding_after: 30000,
  });
  const refreshedOptions = normalizeSettlementOptions(rawOptions(firstResult.outstandingAfter));
  assert.equal(refreshedOptions.outstandingAmount, 30000);
  assert.equal(validateMoneyPaymentInput({
    amount: 30000,
    outstandingAmount: refreshedOptions.outstandingAmount,
    paymentMethod: refreshedOptions.settlementMechanisms[0].paymentMethods[0],
    moneyDestinationId: 'drawer-1',
  }), null);
  const finalResult = normalizeSettlementResult({
    success: true, amount: 30000, currency_code: 'EGP', outstanding_before: 30000, outstanding_after: 0,
  });
  assert.equal(finalResult.outstandingAfter, 0);
});

test('workspace is backend-driven, refreshes after success, locks submit, and remains mobile/accessibility safe', () => {
  assert.match(dialogSource, /MECHANISM_RENDERERS[\s\S]*money_payment: MoneyPaymentFields/);
  assert.match(dialogSource, /options\?\.settlementMechanisms/);
  assert.match(moneyFieldsSource, /mechanism\?\.paymentMethods/);
  assert.match(moneyFieldsSource, /selectedPaymentMethod\?\.moneyDestinations/);
  assert.match(hookSource, /submitLockRef\.current \|\| submitting/);
  const commandIndex = hookSource.indexOf('settlementService.settleObligation');
  const refreshIndex = hookSource.indexOf('settlementService.getSettlementOptions', commandIndex);
  const callbackIndex = hookSource.indexOf('onSettledRef.current', refreshIndex);
  assert.ok(commandIndex >= 0 && refreshIndex > commandIndex && callbackIndex > refreshIndex);
  assert.match(dialogSource, /className="w-full max-w-none sm:max-w-xl"/);
  assert.match(dialogSource, /overflow-x-hidden/);
  assert.match(dialogSource, /role="alert"/);
  assert.match(dialogSource, /aria-busy=\{submitting\}/);
  assert.match(dialogSource, /onEscapeKeyDown/);
});

test('Sales consumer is a permission-aware thin adapter and Showroom is not a dependency', () => {
  assert.match(salesAdapterSource, /can\(SETTLEMENT_PERMISSIONS\.VIEW\) && can\(SETTLEMENT_PERMISSIONS\.COLLECT\)/);
  assert.match(salesAdapterSource, /targetType="sale"/);
  assert.match(salesAdapterSource, /targetId=\{saleId\}/);
  assert.match(salesAdapterSource, /onSettled=\{handleSettled\}/);
  for (const source of [serviceSource, hookSource, dialogSource, moneyFieldsSource, salesAdapterSource]) {
    assert.doesNotMatch(source, /features\/showroom|collect_showroom_sale_payment|list_showroom_sale_payment_options/);
  }
});
