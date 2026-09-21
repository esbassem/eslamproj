import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppBasePath } from './appResolver.js';

test('registered applications launch through their canonical registry routes', () => {
  assert.equal(getAppBasePath('paperwork'), '/apps/paperwork');
  assert.equal(getAppBasePath('products'), '/apps/inventory');
  assert.equal(getAppBasePath('accountant_app'), '/apps/accountant');
  assert.equal(getAppBasePath('moto_customer_care'), '/app/moto-customer-care/sales');
});

test('unregistered dynamic applications retain the generic fallback', () => {
  assert.equal(getAppBasePath('custom_module'), '/app/custom_module');
});
