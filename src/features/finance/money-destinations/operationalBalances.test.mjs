import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../../../supabase/migrations/20260904170000_money_destination_operational_balances.sql', import.meta.url), 'utf8');
const service = readFileSync(new URL('./moneyDestinations.service.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../../settings/sections/financial/MoneyDestinationsSettings.jsx', import.meta.url), 'utf8');

test('balance read model is tenant-, permission-, resource-, and active-destination safe', () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /list_allowed_money_destinations/);
  assert.match(migration, /p_tenant_id/);
  assert.match(migration, /p_permission_code/);
  assert.match(migration, /p_access_type/);
  assert.match(migration, /parent_state = 'posted'/);
  assert.match(migration, /revoke all.*from public, anon/is);
  assert.match(migration, /grant execute.*to authenticated/is);
});

test('balance API returns only operational fields and never raw ledger rows', () => {
  const returnColumns = migration.match(/returns table \(([\s\S]*?)\)\nlanguage/)?.[1] ?? '';
  assert.match(service, /list_money_destination_operational_balances/);
  assert.match(service, /destinationId/);
  assert.match(service, /calculatedAt/);
  assert.doesNotMatch(returnColumns, /ledger_account_id|journal_id/);
  assert.doesNotMatch(service, /\.from\(['"]account_move_lines/);
});

test('Settings shows lightweight balance without transaction actions', () => {
  assert.match(settings, /listMoneyDestinationBalances/);
  assert.match(settings, /الرصيد التشغيلي/);
  assert.doesNotMatch(settings, /RegisterPaymentSheet|InternalTransferSheet/);
});
