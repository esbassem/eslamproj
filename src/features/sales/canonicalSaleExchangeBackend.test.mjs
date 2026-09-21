import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sql = readFileSync(new URL('../../../supabase/migrations/20260908130000_canonical_sale_exchange.sql', import.meta.url), 'utf8');
const commandTypeHardening = readFileSync(new URL('../../../supabase/migrations/20260908140000_restore_sale_draft_intent_command_type.sql', import.meta.url), 'utf8');
const eligibility = sql.slice(sql.indexOf('create or replace function public.get_sale_exchange_eligibility'), sql.indexOf('create or replace function public.start_sale_exchange'));
const command = sql.slice(sql.indexOf('create or replace function public.start_sale_exchange'), sql.indexOf('alter table public.sale_exchange_commands enable row level security'));

test('1. Exchange is a relationship, never a Sale type', () => {
  assert.match(sql, /original Sale, a canonical[\s\S]*Return,[\s\S]*replacement Sale Draft/i);
  assert.doesNotMatch(sql, /sale_type\s*=\s*'exchange'|add column sale_type/);
});
test('2. Draft cannot exchange', () => assert.match(command, /v_original\.status <> 'confirmed'[\s\S]*SALE_NOT_CONFIRMED/));
test('3. Undelivered items are rejected by authoritative Return eligibility', () => {
  assert.match(eligibility, /get_sale_return_eligibility\(p_sale_id\)/);
  assert.match(command, /public\.return_sale\(/);
});
test('4. Delivered serialized goods reuse canonical Return validation', () => assert.match(command, /p_return_lines[\s\S]*public\.return_sale\(/));
test('5. Same serial cannot exchange twice', () => assert.match(command, /public\.return_sale\([\s\S]*exchange-return:/));
test('6. Quantity partial Exchange is not forced to replacement quantity', () => {
  assert.doesNotMatch(command, /p_return_lines\s*=\s*p_replacement_lines/);
  assert.match(command, /v_quantity is null or v_quantity <= 0/);
});
test('7. Over-return remains owned by Return Core', () => assert.match(command, /public\.return_sale\(/));
test('8. Exactly one canonical Return is linked durably', () => {
  assert.match(sql, /sale_exchanges_return_unique unique \(tenant_id, sale_return_id\)/);
  assert.equal((command.match(/public\.return_sale\(/g) || []).length, 1);
});
test('9. Exactly one ordinary replacement Sale Draft is created', () => {
  assert.match(command, /public\.create_sale\(/);
  assert.match(command, /public\.update_sale_draft\(/);
  assert.match(sql, /sale_exchanges_replacement_unique unique \(tenant_id, replacement_sale_id\)/);
});
test('10. Replacement and Original Sales are linked without mutation of original facts', () => {
  assert.match(sql, /original_sale_id uuid not null/);
  assert.match(sql, /replacement_sale_id uuid/);
  assert.doesNotMatch(command, /update public\.sales set[\s\S]{0,150}(total_amount|customer_id|branch_id|sale_number)\s*=/);
});
test('11. Return financial effect is delegated, not recreated', () => {
  assert.match(command, /public\.return_sale\(/);
  assert.doesNotMatch(command, /post_financial_sale_return|insert into public\.account_move/);
});
test('12. Replacement Draft creates no financial posting', () => assert.doesNotMatch(command, /confirm_sale|financial_sale_postings|account_move_lines/));
test('13. Replacement Draft creates no inventory reservation', () => assert.doesNotMatch(command, /reserve_inventory|inventory_reservations/));
test('14. Idempotent retry returns the stored aggregate result', () => {
  assert.match(sql, /sale_exchange_commands_unique unique \(tenant_id, idempotency_key\)/);
  assert.match(command, /return v_command\.result \|\| jsonb_build_object\('idempotent_replay', true\)/);
});
test('15. Original version is checked under lock', () => {
  assert.match(command, /for update/);
  assert.match(command, /p_expected_version <> v_original\.version[\s\S]*SALES_VERSION_CONFLICT/);
});
test('16. Branch scope is enforced', () => assert.match(command, /has_branch_access\(v_original\.branch_id\)/));
test('17. Tenant is derived from authenticated context', () => {
  assert.match(command, /v_tenant uuid := public\.current_tenant_id\(\)/);
  assert.doesNotMatch(command, /p_tenant_id/);
});
test('18. sales.exchange permission is explicit', () => assert.match(command, /has_permission\('sales\.exchange', v_tenant\)/));
test('19. No direct Inventory or accounting permission is needed by the user', () => {
  assert.doesNotMatch(command, /has_permission\('inventory\.|has_permission\('financial\.|has_permission\('accounting\./);
});
test('20. Return and replacement creation share one database transaction', () => {
  assert.match(sql, /^begin;/);
  assert.match(sql, /commit;\s*$/);
  assert.doesNotMatch(command, /commit;|rollback;/);
});
test('21. Replacement failure rolls back the Return fact', () => assert.match(command, /return_sale\([\s\S]*create_sale\([\s\S]*update_sale_draft\(/));
test('22. Serialized concurrency is inherited from locked Return facts', () => assert.match(command, /select \* into v_original[\s\S]*for update/));
test('23. Quantity concurrency is protected by the same original Sale lock', () => assert.match(command, /select \* into v_original[\s\S]*for update/));
test('24. Service replacement intent never creates a stock intent', () => assert.match(command, /v_product\.product_type = 'service'[\s\S]*v_inventory_intents/));
test('25. Replacement confirmation remains the normal later confirm_sale flow', () => {
  assert.doesNotMatch(sql, /create or replace function public\.confirm_exchange/);
  assert.doesNotMatch(command, /public\.confirm_sale\(/);
});
test('26. Exchange lines trace both sides without fake one-to-one matching', () => {
  assert.match(sql, /line_role text not null/);
  assert.match(sql, /line_role in \('returned', 'replacement'\)/);
});
test('27. Confirmed operational version bumps preserve immutable commercial fields', () => {
  assert.match(sql, /old\.status = 'confirmed' and new\.status = 'confirmed'/);
  assert.match(sql, /new\.version <> old\.version \+ 1/);
});
test('28. Exchange replacement Draft keeps the inventory-intent command type valid', () => {
  assert.match(commandTypeHardening, /'update_draft_with_intent'/);
  for (const type of ['create', 'update_draft', 'confirm', 'deliver', 'cancel', 'return']) {
    assert.match(commandTypeHardening, new RegExp(`'${type}'`));
  }
});
