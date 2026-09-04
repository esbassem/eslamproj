import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync(new URL('./components/PaymentAllocationSheet.jsx', import.meta.url), 'utf8');
const operations = readFileSync(new URL('./allocationOperations.service.js', import.meta.url), 'utf8');

test('allocation workspace loads open items and summary only when opened', () => {
  assert.match(component, /if \(open\).*load\(\)/);
  assert.match(operations, /listAllocatableOpenItems/);
  assert.match(operations, /getPaymentAllocationSummary/);
  assert.match(operations, /openItems:.*map\(normalizeOpenItem\)/s);
});

test('allocation and unallocation use canonical commands then refresh', () => {
  assert.match(component, /allocatePaymentToOpenItem/);
  assert.match(component, /await load\(\)/);
  assert.match(component, /window\.confirm/);
  assert.match(component, /unallocatePaymentAllocation/);
  assert.match(operations, /allocatePayment\(/);
  assert.match(operations, /unallocatePayment\(/);
});

test('obvious over-allocation is guarded without reproducing reconciliation rules', () => {
  assert.match(component, /numericAmount > selected\.residualAmount/);
  assert.match(component, /numericAmount > paymentResidual/);
  assert.doesNotMatch(component, /account_partial_reconcile|debit|credit|requireSupabase|\.rpc\(/);
});
