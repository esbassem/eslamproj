const loaderPromises = new Map();

function cached(key, importer) {
  return () => {
    if (!loaderPromises.has(key)) {
      loaderPromises.set(
        key,
        importer().catch((error) => {
          loaderPromises.delete(key);
          throw error;
        }),
      );
    }
    return loaderPromises.get(key);
  };
}

export const routeLoaders = {
  publicLayout: cached('publicLayout', () => import('@/app/layouts/PublicLayout')),
  authLayout: cached('authLayout', () => import('@/app/layouts/AuthLayout')),
  appLayout: cached('appLayout', () => import('@/app/layouts/AppLayout')),
  landing: cached('landing', () => import('@/pages/public/LandingPage')),
  signup: cached('signup', () => import('@/features/auth/pages/SignupPage')),
  forgotPassword: cached('forgotPassword', () => import('@/features/auth/pages/ForgotPasswordPage')),
  notFound: cached('notFound', () => import('@/pages/system/NotFoundPage')),
  onboarding: cached('onboarding', () => import('@/features/workspace/pages/OnboardingPage')),
  dashboard: cached('dashboard', () => import('@/features/dashboard/pages/DashboardPage')),
  partners: cached('partners', () => import('@/features/partners/pages/PartnersPage')),
  products: cached('products', () => import('@/features/products/pages/ProductsPage')),
  inventoryOverview: cached('inventoryOverview', () => import('@/features/products/pages/InventoryOverviewPage')),
  inventoryLocations: cached('inventoryLocations', () => import('@/features/products/pages/InventoryLocationsPage')),
  inventoryCounts: cached('inventoryCounts', () => import('@/features/products/pages/InventoryCountsPage')),
  productAttributes: cached('productAttributes', () => import('@/features/products/pages/ProductAttributesPage')),
  productTrackingIdentifiers: cached('productTrackingIdentifiers', () => import('@/features/products/pages/ProductTrackingIdentifiersPage')),
  inventoryStock: cached('inventoryStock', () => import('@/features/inventory/pages/StockListPage')),
  inventorySerials: cached('inventorySerials', () => import('@/features/inventory/pages/SerialUnitsPage')),
  inventoryMoves: cached('inventoryMoves', () => import('@/features/inventory/pages/StockMovesPage')),
  pos: cached('pos', () => import('@/features/pos/pages/PosPage')),
  invoices: cached('invoices', () => import('@/features/invoices/pages/InvoicesPage')),
  payments: cached('payments', () => import('@/features/payments/pages/PaymentsPage')),
  contracts: cached('contracts', () => import('@/features/contracts/pages/ContractsPage')),
  settings: cached('settings', () => import('@/features/settings/pages/SettingsPage')),
  cashLocationsSettings: cached('cashLocationsSettings', () => import('@/features/settings/pages/CashLocationsSettingsPage')),
  team: cached('team', () => import('@/features/team/pages/TeamManagementPage')),
  contacts: cached('contacts', () => import('@/features/contacts/pages/ContactsPage')),
  customers: cached('customers', () => import('@/features/contacts/pages/CustomersPage')),
  suppliers: cached('suppliers', () => import('@/features/contacts/pages/SuppliersPage')),
  paymentEntities: cached('paymentEntities', () => import('@/features/contacts/pages/PaymentEntitiesPage')),
  photosHome: cached('photosHome', () => import('@/features/photos/pages/PhotosHomePage')),
  photosAll: cached('photosAll', () => import('@/features/photos/pages/PhotosAllPage')),
  photosUnlinked: cached('photosUnlinked', () => import('@/features/photos/pages/PhotosUnlinkedPage')),
  photosSettings: cached('photosSettings', () => import('@/features/photos/pages/PhotosSettingsPage')),
  oldCashbox: cached('oldCashbox', () => import('@/features/old-cashbox/pages/OldCashboxPage')),
  showroomLayout: cached('showroomLayout', () => import('@/features/showroom/layouts/ShowroomWorkspaceLayout')),
  showroomCockpit: cached('showroomCockpit', () => import('@/features/showroom/pages/ShowroomCockpitPage')),
  showroomSell: cached('showroomSell', () => import('@/features/showroom/pages/ShowroomSellPage')),
  showroomDetails: cached('showroomDetails', () => import('@/features/showroom/pages/ShowroomSaleDetailsPage')),
  customerCareLayout: cached('customerCareLayout', () => import('@/features/moto-customer-care/layouts/MotoCustomerCareWorkspaceLayout')),
  customerCareList: cached('customerCareList', () => import('@/features/moto-customer-care/pages/MotoCustomerCareSalesFollowUpListPage')),
  customerCareDetails: cached('customerCareDetails', () => import('@/features/moto-customer-care/pages/MotoCustomerCareSaleFollowUpDetailsPage')),
  paperworkHome: cached('paperworkHome', () => import('@/features/paperwork/pages/PaperworkHomePage')),
  paperworkRequests: cached('paperworkRequests', () => import('@/features/paperwork/pages/PaperworkRequestsPage')),
  paperworkRequestDetails: cached('paperworkRequestDetails', () => import('@/features/paperwork/pages/PaperworkRequestDetailsPage')),
  paperworkProcessors: cached('paperworkProcessors', () => import('@/features/paperwork/pages/PaperworkProcessorsPage')),
  paperworkProcessorDetails: cached('paperworkProcessorDetails', () => import('@/features/paperwork/pages/PaperworkProcessorDetailsPage')),
  paperworkVault: cached('paperworkVault', () => import('@/features/paperwork/pages/PaperworkVaultPage')),
  paperworkDocuments: cached('paperworkDocuments', () => import('@/features/paperwork/pages/PaperworkDocumentsPage')),
  paperworkDocumentDetails: cached('paperworkDocumentDetails', () => import('@/features/paperwork/pages/PaperworkDocumentDetailsPage')),
  receivables: cached('receivables', () => import('@/features/receivables/pages/ReceivablesPage')),
  accountant: cached('accountant', () => import('@/features/accountant/pages/AccountantHomePage')),
  crmLayout: cached('crmLayout', () => import('@/features/crm/layouts/CrmWorkspaceLayout')),
  crmHome: cached('crmHome', () => import('@/features/crm/pages/CrmHomePage')),
  crmPlaceholder: cached('crmPlaceholder', () => import('@/features/crm/pages/CrmPlaceholderPage')),
  crmLeads: cached('crmLeads', () => import('@/features/crm/pages/CrmLeadsPage')),
  crmLeadDetails: cached('crmLeadDetails', () => import('@/features/crm/pages/CrmLeadDetailsPage')),
  crmSettings: cached('crmSettings', () => import('@/features/crm/pages/CrmSettingsPage')),
  crmFollowups: cached('crmFollowups', () => import('@/features/crm/pages/CrmFollowupsPage')),
  crmInstallments: cached('crmInstallments', () => import('@/features/crm/pages/CrmInstallmentsPage')),
  crmInstallmentDetails: cached('crmInstallmentDetails', () => import('@/features/crm/pages/CrmInstallmentDetailsPage')),
};

