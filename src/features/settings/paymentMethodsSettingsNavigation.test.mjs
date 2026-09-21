import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('registers Payment Methods immediately after Money Destinations under Financial Setup', () => {
  const migration = read('../../../supabase/migrations/20260904150000_add_payment_methods_settings_menu.sql');
  assert.match(migration, /code = 'settings\.financial_setup'/);
  assert.match(migration, /'settings\.financial\.payment_methods', '\/app\/settings\/financial\/payment-methods'/);
  assert.match(migration, /'CreditCard', 20, true/);
  assert.match(migration, /parent_id = v_financial_setup_id/);
});

test('registers a direct and refresh-safe frontend destination without replacing the parent route', () => {
  const routes = read('../../core/config/routes.config.js');
  const registry = read('../../app/router/menuRegistry.js');
  const page = read('./pages/SettingsPage.jsx');
  assert.match(routes, /settingsFinancial: '\/app\/settings\/financial'/);
  assert.match(routes, /settingsPaymentMethods: '\/app\/settings\/financial\/payment-methods'/);
  assert.match(registry, /'\/app\/settings\/financial\/payment-methods'/);
  assert.match(page, /location\.pathname === ROUTES\.settingsPaymentMethods/);
  assert.match(page, /<PaymentMethodsSettings/);
});

test('keeps the canonical parent navigation generic and free from a fake overview child', () => {
  const navigation = read('./settingsNavigation.js');
  const page = read('./pages/SettingsPage.jsx');
  assert.match(navigation, /'settings\.financial_setup': 'financial_setup'/);
  assert.doesNotMatch(navigation, /settings\.financial\.payment_methods|settings\.money_destinations/);
  assert.doesNotMatch(page, /نظرة عامة/);
});
