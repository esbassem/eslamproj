import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../../../../supabase/migrations/20260829130000_advance_application_reclassification_core.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('./financialAdvances.service.js', import.meta.url), 'utf8');

for (const contract of ['list_allocatable_targets_for_advance', 'apply_financial_advance', 'get_financial_advance_application_summary', 'unapply_financial_advance']) {
  assert.match(sql, new RegExp(`function public\\.${contract}\\(`));
  assert.match(service, new RegExp(`['"]${contract}['"]`));
}
assert.doesNotMatch(sql, /212001|114001/);
assert.match(sql, /customer_advance/);
assert.match(sql, /supplier_advance/);
assert.match(sql, /ADVANCE_UNAPPLICATION_REQUIRES_ACCOUNTING_REVERSAL_CORE/);
assert.match(sql, /advance_partial_reconcile_id/);
assert.match(sql, /target_partial_reconcile_id/);
assert.doesNotMatch(sql, /insert into public\.financial_payments/i);
console.log('financial advance contract tests passed');
