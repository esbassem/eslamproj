export const SALES_ROUTES = Object.freeze({
  overview: '/app/sales',
  legacyList: '/app/sales/list',
  create: '/app/sales/new',
  branch: (branchId) => `/app/sales/branches/${encodeURIComponent(String(branchId ?? '').trim())}`,
  details: (saleId) => `/app/sales/${encodeURIComponent(String(saleId ?? '').trim())}`,
  legacyInvoices: '/app/sales/invoices',
  legacyContracts: '/app/sales/contracts',
});
