import assert from 'node:assert/strict';
import test from 'node:test';
import { destinationTypeLabel, moneyDestinationError, moneyDestinationsService } from './moneyDestinations.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';

test('supports the five canonical destination types', () => {
  assert.deepEqual(['cashbox', 'bank', 'employee_cash_custody', 'pos_drawer', 'wallet'].map(destinationTypeLabel), ['خزنة', 'حساب بنكي', 'عهدة موظف', 'درج نقطة بيع', 'محفظة إلكترونية']);
});

test('creation uses only the canonical provisioning command and hides accounting plumbing', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: { destination_id: 'destination' }, error: null }; } };
  await moneyDestinationsService.create(tenantId, { type: 'bank', name: 'البنك الرئيسي', bankName: 'البنك', bankAccountLabel: 'جاري', bankIdentifierMasked: '••45' }, 'request-key', client);
  assert.equal(calls[0][0], 'create_and_provision_money_destination');
  assert.equal(calls[0][1].p_destination_key, 'bank_requestkey');
  assert.equal(calls[0][1].p_activate, true);
  assert.equal('p_ledger_account_id' in calls[0][1], false);
  assert.equal('p_journal_id' in calls[0][1], false);
});

test('employee custody and POS drawer send only their canonical relationships', async () => {
  const payloads = [];
  const client = { rpc: async (_name, payload) => { payloads.push(payload); return { data: {}, error: null }; } };
  await moneyDestinationsService.create(tenantId, { type: 'employee_cash_custody', name: 'عهدة باسم', responsibleUserId: 'employee', branchId: 'branch' }, 'employee-request', client);
  await moneyDestinationsService.create(tenantId, { type: 'pos_drawer', name: 'درج حلوان', posConfigId: 'pos', branchId: 'branch' }, 'pos-request', client);
  assert.equal(payloads[0].p_responsible_user_id, 'employee');
  assert.equal(payloads[0].p_pos_config_id, null);
  assert.equal(payloads[1].p_pos_config_id, 'pos');
  assert.equal(payloads[1].p_responsible_user_id, null);
});

test('rename and lifecycle use dedicated canonical commands', async () => {
  const calls = [];
  const client = { rpc: async (...args) => { calls.push(args); return { data: {}, error: null }; } };
  await moneyDestinationsService.rename(tenantId, 'destination', 'اسم جديد', client);
  await moneyDestinationsService.setStatus(tenantId, 'destination', 'inactive', client);
  assert.deepEqual(calls.map(([name]) => name), ['rename_money_destination', 'set_money_destination_status']);
});

test('maps permission, relationship, provisioning, conflict, and lifecycle errors', () => {
  for (const code of ['FINANCIAL_AUTHORIZATION_REQUIRED', 'MONEY_DESTINATION_BRANCH_INVALID_OR_INACTIVE', 'MONEY_DESTINATION_RESPONSIBLE_USER_INVALID_OR_INACTIVE', 'MONEY_DESTINATION_POS_CONFIG_INVALID_OR_INACTIVE', 'MONEY_DESTINATION_BANK_METADATA_REQUIRED', 'MONEY_DESTINATION_IDEMPOTENCY_CONFLICT', 'MONEY_DESTINATION_PARTIAL_OR_INVALID_PROVISIONING_STATE', 'MONEY_DESTINATION_STATUS_TRANSITION_INVALID']) {
    const error = moneyDestinationError({ message: code });
    assert.equal(error.code, code);
    assert.notEqual(error.message, code);
    assert.equal(error.diagnostic, code);
  }
});

test('never calls the legacy custody RPC', () => {
  const source = moneyDestinationsService.create.toString();
  assert.doesNotMatch(source, /create_employee_custody_account|111003|old_cashbox/);
});

test('maps employee custody adoption conflicts without exposing backend details', () => {
  const cases = [
    ['MONEY_DESTINATION_LEGACY_CUSTODY_INCOMPATIBLE', 'يوجد حساب مالي قائم لهذا الموظف ولا يمكن تحويله تلقائيًا إلى عهدة أموال. يلزم مراجعة إعداد الحساب.'],
    ['MONEY_DESTINATION_LEGACY_CUSTODY_AMBIGUOUS', 'يوجد أكثر من إعداد مالي مرتبط بهذا الموظف، لذلك تعذر إنشاء العهدة تلقائيًا.'],
    ['MONEY_DESTINATION_EMPLOYEE_CUSTODY_ALREADY_EXISTS', 'يوجد مكان أموال لعهدة هذا الموظف بالفعل.'],
  ];
  for (const [code, message] of cases) {
    const error = moneyDestinationError({ code: '23514', message: code, details: 'private detail' });
    assert.equal(error.code, code);
    assert.equal(error.message, message);
    assert.doesNotMatch(error.message, /23514|constraint|uuid/i);
  }
});
