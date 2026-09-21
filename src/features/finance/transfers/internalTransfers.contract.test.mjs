import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../../../../supabase/migrations/20260829120000_internal_transfers_core.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('./internalTransfers.service.js', import.meta.url), 'utf8');

for (const contract of ['create_internal_transfer', 'send_internal_transfer', 'receive_internal_transfer', 'confirm_internal_transfer', 'get_internal_transfer', 'list_internal_transfers']) {
  assert.match(migration, new RegExp(`function public\\.${contract}\\(`));
  assert.match(service, new RegExp(`['"]${contract}['"]`));
}
assert.match(migration, /'cash_in_transit','functional'/);
assert.match(migration, /'immediate','send','receive'/);
assert.match(migration, /Destination Dr\/source Cr|destination Dr\/source Cr/i);
assert.doesNotMatch(migration, /insert into public\.account_partial_reconcile/i);
assert.doesNotMatch(migration, /partner_id uuid/);
assert.match(migration, /revoke all on public\.financial_internal_transfer_sequences/);
assert.match(migration, /INTERNAL_TRANSFER_IDEMPOTENCY_PAYLOAD_MISMATCH/);

console.log('internal transfer contract tests passed');
