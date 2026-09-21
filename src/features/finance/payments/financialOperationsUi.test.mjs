import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync(new URL('./components/RegisterPaymentSheet.jsx', import.meta.url), 'utf8');
const orchestration = readFileSync(new URL('./paymentOperations.service.js', import.meta.url), 'utf8');
const canonical = readFileSync(new URL('./canonicalPayments.service.js', import.meta.url), 'utf8');
const methods = readFileSync(new URL('../payment-methods/paymentMethods.service.js', import.meta.url), 'utf8');
const overview = readFileSync(new URL('../../payments/components/PaymentsOverview.jsx', import.meta.url), 'utf8');

test('one reusable payment component supports standalone and contextual contracts', () => {
  assert.match(component, /export function RegisterPaymentSheet/);
  assert.match(component, /context\?\.partner/);
  assert.match(component, /context\?\.targetOpenItem/);
  assert.match(component, /maximumAmount/);
  assert.match(component, /source: context\?\.source/);
  assert.match(component, /searchPaymentCustomers/);
  assert.match(orchestration, /term\.length < 2/);
  assert.match(orchestration, /limit: 25|limit,\s*$/m);
});

test('payment choices are backend-usable and destinations are backend-compatible', () => {
  assert.match(component, /listAvailablePaymentMethods/);
  assert.match(component, /getPaymentMethodDestinationSelection/);
  assert.match(methods, /is_financial_payment_method_usable/);
  assert.match(methods, /get_payment_method_destination_selection/);
  assert.doesNotMatch(component, /main-cashbox|activeMethods\.length \?|\{ id: 'cash'/);
});

test('orchestration owns lifecycle, optional contextual allocation, and authoritative readback', () => {
  for (const operation of ['createFinancialPayment', 'submitFinancialPayment', 'confirmFinancialPayment', 'postFinancialPayment', 'allocatePayment', 'getFinancialPayment', 'getPaymentAllocationSummary']) {
    assert.match(orchestration, new RegExp(operation));
  }
  assert.match(orchestration, /targetOpenItemId/);
  assert.match(orchestration, /readback/);
  assert.match(component, /result\?\.readback\?\.payment/);
  assert.match(overview, /FinancialOperationsWorkspace/);
});

test('payment UI prevents duplicate submit and uses centralized domain errors', () => {
  assert.match(component, /submitLock\.current/);
  assert.match(component, /requestKey\.current = crypto\.randomUUID/);
  assert.match(canonical, /normalizeFinancialError/);
  assert.match(orchestration, /idempotent_resume/);
  assert.match(orchestration, /accounting_state === 'posted'/);
  assert.doesNotMatch(component, /requireSupabase|\.from\(|\.rpc\(/);
});
