import { SALES_ROUTES } from '../routes/salesRoutes.js';

export const SALES_APP_REGISTRATION = Object.freeze({
  code: 'sales',
  name: 'المبيعات',
  href: SALES_ROUTES.overview,
  navigation: Object.freeze({ mode: 'none', items: Object.freeze([]) }),
  shell: Object.freeze({
    contentWidth: 'wide',
    variant: 'standard',
    topBar: true,
    breadcrumbs: true,
  }),
});

export const SALES_ROUTE_METADATA = Object.freeze([
  Object.freeze({ id: 'sales.overview', path: SALES_ROUTES.overview, appCode: 'sales', sectionId: 'overview', title: 'نظرة عامة' }),
  Object.freeze({ id: 'sales.list-redirect', path: SALES_ROUTES.legacyList, appCode: 'sales', sectionId: 'overview', title: 'المبيعات' }),
  Object.freeze({ id: 'sales.create', path: SALES_ROUTES.create, appCode: 'sales', sectionId: 'create', title: 'بيع جديد' }),
  Object.freeze({
    id: 'sales.branch',
    path: `${SALES_ROUTES.overview}/branches/:branchId`,
    appCode: 'sales',
    sectionId: 'branch',
    title: 'مبيعات الفرع',
    section: Object.freeze({ label: 'المبيعات', to: SALES_ROUTES.overview }),
  }),
  Object.freeze({ id: 'sales.invoices', path: SALES_ROUTES.legacyInvoices, appCode: 'sales', sectionId: 'invoices', title: 'الفواتير' }),
  Object.freeze({ id: 'sales.contracts-redirect', path: SALES_ROUTES.legacyContracts, appCode: 'sales', sectionId: 'contracts', title: 'العقود' }),
  Object.freeze({
    id: 'sales.details',
    path: `${SALES_ROUTES.overview}/:saleId`,
    appCode: 'sales',
    sectionId: 'details',
    title: 'تفاصيل البيع',
    section: Object.freeze({ label: 'المبيعات', to: SALES_ROUTES.overview }),
  }),
]);
