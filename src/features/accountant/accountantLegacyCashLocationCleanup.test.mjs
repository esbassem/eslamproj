import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

function readRuntimeSources(directoryUrl) {
  return readdirSync(directoryUrl, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(entry.name, directoryUrl);
    if (entry.isDirectory()) return readRuntimeSources(new URL(`${entry.name}/`, directoryUrl));
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [readFileSync(entryUrl, 'utf8')] : [];
  });
}

const accountantService = read('./services/accountant.service.js');
const accountantHome = read('./pages/AccountantHomePage.jsx');
const cashLocationSheet = read('./components/CashLocationSheet.jsx');
const runtimeSources = readRuntimeSources(new URL('../../', import.meta.url)).join('\n');

test('runtime has no dependency on the retired cash-location operation RPC', () => {
  assert.doesNotMatch(runtimeSources, /create_cash_location_operation|createCashLocationOperation/);
});

test('keeps settlement accounts for its active Accountant consumer', () => {
  assert.match(accountantService, /async listSettlementAccounts\(/);
  assert.match(accountantHome, /accountantService\.listSettlementAccounts\(\{ tenantId \}\)/);
});

test('CashLocationSheet continues to collect invoices through canonical settlement', () => {
  assert.match(cashLocationSheet, /accountantService\.settleSalesInvoiceBalance\(/);
  assert.match(accountantService, /settlementService\.settleObligation\(\{/);
  assert.match(accountantService, /targetType: 'sale'/);
  assert.match(accountantService, /mechanism: 'money_payment'/);
});
