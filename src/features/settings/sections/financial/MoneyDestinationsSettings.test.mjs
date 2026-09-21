import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./MoneyDestinationsSettings.jsx', import.meta.url), 'utf8');

test('has loading, error, empty, and list states', () => {
  assert.match(source, /جاري تحميل أماكن الأموال/);
  assert.match(source, /role="alert"/);
  assert.match(source, /لا توجد أماكن أموال حتى الآن/);
  assert.match(source, /state\.items\.map/);
});

test('provides all five progressive type forms without account or journal inputs', () => {
  for (const code of ['cashbox', 'bank', 'employee_cash_custody', 'pos_drawer', 'wallet']) assert.match(source, new RegExp(code));
  assert.match(source, /values\.type === 'bank'/);
  assert.match(source, /values\.type === 'employee_cash_custody'/);
  assert.match(source, /values\.type === 'pos_drawer'/);
  assert.doesNotMatch(source, /ledgerAccount|journalId|accountCode|create_employee_custody_account|111003/);
});

test('loads employee and POS selectors only after their type is selected', () => {
  assert.match(source, /values\.type !== 'employee_cash_custody'/);
  assert.match(source, /moneyDestinationsService\.listEmployees/);
  assert.match(source, /values\.type !== 'pos_drawer'/);
  assert.match(source, /moneyDestinationsService\.listPosConfigs/);
});

test('guards double submit with a stable request key and pending ref', () => {
  assert.match(source, /requestKey\.current = crypto\.randomUUID\(\)/);
  assert.match(source, /if \(!valid \|\| submitting\.current\) return/);
  assert.match(source, /submitting\.current = true/);
});

test('supports safe rename and lifecycle without destructive deletion', () => {
  assert.match(source, /moneyDestinationsService\.rename/);
  assert.match(source, /setStatus\('inactive'\)/);
  assert.match(source, /setStatus\('active'\)/);
  assert.match(source, /setStatus\('archived'\)/);
  assert.doesNotMatch(source, /\.delete\(|حذف مكان/);
});

test('refreshes canonical readiness after every successful change', () => {
  assert.match(source, /financialReadinessService\.getReadiness\(tenantId\)/);
  assert.match(source, /onCreated=\{refreshAfterChange\}/);
  assert.match(source, /onChanged=\{refreshAfterChange\}/);
});
