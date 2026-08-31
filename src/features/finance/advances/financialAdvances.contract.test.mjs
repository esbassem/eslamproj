import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../../../supabase/migrations/20260829130000_advance_application_reclassification_core.sql', import.meta.url), 'utf8');
const reversalSql = readFileSync(new URL('../../../../supabase/migrations/20260830121000_accounting_reversal_domains.sql', import.meta.url), 'utf8');
const signatureSql = readFileSync(new URL('../../../../supabase/migrations/20260830122000_finalize_reversal_contract_signatures.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('./financialAdvances.service.js', import.meta.url), 'utf8');

for (const contract of ['list_allocatable_targets_for_advance', 'apply_financial_advance', 'get_financial_advance_application_summary', 'unapply_financial_advance']) {
  assert.match(sql, new RegExp(`function public\\.${contract}\\(`));
  assert.match(service, new RegExp(`['"]${contract}['"]`));
}
assert.doesNotMatch(sql, /212001|114001/);
assert.match(sql, /customer_advance/);
assert.match(sql, /supplier_advance/);
assert.match(reversalSql, /create or replace function public\.unapply_financial_advance\(/i);
assert.match(reversalSql, /reversal_remove_partial/);
assert.match(reversalSql, /create_reversing_account_move/);
assert.match(reversalSql, /status='unapplied'/);
assert.match(signatureSql, /drop function if exists public\.unapply_financial_advance\(uuid,uuid,text\)/i);
assert.match(sql, /advance_partial_reconcile_id/);
assert.match(sql, /target_partial_reconcile_id/);
assert.doesNotMatch(sql, /insert into public\.financial_payments/i);
console.log('financial advance contract tests passed');
