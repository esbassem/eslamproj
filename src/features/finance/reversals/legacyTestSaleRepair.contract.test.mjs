import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(new URL('../../../../supabase/migrations/20260909140000_repair_legacy_test_sale_missing_journal.sql', import.meta.url), 'utf8');

test('legacy repair is migration-scoped and hard allowlisted', () => {
  assert.match(sql, /create function pg_temp\.reverse_legacy_missing_journal_move/);
  assert.match(sql, /LEGACY_REPAIR_MOVE_NOT_ALLOWLISTED/);
  assert.match(sql, /c09713d3-2da3-4f66-ba38-780dea3ae8df/);
  assert.match(sql, /CANONICAL_GENERAL_JOURNAL_NOT_UNIQUE/);
  assert.match(sql, /LEGACY_MISSING_ORIGINAL_JOURNAL/);
  assert.doesNotMatch(sql, /grant execute.*reverse_legacy_missing_journal_move/is);
});

test('repair is idempotent, balanced and reconciles only the approved AR line', () => {
  assert.match(sql, /legacy-repair:test-sale-reversal:43c00089-d7dd-4119-b0e7-cd89c1d97343/);
  assert.match(sql, /LEGACY_TEST_SALE_REPAIR_REPLAY_MISMATCH/);
  assert.match(sql, /accounting_assert_move_balanced/);
  assert.match(sql, /v_original_ar,rev_ar,50000/);
  assert.match(sql, /legacy_receivable_cleanup/);
  assert.match(sql, /v_credit_exception_ar/);
});
