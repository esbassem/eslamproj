import { lazy } from 'react';
import { ROUTES } from '@/core/config/routes.config';
import { routeLoaders } from '@/app/router/appRouteRegistry';

function lazyNamed(loader, exportName) {
  const Component = lazy(() => loader().then((module) => ({ default: module[exportName] })));
  Component.preload = loader;
  return Component;
}

const {
  publicLayout: loadPublicLayout,
  authLayout: loadAuthLayout,
  appLayout: loadAppLayout,
  landing: loadLandingPage,
  signup: loadSignupPage,
  forgotPassword: loadForgotPasswordPage,
  notFound: loadNotFoundPage,
  onboarding: loadOnboardingPage,
  dashboard: loadDashboardPage,
  partners: loadPartnersPage,
  products: loadProductsPage,
  inventoryOverview: loadInventoryOverviewPage,
  pos: loadPosPage,
  invoices: loadInvoicesPage,
  salesOverview: loadSalesOverviewPage,
  salesBranch: loadSalesBranchPage,
  saleCreate: loadSaleCreatePage,
  saleDetails: loadSaleDetailsPage,
  payments: loadPaymentsPage,
  contracts: loadContractsPage,
  settings: loadSettingsPage,
  team: loadTeamManagementPage,
  customerCareLayout: loadMotoCustomerCareWorkspaceLayout,
  customerCareList: loadMotoCustomerCareSalesFollowUpListPage,
  customerCareDetails: loadMotoCustomerCareSaleFollowUpDetailsPage,
  receivables: loadReceivablesPage,
  paperworkHome: loadPaperworkHomePage,
  paperworkRequests: loadPaperworkRequestsPage,
  paperworkRequestDetails: loadPaperworkRequestDetailsPage,
  paperworkProcessors: loadPaperworkProcessorsPage,
  paperworkProcessorDetails: loadPaperworkProcessorDetailsPage,
  paperworkVault: loadPaperworkVaultPage,
  paperworkDocuments: loadPaperworkDocumentsPage,
  paperworkDocumentDetails: loadPaperworkDocumentDetailsPage,
  accountant: loadAccountantHomePage,
} = routeLoaders;

export const PublicLayout = lazyNamed(loadPublicLayout, 'PublicLayout');
export const AuthLayout = lazyNamed(loadAuthLayout, 'AuthLayout');
export const AppLayout = lazyNamed(loadAppLayout, 'AppLayout');
export const LandingPage = lazyNamed(loadLandingPage, 'LandingPage');
export const SignupPage = lazyNamed(loadSignupPage, 'SignupPage');
export const ForgotPasswordPage = lazyNamed(loadForgotPasswordPage, 'ForgotPasswordPage');
export const NotFoundPage = lazyNamed(loadNotFoundPage, 'NotFoundPage');
export const OnboardingPage = lazyNamed(loadOnboardingPage, 'OnboardingPage');
export const DashboardPage = lazyNamed(loadDashboardPage, 'DashboardPage');
export const PartnersPage = lazyNamed(loadPartnersPage, 'PartnersPage');
export const ProductsPage = lazyNamed(loadProductsPage, 'ProductsPage');
export const PosPage = lazyNamed(loadPosPage, 'PosPage');
export const InvoicesPage = lazyNamed(loadInvoicesPage, 'InvoicesPage');
export const SalesOverviewPage = lazyNamed(loadSalesOverviewPage, 'SalesOverviewPage');
export const SalesBranchPage = lazyNamed(loadSalesBranchPage, 'SalesBranchPage');
export const SaleCreatePage = lazyNamed(loadSaleCreatePage, 'SaleCreatePage');
export const SaleDetailsPage = lazyNamed(loadSaleDetailsPage, 'SaleDetailsPage');
export const PaymentsPage = lazyNamed(loadPaymentsPage, 'PaymentsPage');
export const ContractsPage = lazyNamed(loadContractsPage, 'ContractsPage');
export const SettingsPage = lazyNamed(loadSettingsPage, 'SettingsPage');
export const TeamManagementPage = lazyNamed(loadTeamManagementPage, 'TeamManagementPage');
export const MotoCustomerCareWorkspaceLayout = lazyNamed(loadMotoCustomerCareWorkspaceLayout, 'MotoCustomerCareWorkspaceLayout');
export const MotoCustomerCareSalesFollowUpListPage = lazyNamed(loadMotoCustomerCareSalesFollowUpListPage, 'MotoCustomerCareSalesFollowUpListPage');
export const MotoCustomerCareSaleFollowUpDetailsPage = lazyNamed(loadMotoCustomerCareSaleFollowUpDetailsPage, 'MotoCustomerCareSaleFollowUpDetailsPage');
export const PaperworkHomePage = lazyNamed(loadPaperworkHomePage, 'PaperworkHomePage');
export const PaperworkRequestsPage = lazyNamed(loadPaperworkRequestsPage, 'PaperworkRequestsPage');
export const PaperworkRequestDetailsPage = lazyNamed(loadPaperworkRequestDetailsPage, 'PaperworkRequestDetailsPage');
export const PaperworkProcessorsPage = lazyNamed(loadPaperworkProcessorsPage, 'PaperworkProcessorsPage');
export const PaperworkProcessorDetailsPage = lazyNamed(loadPaperworkProcessorDetailsPage, 'PaperworkProcessorDetailsPage');
export const PaperworkVaultPage = lazyNamed(loadPaperworkVaultPage, 'PaperworkVaultPage');
export const PaperworkDocumentsPage = lazyNamed(loadPaperworkDocumentsPage, 'PaperworkDocumentsPage');
export const PaperworkDocumentDetailsPage = lazyNamed(loadPaperworkDocumentDetailsPage, 'PaperworkDocumentDetailsPage');
export const ReceivablesPage = lazyNamed(loadReceivablesPage, 'ReceivablesPage');
export const AccountantHomePage = lazyNamed(loadAccountantHomePage, 'AccountantHomePage');

const protectedRoutePreloaders = {
  [ROUTES.dashboard]: loadDashboardPage,
  [ROUTES.partners]: loadPartnersPage,
  [ROUTES.products]: loadProductsPage,
  [ROUTES.inventory]: loadInventoryOverviewPage,
  [ROUTES.adminPos]: loadPosPage,
  [ROUTES.sales]: loadSalesOverviewPage,
  [ROUTES.salesNew]: loadSaleCreatePage,
  [ROUTES.invoices]: loadInvoicesPage,
  [ROUTES.payments]: loadPaymentsPage,
  [ROUTES.contracts]: loadContractsPage,
  [ROUTES.settings]: loadSettingsPage,
  [ROUTES.settingsTeam]: loadSettingsPage,
};

export function preloadProtectedRoute(pathname) {
  return protectedRoutePreloaders[pathname]?.();
}
