import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShowroomAccountingSnapshot, sumPostedShowroomAccounting } from './showroomAccounting.js';

test('posted move calculates the ledger balance', () => {
  assert.deepEqual(buildShowroomAccountingSnapshot({ move: { id: 'move-id' }, receivableAmount: 37000, paidAmount: 34500 }), {
    has_accounting_move: true, accounting_status: 'posted', accounting_receivable_amount: 37000,
    accounting_paid_amount: 34500, accounting_remaining_amount: 2500,
  });
});

test('a move discovered by ref is treated as posted', () => {
  const result = buildShowroomAccountingSnapshot({ move: { ref: 'showroom_sale:sale-id' }, receivableAmount: 37000, paidAmount: 0 });
  assert.equal(result.has_accounting_move, true);
  assert.equal(result.accounting_remaining_amount, 37000);
});

test('missing move returns null accounting amounts and never the sale total', () => {
  assert.deepEqual(buildShowroomAccountingSnapshot({ move: null, receivableAmount: 37000, paidAmount: 0 }), {
    has_accounting_move: false, accounting_status: 'not_posted', accounting_receivable_amount: null,
    accounting_paid_amount: null, accounting_remaining_amount: null,
  });
});

test('fully, partially and unpaid posted sales remain correct', () => {
  assert.equal(buildShowroomAccountingSnapshot({ move: {}, receivableAmount: 37000, paidAmount: 37000 }).accounting_remaining_amount, 0);
  assert.equal(buildShowroomAccountingSnapshot({ move: {}, receivableAmount: 37000, paidAmount: 10000 }).accounting_remaining_amount, 27000);
  assert.equal(buildShowroomAccountingSnapshot({ move: {}, receivableAmount: 37000, paidAmount: 0 }).accounting_remaining_amount, 37000);
});

test('pending sale without a move also has unavailable accounting amounts', () => {
  assert.equal(buildShowroomAccountingSnapshot({ move: null }).accounting_remaining_amount, null);
});

test('unposted sales are excluded from all accounting totals', () => {
  assert.deepEqual(sumPostedShowroomAccounting([
    { has_accounting_move: true, accounting_receivable_amount: 37000, accounting_paid_amount: 34500, accounting_remaining_amount: 2500 },
    { has_accounting_move: false, total_amount: 37000, accounting_remaining_amount: null },
  ]), { receivable: 37000, paid: 34500, remaining: 2500 });
});
