import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260904120000_register_accountant_application.sql', import.meta.url),
  'utf8',
);

test('registers the existing Accountant application without replacing its UI route', () => {
  assert.match(migration, /'accountant_app'/);
  assert.match(migration, /'\u0627\u0644\u0645\u062d\u0627\u0633\u0628'/);
  assert.match(migration, /'\/apps\/accountant'/);
  assert.match(migration, /on conflict \(technical_name\) do update/i);
  assert.doesNotMatch(migration, /'accounting'\s*,\s*'\u0627\u0644\u0645\u062d\u0627\u0633\u0628'/);
});

test('keeps access permission and menu identities canonical and duplicate-safe', () => {
  assert.match(migration, /'accountant_app\.access'/);
  assert.match(migration, /on conflict \(code\) do update/i);
  assert.match(migration, /'accountant_app\.root'/);
  assert.match(migration, /'accountant_app\.payments'/);
  assert.match(migration, /delete from public\.ir_ui_menus/i);
  assert.match(migration, /menu identities/);
});

test('backfills only the verified known tenant identity', () => {
  assert.match(migration, /4ee5f357-8cf5-4770-8772-64de99532dac/);
  assert.match(migration, /معرض الوكيل حلوان/);
  assert.match(migration, /on conflict \(tenant_id, module_id\) do update/i);
  assert.doesNotMatch(migration, /from public\.tenants\s+cross join public\.ir_modules\s+module\s+where module\.technical_name/iu);
});
