const PERIOD_CODES = new Set(['today', 'last_7_days', 'this_month']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function entity(value) {
  return { id: text(value?.id) || null, name: text(value?.name) };
}

function currencyAmount(value) {
  return {
    currencyCode: text(value?.currency_code).toUpperCase() || 'EGP',
    amount: number(value?.amount),
  };
}

function overviewSale(value = {}) {
  return {
    id: text(value.id),
    saleNumber: text(value.sale_number) || null,
    effectiveSaleDate: text(value.effective_sale_date),
    customer: entity(value.customer),
    branch: entity(value.branch),
    createdBy: entity(value.created_by),
    status: text(value.status).toLowerCase() || 'draft',
    totalAmount: number(value.total_amount),
    currencyCode: text(value.currency_code).toUpperCase() || 'EGP',
    updatedAt: text(value.updated_at),
    productSummary: text(value.product_summary),
    lineCount: Math.max(Math.trunc(number(value.line_count)), 0),
    payment: {
      status: text(value.payment?.status).toLowerCase() || 'unpaid',
      settledAmount: number(value.payment?.settled_amount),
      outstandingAmount: number(value.payment?.outstanding_amount),
    },
    fulfillment: {
      status: text(value.fulfillment?.status).toLowerCase() || 'unreserved',
      requiredQuantity: number(value.fulfillment?.required_quantity),
      deliveredQuantity: number(value.fulfillment?.delivered_quantity),
      remainingQuantity: number(value.fulfillment?.remaining_quantity),
    },
  };
}

function sales(value) {
  return Array.isArray(value) ? value.map(overviewSale).filter((sale) => sale.id) : [];
}

export function normalizeSalesOverview(value = {}) {
  const periodCode = text(value.period?.code).toLowerCase();
  return {
    period: {
      code: PERIOD_CODES.has(periodCode) ? periodCode : 'last_7_days',
      dateFrom: text(value.period?.date_from),
      dateTo: text(value.period?.date_to),
    },
    scope: {
      selectedBranchId: text(value.scope?.selected_branch_id) || null,
      defaultBranchId: text(value.scope?.default_branch_id) || null,
      branches: Array.isArray(value.scope?.branches)
        ? value.scope.branches.map(entity).filter((branch) => branch.id)
        : [],
    },
    kpis: {
      confirmedSalesCount: Math.max(Math.trunc(number(value.kpis?.confirmed_sales_count)), 0),
      confirmedSalesValueByCurrency: Array.isArray(value.kpis?.confirmed_sales_value_by_currency)
        ? value.kpis.confirmed_sales_value_by_currency.map(currencyAmount)
        : [],
      outstandingByCurrency: Array.isArray(value.kpis?.outstanding_by_currency)
        ? value.kpis.outstanding_by_currency.map(currencyAmount)
        : [],
      pendingDeliveryCount: Math.max(Math.trunc(number(value.kpis?.pending_delivery_count)), 0),
    },
    draftsPreview: sales(value.drafts_preview),
    outstandingPreview: sales(value.outstanding_preview),
    pendingDeliveryPreview: sales(value.pending_delivery_preview),
    recentSales: sales(value.recent_sales),
    salespersonBreakdown: Array.isArray(value.salesperson_breakdown)
      ? value.salesperson_breakdown.map((entry) => ({
        salesperson: entity(entry?.salesperson),
        confirmedSalesCount: Math.max(Math.trunc(number(entry?.confirmed_sales_count)), 0),
        salesValueByCurrency: Array.isArray(entry?.sales_value_by_currency)
          ? entry.sales_value_by_currency.map(currencyAmount)
          : [],
      })).filter((entry) => entry.salesperson.id)
      : [],
  };
}

export const SALES_OVERVIEW_PERIODS = Object.freeze([
  { value: 'today', label: 'اليوم' },
  { value: 'last_7_days', label: 'آخر 7 أيام' },
  { value: 'this_month', label: 'هذا الشهر' },
]);
