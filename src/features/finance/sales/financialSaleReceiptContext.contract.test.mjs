import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../../../../supabase/migrations/20260909170000_financial_sale_receipt_context.sql',import.meta.url),'utf8');
test('receipt context is canonical, scoped and read-only',()=>{ assert.match(sql,/from public\.sales/); assert.match(sql,/financial_sale_postings/); assert.match(sql,/sale_historical_sources/); assert.match(sql,/has_financial_resource_access/); assert.doesNotMatch(sql,/insert into|update public|delete from/i); });
test('chronology contains only sale allocations and hides ledger internals',()=>{ assert.match(sql,/r\.debit_move_id=ar\.id/); assert.match(sql,/'allocated_to_sale'/); assert.doesNotMatch(sql,/'account_id'|'debit_move_id'|'credit_move_id'/); });
test('unapplied customer credits cannot appear as allocated payments',()=>{ assert.match(sql,/join public\.account_partial_reconcile/); assert.doesNotMatch(sql,/showroom_sale:/); });