export const appRouteRegistry = [
  { appCode: 'dashboard', path: '/admin', loader: routeLoaders.dashboard },
  {
    appCode: 'showroom_point',
    path: '/app/showroom_point',
    loader: routeLoaders.showroomSell,
  },
  {
    appCode: 'accountant_app',
    path: '/apps/accountant',
    loader: routeLoaders.accountant,
  },
  {
    appCode: 'moto_customer_care',
    path: '/app/moto-customer-care/sales',
    loader: routeLoaders.customerCareList,
  },
  {
    appCode: 'paperwork',
    path: '/apps/paperwork',
    loader: routeLoaders.paperworkHome,
  },
  {
    appCode: 'receivables',
    path: '/app/receivables',
    loader: routeLoaders.receivables,
  },
  { appCode: 'crm', path: '/apps/crm', loader: routeLoaders.crmLeads },
  { appCode: 'photos', path: '/photos', loader: routeLoaders.photosHome },
  { appCode: 'settings', path: '/app/settings', loader: routeLoaders.settings },
  { appCode: 'partners', path: '/app/partners', loader: routeLoaders.partners },
  {
    appCode: 'products',
    path: '/apps/inventory',
    loader: routeLoaders.inventoryOverview,
  },
  { appCode: 'pos', path: '/app/pos', loader: routeLoaders.pos },
  { appCode: 'sales', path: '/app/sales', loader: routeLoaders.invoices },
  {
    appCode: 'accounting',
    path: '/apps/accounting',
    loader: routeLoaders.payments,
  },
  {
    appCode: 'contracts',
    path: '/app/contracts',
    loader: routeLoaders.contracts,
  },
  { appCode: 'team', path: '/app/team', loader: routeLoaders.settings },
  {
    appCode: 'old_cashbox',
    path: '/apps/old-cashbox',
    loader: routeLoaders.oldCashbox,
  },
].map((entry) => ({ ...entry, preload: entry.loader }));

export function getAppRoute(appCode) {
  const normalized = String(appCode || '').replaceAll('-', '_');
  return appRouteRegistry.find((entry) => entry.appCode === normalized) ?? null;
}

export function preloadApp(appCode) {
  return getAppRoute(appCode)?.preload();
}
