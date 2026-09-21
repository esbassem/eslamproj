import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../../../../supabase/migrations/20260909180000_financial_source_context_resolver.sql',import.meta.url),'utf8');
test('resolver is canonical, scoped and read-only',()=>{assert.match(sql,/financial_sale_postings/);assert.match(sql,/sale_historical_sources/);assert.match(sql,/has_financial_resource_access/);assert.doesNotMatch(sql,/insert into|update public|delete from/i);});
test('allocation truth precedes the historical text adapter',()=>{assert.ok(sql.indexOf("v_move.move_type='payment'")<sql.indexOf('financial_historical_adapter'));assert.match(sql,/unapplied_customer_credit/);});
test('resolver hides ledger implementation identifiers',()=>{assert.doesNotMatch(sql,/jsonb_build_object\([^]*account_id/);assert.match(sql,/'can_open_sale'/);});
