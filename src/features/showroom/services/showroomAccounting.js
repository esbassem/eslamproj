export function buildShowroomAccountingSnapshot({ move, receivableAmount, paidAmount } = {}) {
  if (!move) {
    return {
      has_accounting_move: false,
      accounting_status: 'not_posted',
      accounting_receivable_amount: null,
      accounting_paid_amount: null,
      accounting_remaining_amount: null,
    };
  }

  const receivable = Math.round(Number(receivableAmount || 0) * 100) / 100;
  const paid = Math.round(Number(paidAmount || 0) * 100) / 100;
  return {
    has_accounting_move: true,
    accounting_status: 'posted',
    accounting_receivable_amount: receivable,
    accounting_paid_amount: paid,
    accounting_remaining_amount: Math.max(Math.round((receivable - paid) * 100) / 100, 0),
  };
}

export function sumPostedShowroomAccounting(sales = []) {
  return sales.reduce((totals, sale) => {
    if (sale?.has_accounting_move !== true) return totals;
    return {
      receivable: totals.receivable + Number(sale.accounting_receivable_amount || 0),
      paid: totals.paid + Number(sale.accounting_paid_amount || 0),
      remaining: totals.remaining + Number(sale.accounting_remaining_amount || 0),
    };
  }, { receivable: 0, paid: 0, remaining: 0 });
}
