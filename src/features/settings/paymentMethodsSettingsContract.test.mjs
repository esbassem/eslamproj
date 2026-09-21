import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const contractSql = readFileSync(
  new URL('../../../supabase/migrations/20260904140000_payment_methods_settings_contract.sql', import.meta.url),
  'utf8',
);
const transitionSql = readFileSync(
  new URL('../../../supabase/migrations/20260904141000_preserve_unused_clearing_configuration_transition.sql', import.meta.url),
  'utf8',
);
const sql = `${contractSql}\n${transitionSql}`;

test('defines an atomic idempotent canonical Settings creation command', () => {
  assert.match(sql, /create or replace function public\.create_financial_payment_method_for_settings/);
  assert.match(sql, /financial_payment_method_creation_requests/);
  assert.match(sql, /primary key \(tenant_id, idempotency_key\)/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /PAYMENT_METHOD_IDEMPOTENCY_PAYLOAD_MISMATCH/);
  assert.match(sql, /financial_payment_method_events/);
  assert.doesNotMatch(sql, /account_payment_methods/);
});

test('keeps direct destination selection transactional and centralizes compatibility', () => {
  assert.match(sql, /method_type in \('cash', 'bank_transfer', 'wallet'\) and settlement_mode = 'direct'/);
  assert.match(sql, /financial_payment_method_destination_types compatibility/);
  assert.match(sql, /PAYMENT_METHOD_COMPATIBLE_DESTINATION_REQUIRED/);
  assert.match(sql, /DIRECT_PAYMENT_METHOD_MUST_NOT_HAVE_CLEARING_CONFIGURATION/);
  assert.doesNotMatch(sql, /default_money_destination_id/);
});

test('exposes clearing choices without account or journal identifiers', () => {
  const signature = sql.match(/create or replace function public\.list_financial_payment_method_clearing_options[\s\S]*?language sql/)?.[0] ?? '';
  assert.match(signature, /configuration_key text/);
  assert.match(signature, /clearing_account_label text/);
  assert.match(signature, /clearing_journal_label text/);
  assert.doesNotMatch(signature, /clearing_account_id|clearing_journal_id/);
  assert.match(sql, /PAYMENT_METHOD_CLEARING_CONFIGURATION_INVALID/);
});

test('provides narrow lifecycle commands and immutable structure', () => {
  assert.match(sql, /create or replace function public\.rename_financial_payment_method/);
  assert.match(sql, /create or replace function public\.set_financial_payment_method_status/);
  assert.match(sql, /PAYMENT_METHOD_STRUCTURE_IMMUTABLE/);
  assert.match(sql, /PAYMENT_METHOD_CONFIGURATION_NOT_USABLE/);
  assert.doesNotMatch(sql, /delete from public\.financial_payment_methods/);
  assert.match(transitionSql, /old\.method_type in \('card', 'other'\)/);
  assert.match(transitionSql, /old\.settlement_mode = 'direct'/);
  assert.match(transitionSql, /new\.settlement_mode = 'clearing'/);
  assert.match(transitionSql, /not exists \([\s\S]*public\.financial_payments/);
  assert.match(transitionSql, /not exists \([\s\S]*public\.financial_refunds/);
});

test('keeps cheque unavailable and other reserved for extensibility', () => {
  assert.match(sql, /where code = 'cheque'/);
  assert.match(sql, /set is_active = false,[\s\S]*settings_enabled = false/);
  assert.match(sql, /where code = 'other'/);
  assert.match(sql, /settings_enabled = false/);
  assert.match(sql, /settings_enabled = true[\s\S]*'cash', 'bank_transfer', 'wallet', 'card'/);
});

test('reuses canonical permission and leaves UI/navigation untouched', () => {
  assert.match(sql, /financial\.payment_method\.manage/);
  assert.doesNotMatch(sql, /ir_ui_menus|settings\.payment_methods|\/app\/settings\/financial\/payment-methods/);
});
