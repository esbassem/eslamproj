const text = (value) => typeof value === 'string' ? value.trim() : '';
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function currencyAmount(value) {
  return {
    currencyCode: text(value?.currency_code).toUpperCase() || 'EGP',
    amount: number(value?.amount),
  };
}

function salesperson(value) {
  return {
    salesperson: {
      id: text(value?.salesperson?.id),
      name: text(value?.salesperson?.name) || 'موظف غير محدد',
    },
    confirmedSalesCount: Math.max(Math.trunc(number(value?.confirmed_sales_count)), 0),
    salesValueByCurrency: Array.isArray(value?.sales_value_by_currency)
      ? value.sales_value_by_currency.map(currencyAmount)
      : [],
  };
}

export function normalizeSalesBranchReports(value) {
  return (Array.isArray(value) ? value : []).map((report) => ({
    branch: {
      id: text(report?.branch?.id),
      name: text(report?.branch?.name),
    },
    confirmedSalesCount: Math.max(Math.trunc(number(report?.confirmed_sales_count)), 0),
    salesValueByCurrency: Array.isArray(report?.sales_value_by_currency)
      ? report.sales_value_by_currency.map(currencyAmount)
      : [],
    outstandingByCurrency: Array.isArray(report?.outstanding_by_currency)
      ? report.outstanding_by_currency.map(currencyAmount)
      : [],
    allTimeOutstandingByCurrency: Array.isArray(report?.all_time_outstanding_by_currency)
      ? report.all_time_outstanding_by_currency.map(currencyAmount)
      : [],
    pendingDeliveryCount: Math.max(Math.trunc(number(report?.pending_delivery_count)), 0),
    salespeople: Array.isArray(report?.salespeople)
      ? report.salespeople.map(salesperson).filter((entry) => entry.salesperson.id)
      : [],
  })).filter((report) => report.branch.id);
}
