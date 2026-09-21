import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync(new URL('./components/InternalTransferSheet.jsx', import.meta.url), 'utf8');
const service = readFileSync(new URL('./internalTransfers.service.js', import.meta.url), 'utf8');

test('transfer resources and balances load lazily from canonical services', () => {
  assert.match(component, /if \(!open\) return/);
  assert.match(component, /accessType: 'transfer_from'/);
  assert.match(component, /accessType: 'transfer_to'/);
  assert.match(component, /listMoneyDestinationBalances/);
});

test('same-destination guard and duplicate-submit protection are present', () => {
  assert.match(component, /sourceId === destinationId/);
  assert.match(component, /submitLock\.current/);
  assert.match(component, /requestKey\.current = crypto\.randomUUID/);
});

test('existing canonical transfer service owns create, confirm, and readback', () => {
  assert.match(component, /registerImmediateInternalTransfer/);
  assert.match(service, /createInternalTransfer/);
  assert.match(service, /confirmInternalTransfer/);
  assert.match(service, /created\.status !== 'confirmed'/);
  assert.match(service, /getInternalTransfer/);
  assert.doesNotMatch(component, /createFinancialPayment|allocatePayment|requireSupabase|\.rpc\(|debit|credit/);
});
