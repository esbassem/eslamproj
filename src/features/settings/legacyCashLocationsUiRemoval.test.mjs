import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

test('obsolete Cash Locations Settings UI has no frontend route or loader', () => {
  const sources = [
    read('../../app/router/appRouteRegistry.js'),
    read('../../app/router/menuRegistry.js'),
    read('../../core/config/routes.config.js'),
  ].join('\n');

  for (const obsoleteReference of [
    ['CashLocations', 'SettingsPage'].join(''),
    ['/app/settings/accounting', 'cash-locations'].join('/'),
    ['settings', 'CashLocations'].join(''),
    ['cashLocations', 'Settings'].join(''),
    ['الخزائن', 'والعهد'].join(' '),
  ]) {
    assert.doesNotMatch(sources, new RegExp(obsoleteReference));
  }
});

test('Dashboard custody behavior uses the retained operational service', () => {
  const dashboard = read('../dashboard/pages/DashboardPage.jsx');
  const custodyService = read('../accountant/services/employeeCustody.service.js');

  assert.match(dashboard, /accountant\/services\/employeeCustody\.service/);
  assert.match(dashboard, /employeeCustodyService\.getEmployeeCustodyAccount/);
  assert.match(custodyService, /async getEmployeeCustodyAccount/);
  for (const removedMethod of ['listEmployees', 'listCustodyAccounts', 'createCustodyAccount', 'deleteCustodyAccount']) {
    assert.doesNotMatch(custodyService, new RegExp(removedMethod));
  }
});

test('Accountant cash-location operations and canonical Financial Settings remain intact', () => {
  const accountantService = read('../accountant/services/accountant.service.js');
  const routes = read('../../core/config/routes.config.js');
  const registry = read('../../app/router/menuRegistry.js');

  assert.match(accountantService, /create_cash_location_operation/);
  assert.match(routes, /settingsFinancial: '\/app\/settings\/financial'/);
  assert.match(routes, /settingsMoneyDestinations: '\/app\/settings\/financial\/money-destinations'/);
  assert.match(routes, /settingsPaymentMethods: '\/app\/settings\/financial\/payment-methods'/);
  assert.match(registry, /'\/app\/settings\/financial'/);
  assert.match(registry, /'\/app\/settings\/financial\/money-destinations'/);
});
