import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('../../../../supabase/migrations/20260830120000_accounting_reversal_core.sql', import.meta.url), 'utf8');
const domains = readFileSync(new URL('../../../../supabase/migrations/20260830121000_accounting_reversal_domains.sql', import.meta.url), 'utf8');
const hardening = readFileSync(new URL('../../../../supabase/migrations/20260830123000_harden_accounting_reversal_authorization_and_eligibility.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('./financialReversals.service.js', import.meta.url), 'utf8');
const sql = `${core}\n${domains}\n${hardening}`;

for (const contract of ['get_financial_reversal_eligibility', 'reverse_financial_payment_accounting', 'reverse_internal_transfer_accounting', 'unapply_financial_advance']) {
  assert.match(sql, new RegExp(`function public\\.${contract}\\(`));
  assert.match(service, new RegExp(`['"]${contract}['"]`));
}
assert.match(sql, /create_reversing_account_move/);
assert.match(sql, /PAYMENT_HAS_ACTIVE_ALLOCATIONS/);
assert.match(sql, /PAYMENT_HAS_ACTIVE_ADVANCE_APPLICATIONS/);
assert.match(sql, /transfer_receive/);
assert.match(sql, /transfer_send/);
assert.match(hardening, /financial\.transfer\.reverse/);
assert.match(hardening, /TRANSFER_HAS_NO_ACCOUNTING_EFFECT/);
assert.match(hardening, /PAYMENT_POSTING_LINK_MISSING/);
assert.match(hardening, /REVERSAL_AUTHORIZATION_DENIED/);
assert.doesNotMatch(hardening, /assert_financial_authorized\(p_tenant,'financial\.transfer\.confirm'/);
assert.doesNotMatch(sql, /refund_amount|create_refund|settlement_clearing/i);
assert.doesNotMatch(sql, /update public\.account_moves set state/i);
console.log('financial reversal contract tests passed');
