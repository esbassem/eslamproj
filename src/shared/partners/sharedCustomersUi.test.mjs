import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const entry = read('./index.js');
const form = read('../../features/contacts/components/PartnerFormSheet.jsx');
const creation = read('./useCustomerCreation.js');
const picker = read('./CustomerPicker.jsx');
const search = read('./useCustomerSearch.js');
const service = read('../../features/contacts/services/partners.service.js');
const sales = read('../../features/sales/create/SaleCustomerSelector.jsx');
const editor = read('../../features/sales/create/SaleDraftEditor.jsx');

test('shared form remains one implementation with compatible resolution callback and mobile close', () => {
  assert.match(entry, /PartnerFormSheet.*features\/contacts\/components\/PartnerFormSheet/);
  assert.match(form, /context = null/);
  assert.match(form, /onResolved/);
  assert.match(form, /partnerId:[\s\S]*source:/);
  assert.match(form, /sm:hidden/);
});
test('customer creation uses central authorization and canonical partner service', () => {
  assert.match(creation, /PARTNERS_CREATE_CUSTOMER/);
  assert.match(creation, /PARTNERS_CREATE/);
  assert.match(creation, /partnersService\.createPartner/);
  assert.match(creation, /isCustomer: true/);
  assert.match(creation, /isSupplier: false/);
});
test('picker supports injected contracts, debounce and pagination', () => {
  assert.match(picker, /useCustomerSearch/);
  assert.match(search, /debounceMs = 250/);
  assert.match(search, /nextPage: page \+ 1/);
  assert.match(service, /async searchCustomers/);
  assert.match(service, /\.eq\('tenant_id', tenantId\)/);
  assert.match(service, /\.range\(from, from \+ safePageSize - 1\)/);
  assert.match(sales, /salesService\.searchSaleCustomers/);
});
test('sales create selects only the draft customer and adds no business command', () => {
  assert.match(editor, /useCustomerCreation/);
  assert.match(editor, /draft\.setField\('customer', customer\)/);
  assert.doesNotMatch(editor, /confirm_sale|post_financial_sale|deliverSale/);
});
