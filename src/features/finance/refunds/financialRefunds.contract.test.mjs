import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../../../../supabase/migrations/20260831120000_canonical_refunds_core.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('./financialRefunds.service.js', import.meta.url), 'utf8');
for (const name of ['list_refundable_open_items','get_financial_refund_eligibility','create_financial_refund','submit_financial_refund','confirm_financial_refund','reject_financial_refund','post_financial_refund']) { assert.match(sql,new RegExp(`function public\\.${name}\\(`));assert.match(service,new RegExp(`['"]${name}['"]`)); }
assert.match(sql,/Refund business event|refund business event/i);
assert.match(sql,/REFUND_SOURCE_ACCOUNT_SEMANTICS_INVALID/);
assert.match(sql,/REFUND_EXCEEDS_SOURCE_RESIDUAL/);
assert.doesNotMatch(sql,/create.*credit.?note|insert into public\.showroom_sale_returns/i);
assert.doesNotMatch(sql,/financial_accounting_reversals\s*\(/i);
console.log('financial refund contract tests passed');
