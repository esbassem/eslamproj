import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shadowRead = readFileSync(
  new URL('../../../../supabase/tests/showroom_canonical_shadow_read_runtime.sql', import.meta.url),
  'utf8',
);
const showroomService = readFileSync(
  new URL('../../showroom/services/showroom.service.js', import.meta.url),
  'utf8',
);

test('shadow read is session-local and contains no production DML', () => {
  assert.match(shadowRead, /create temporary table shadow_showroom_snapshot/iu);
  assert.match(shadowRead, /create function pg_temp\.compare_sale_posting/iu);
  assert.doesNotMatch(shadowRead, /\b(insert into|update|delete from) public\./iu);
  assert.doesNotMatch(
    shadowRead,
    /\b(?:perform|select)\s+public\.(?:post_financial_sale|acquire_financial_engine_binding|finalize_financial_engine_binding|bind_showroom_sale_to_legacy_engine)\s*\(/iu,
  );
});

test('canonical expectation reuses the posting contract resolvers', () => {
  assert.match(
    shadowRead,
    /public\.resolve_functional_account\(\s*context\.tenant_id, 'customer_receivable', context\.branch_id/iu,
  );
  assert.match(
    shadowRead,
    /public\.resolve_functional_account\(\s*context\.tenant_id, 'sales_revenue', context\.branch_id/iu,
  );
  assert.match(
    shadowRead,
    /public\.resolve_financial_journal\(\s*context\.tenant_id, 'sale', context\.branch_id, null/iu,
  );
  assert.match(shadowRead, /public\.assert_financial_posting_date/iu);
});

test('Showroom adapter emits commercial facts and Legacy extraction uses the bound move only', () => {
  const adapter = shadowRead.match(
    /create temporary table shadow_showroom_snapshot as[\s\S]*?create temporary table shadow_exclusions/iu,
  )?.[0] ?? '';
  assert.match(adapter, /binding\.legacy_move_id/iu);
  assert.match(adapter, /sale\.customer_id/iu);
  assert.match(adapter, /sale\.total_amount/iu);
  assert.match(adapter, /sale\.sale_date/iu);
  assert.doesNotMatch(adapter, /receivable_account_id|revenue_account_id|journal_id/iu);
  assert.match(
    shadowRead,
    /move\.id = snapshot\.legacy_move_id/iu,
  );
});

test('semantic adoption, policy observation, tenant isolation, and zero-write proof are explicit', () => {
  assert.match(shadowRead, /mapping\.canonical_semantic_key/iu);
  assert.match(shadowRead, /H_CLOSED_PERIOD_IS_OBSERVATION_ONLY/iu);
  assert.match(shadowRead, /SHADOW_COMPARE_CROSS_TENANT_FORBIDDEN/iu);
  assert.match(shadowRead, /SHADOW_READ_ZERO_WRITE_PROOF_FAILED/iu);
  assert.match(shadowRead, /financial_engine_bindings[\s\S]*?fingerprint/iu);
  assert.match(shadowRead, /showroom_sale_linkage/iu);
});

test('Showroom frontend remains on Legacy confirmation and exposes no shadow reader', () => {
  assert.match(showroomService, /rpc\(["']complete_showroom_sale["']/u);
  assert.doesNotMatch(showroomService, /post_financial_sale|canonical_shadow|shadow_read/iu);
});
