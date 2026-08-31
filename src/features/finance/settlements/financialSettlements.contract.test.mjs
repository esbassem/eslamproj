import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../../../supabase/migrations/20260831130000_canonical_clearing_settlement_core.sql', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('./financialSettlements.service.js', import.meta.url), 'utf8');
for (const contract of ['financial_settlements', 'financial_settlement_items', 'financial_settlement_accounting_links', 'list_settleable_clearing_items', 'create_financial_settlement', 'post_financial_settlement']) assert.match(migration, new RegExp(contract));
assert.match(migration, /settlement_mode in\('direct','clearing'\)/);
assert.match(migration, /gross_amount=net_amount\+fees_amount/);
assert.match(migration, /amount_residual/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /for update/);
assert.doesNotMatch(migration, /create_financial_internal_transfer|create_financial_refund|reverse_financial_payment_accounting/);
for (const rpc of ['list_settleable_clearing_items', 'get_financial_settlement_eligibility', 'create_financial_settlement', 'submit_financial_settlement', 'confirm_financial_settlement', 'post_financial_settlement']) assert.match(service, new RegExp(rpc));
console.log('financial settlement contract tests passed');
