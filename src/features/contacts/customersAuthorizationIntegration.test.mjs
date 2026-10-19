import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const readSource = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('Partner writes use only the four canonical RPC contracts', async () => {
  const source = await readSource('./services/partners.service.js');

  for (const rpc of ['create_partner', 'update_partner', 'archive_partner', 'reactivate_partner']) {
    assert.match(source, new RegExp(`rpc\\('${rpc}'`));
  }
  assert.doesNotMatch(source, /from\(['"]partners['"]\)[\s\S]{0,180}\.(?:insert|update|delete|upsert)\(/);
});

test('Contacts gates partner create, update, and archive through central authorization', async () => {
  const source = await readSource('./components/PartnerList.jsx');

  assert.match(source, /useAuthorization\(\)/);
  assert.match(source, /can\(PERMISSIONS\.PARTNERS_CREATE\)/);
  assert.match(source, /can\(PERMISSIONS\.PARTNERS_CREATE_CUSTOMER\)/);
  assert.match(source, /can\(PERMISSIONS\.PARTNERS_UPDATE\)/);
  assert.match(source, /can\(PERMISSIONS\.PARTNERS_ARCHIVE\)/);
  assert.match(source, /onAdd=\{canCreate \?/);
  assert.match(source, /canCreate=\{canCreateAnyPartner\}/);
  assert.match(source, /canUpdate=\{canUpdate\}/);
  assert.match(source, /canArchive=\{canArchive\}/);
});

test('Dashboard customer-only quick create uses the effective customer-create permission', async () => {
  const source = await readSource('../dashboard/pages/DashboardPage.jsx');

  assert.match(source, /can\(PERMISSIONS\.PARTNERS_CREATE_CUSTOMER\)/);
  assert.match(source, /onCreateCustomer=\{canCreateCustomer \?/);
  assert.match(source, /canCreateCustomer && isCustomerSheetOpen/);
  assert.match(source, /\.\.\.\(onCreateCustomer \? \[\{/);
});

test('Accountant customer creation hides both trigger and sheet without permission', async () => {
  const source = await readSource('../accountant/pages/AccountantHomePage.jsx');

  assert.match(source, /can\(PERMISSIONS\.PARTNERS_CREATE_CUSTOMER\)/);
  assert.match(source, /\{canCreateCustomer \? <button/);
  assert.match(source, /\{canCreateCustomer \? <PartnerFormSheet/);
  assert.match(source, /if \(!canCreateCustomer\)/);
});

test('Receivables keeps existing partner selection while gating new customer actions', async () => {
  const pageSource = await readSource('../receivables/pages/ReceivablesPage.jsx');
  const sheetSource = await readSource('../receivables/components/ReceivableManualCreateSheet.jsx');

  assert.match(pageSource, /can\(PERMISSIONS\.PARTNERS_CREATE_CUSTOMER\)/);
  assert.match(pageSource, /onCreateCustomer=\{canCreateCustomer \? handleCreateCustomer : null\}/);
  assert.equal((sheetSource.match(/\{onCreateCustomer \? <button/g) || []).length, 2);
  assert.match(sheetSource, /filteredCustomers\.map\(\(customer\) => \(\s*<button/);
  assert.match(sheetSource, /\{onCreateCustomer \? <PartnerFormSheet/);
});

test('customer-only entry points continue forcing the customer role', async () => {
  const writerSources = await Promise.all([
    readSource('../dashboard/pages/DashboardPage.jsx'),
    readSource('../accountant/pages/AccountantHomePage.jsx'),
    readSource('../receivables/pages/ReceivablesPage.jsx'),
  ]);

  for (const source of writerSources) {
    assert.match(source, /isCustomer:\s*true/);
    assert.match(source, /isSupplier:\s*false/);
  }

  const formSources = await Promise.all([
    readSource('../dashboard/pages/DashboardPage.jsx'),
    readSource('../accountant/pages/AccountantHomePage.jsx'),
    readSource('../receivables/components/ReceivableManualCreateSheet.jsx'),
  ]);

  for (const source of formSources) {
    assert.match(source, /hideTypeFields/);
  }
});
