import assert from 'node:assert/strict';
import { classifyFinancialRetry } from './financialRetryPolicy.js';

for (const code of ['40001', '40P01', '55P03']) {
  assert.deepEqual(classifyFinancialRetry({ code }), {
    sqlstate: code,
    retryable: true,
    reason: 'transient_database_conflict',
  });
}

for (const code of ['23505', '23514', '42501', 'P0002', '57014']) {
  assert.deepEqual(classifyFinancialRetry({ code }), {
    sqlstate: code,
    retryable: false,
    reason: 'not_automatically_retryable',
  });
}

assert.equal(classifyFinancialRetry(new Error('unknown')).retryable, false);
console.log('financial retry policy contract passed');
