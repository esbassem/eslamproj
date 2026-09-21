import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');
const migration = read('../../../supabase/migrations/20260904130000_retire_legacy_accounting_settings_branch.sql');

test('retires the complete legacy Accounting Settings branch idempotently', () => {
  assert.match(migration, /code = 'settings\.accounting'/);
  assert.match(migration, /parent_id = v_accounting_menu_id/);
  assert.match(migration, /code like 'settings\.accounting\.%'/);
  assert.match(migration, /set active = false/);
  assert.doesNotMatch(migration, /delete from/);
});

test('removes legacy Accounting Settings support while preserving canonical finance routes', () => {
  const sources = [
    read('./pages/SettingsPage.jsx'),
    read('./settingsNavigation.js'),
    read('./components/SettingsSectionNav.jsx'),
    read('./components/SettingsLayout.jsx'),
    read('../../core/config/routes.config.js'),
    read('../../routes/index.jsx'),
  ].join('\n');

  assert.doesNotMatch(sources, /settings\.accounting|section=accounting|activeAccountingTab|AccountingSettings/);
  assert.match(sources, /\/app\/settings\/financial/);
  assert.match(sources, /\/app\/settings\/financial\/money-destinations/);
  assert.match(sources, /\/app\/settings\/financial\/payment-methods/);
});
