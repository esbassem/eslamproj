import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAYMENT_METHOD_TYPES,
  paymentMethodSettingsError,
  paymentMethodTypeLabel,
  paymentMethodsSettingsService,
} from './paymentMethodsSettings.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

function rpcClient(handler = () => ({ data: [], error: null })) {
  const calls = [];
  return { calls, client: { rpc: async (...args) => { calls.push(args); return handler(...args); } } };
}

test('exposes only four business-facing canonical types', () => {
  assert.deepEqual(PAYMENT_METHOD_TYPES.map(({ code }) => code), ['cash', 'bank_transfer', 'wallet', 'card']);
  assert.deepEqual(PAYMENT_METHOD_TYPES.map(({ code }) => paymentMethodTypeLabel(code)), ['نقدي', 'تحويل بنكي', 'محفظة', 'بطاقة']);
  assert.equal(PAYMENT_METHOD_TYPES.some(({ code }) => code === 'cheque' || code === 'other'), false);
});

test('lists methods through the Settings RPC and normalizes safe fields only', async () => {
  const { calls, client } = rpcClient(() => ({ data: [{ payment_method_id: 'method', payment_method_name: 'نقدي', method_type: 'cash', settlement_mode: 'direct', is_active: true, is_usable: true, configuration_summary: 'hidden' }], error: null }));
  const rows = await paymentMethodsSettingsService.list(tenantId, client);
  assert.deepEqual(calls, [['list_financial_payment_methods_for_settings', { p_tenant_id: tenantId }]]);
  assert.deepEqual(rows, [{ id: 'method', name: 'نقدي', type: 'cash', typeLabel: 'نقدي', settlementMode: 'direct', isActive: true, isUsable: true }]);
});

test('creates direct methods without a destination or clearing configuration', async () => {
  const { calls, client } = rpcClient(() => ({ data: { payment_method_id: 'method' }, error: null }));
  await paymentMethodsSettingsService.create(tenantId, { name: ' نقدي الفرع ', type: 'cash' }, 'stable-key', client);
  assert.deepEqual(calls[0], ['create_financial_payment_method_for_settings', {
    p_tenant_id: tenantId, p_name: 'نقدي الفرع', p_method_type: 'cash', p_settlement_mode: 'direct', p_idempotency_key: 'stable-key', p_clearing_configuration_key: null,
  }]);
  assert.doesNotMatch(JSON.stringify(calls[0]), /destination_id|account_id|journal_id/);
});

test('loads and submits only opaque business-safe clearing options for cards', async () => {
  const responses = [
    { data: [{ configuration_key: 'opaque', clearing_account_label: 'وسيط البطاقات', clearing_journal_label: 'يومية البطاقات', settlement_destination_label: 'حساب بنكي', branch_label: 'الرئيسي' }], error: null },
    { data: { payment_method_id: 'card' }, error: null },
  ];
  const { calls, client } = rpcClient(() => responses.shift());
  const options = await paymentMethodsSettingsService.listClearingOptions(tenantId, client);
  await paymentMethodsSettingsService.create(tenantId, { name: 'بطاقة', type: 'card', clearingConfigurationKey: options[0].key }, 'card-key', client);
  assert.equal(calls[0][0], 'list_financial_payment_method_clearing_options');
  assert.equal(calls[1][1].p_settlement_mode, 'clearing');
  assert.equal(calls[1][1].p_clearing_configuration_key, 'opaque');
  assert.doesNotMatch(JSON.stringify(calls), /clearing_account_id|clearing_journal_id/);
});

test('rename and lifecycle use narrow canonical commands', async () => {
  const { calls, client } = rpcClient(() => ({ data: {}, error: null }));
  await paymentMethodsSettingsService.rename(tenantId, 'method', 'اسم جديد', client);
  await paymentMethodsSettingsService.setActive(tenantId, 'method', false, client);
  assert.deepEqual(calls.map(([name]) => name), ['rename_financial_payment_method', 'set_financial_payment_method_status']);
});

test('maps canonical validation, idempotency, permission, and lifecycle errors to Arabic', () => {
  for (const code of ['FINANCIAL_AUTHORIZATION_REQUIRED', 'PAYMENT_METHOD_TYPE_NOT_AVAILABLE_IN_SETTINGS', 'PAYMENT_METHOD_COMPATIBLE_DESTINATION_REQUIRED', 'PAYMENT_METHOD_CLEARING_CONFIGURATION_INVALID', 'PAYMENT_METHOD_IDEMPOTENCY_PAYLOAD_MISMATCH', 'PAYMENT_METHOD_CONFIGURATION_NOT_USABLE']) {
    const error = paymentMethodSettingsError({ message: code });
    assert.equal(error.code, code);
    assert.notEqual(error.message, code);
    assert.equal(error.diagnostic, code);
  }
});

test('never calls legacy sources or direct table writes', () => {
  const source = Object.values(paymentMethodsSettingsService).map(String).join('\n');
  assert.doesNotMatch(source, /account_payment_methods|\.from\(|\.insert\(|\.update\(|\.delete\(/);
});
