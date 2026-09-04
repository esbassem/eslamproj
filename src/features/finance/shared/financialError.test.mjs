import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFinancialError } from './financialError.js';

test('maps expected financial domain failures to safe Arabic messages', () => {
  const cases = [
    'FINANCIAL_AUTHORIZATION_DENIED',
    'PAYMENT_DESTINATION_NOT_ALLOWED',
    'PAYMENT_METHOD_INVALID_OR_INACTIVE',
    'FINANCIAL_PAYMENT_AMOUNT_MUST_BE_POSITIVE',
    'ALLOCATION_EXCEEDS_TARGET_RESIDUAL',
    'ALLOCATION_EXCEEDS_AVAILABLE_RESIDUAL',
    'MONEY_DESTINATION_NEGATIVE_BALANCE_NOT_ALLOWED',
    'FINANCIAL_PERIOD_CLOSED',
    'FINANCIAL_PAYMENT_IDEMPOTENCY_PAYLOAD_MISMATCH',
  ];
  for (const code of cases) {
    const error = normalizeFinancialError({ code: '23514', message: `${code}: private detail` });
    assert.equal(error.code, code);
    assert.notEqual(error.message, code);
    assert.doesNotMatch(error.message, /23514|constraint|uuid|private detail/i);
    assert.match(error.diagnostic, new RegExp(code));
  }
});

test('keeps unexpected diagnostics for support without exposing them to the user', () => {
  const error = normalizeFinancialError({ message: 'relation private_table does not exist' }, 'تعذر التنفيذ.');
  assert.equal(error.message, 'تعذر التنفيذ.');
  assert.equal(error.diagnostic, 'relation private_table does not exist');
  assert.equal(error.isFinancialError, true);
});
