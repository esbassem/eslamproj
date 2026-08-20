import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyAccessError, validateDefaults } from './accessControl.js';

const details = {
  branchAccess: [{ branchId: 'branch-a' }],
  posAccess: [{ posId: 'pos-a', branchId: 'branch-a' }],
  stockAccess: [{ stockLocationId: 'stock-a', branchId: 'branch-a' }],
};

test('valid operational defaults pass client validation', () => {
  assert.equal(validateDefaults({ defaultBranchId: 'branch-a', defaultPosId: 'pos-a', defaultStockLocationId: 'stock-a' }, details), '');
});

test('unauthorized branch default is rejected', () => {
  assert.match(validateDefaults({ defaultBranchId: 'branch-b', defaultPosId: '', defaultStockLocationId: '' }, details), /الفروع المسموحة/);
});

test('POS and stock defaults must belong to the selected branch', () => {
  assert.match(validateDefaults({ defaultBranchId: 'branch-a', defaultPosId: 'pos-b', defaultStockLocationId: '' }, details), /نقطة البيع/);
  assert.match(validateDefaults({ defaultBranchId: 'branch-a', defaultPosId: '', defaultStockLocationId: 'stock-b' }, details), /موقع المخزون/);
});

test('dependency and authorization errors are translated', () => {
  assert.match(friendlyAccessError({ code: '23503', message: 'foreign key violation' }), /عناصر مرتبطة/);
  assert.match(friendlyAccessError({ code: '42501', message: 'row-level security' }), /ليس لديك إذن/);
});
