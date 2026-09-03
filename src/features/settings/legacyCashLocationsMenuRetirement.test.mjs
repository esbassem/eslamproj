import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260904123000_retire_legacy_cash_locations_settings_menu.sql', import.meta.url),
  'utf8',
);

test('retires only the obsolete Settings menu row and is idempotent', () => {
  assert.match(migration, /technical_name = 'settings'/);
  assert.match(migration, /update public\.ir_ui_menus[\s\S]*set active = false/);
  assert.match(migration, /module_id = v_settings_module_id[\s\S]*and active = true/);
  assert.match(migration, /route_path = '\/app\/settings\/accounting\/cash-locations'/);
  assert.match(migration, /name = 'الخزائن والعهد'/);
  assert.match(migration, /'settings\.accounting\.cash_locations'/);
  assert.doesNotMatch(migration, /delete from public\.ir_ui_menus/);
});

test('guards the current Accounting and Financial Settings navigation', () => {
  assert.match(migration, /code = 'settings\.accounting'[\s\S]*route_path = '\/app\/settings\?section=accounting'[\s\S]*active = true/);
  assert.match(migration, /code = 'settings\.financial_setup'[\s\S]*route_path = '\/app\/settings\/financial'[\s\S]*active = true/);
  assert.match(migration, /code = 'settings\.money_destinations'[\s\S]*route_path = '\/app\/settings\/financial\/money-destinations'[\s\S]*active = true/);
});
