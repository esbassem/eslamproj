import { lazy } from 'react';
import { ROUTES } from '@/core/config/routes.config';
import { routeLoaders } from '@/app/router/appRouteRegistry';

function lazyNamed(loader, exportName) {
  const Component = lazy(() => loader().then((module) => ({ default: module[exportName] })));
  Component.preload = loader;
  return Component;
}

const {
  publicLayout: loadPublicLayout, authLayout: loadAuthLayout, appLayout: loadAppLayout,
  landing: loadLandingPage, signup: loadSignupPage, forgotPassword: loadForgotPasswordPage,
  notFound: loadNotFoundPage, onboarding: loadOnboardingPage, dashboard: loadDashboardPage,
  partners: loadPartnersPage, products: loadProductsPage, inventory: loadInventoryPage,
  pos: loadPosPage, invoices: loadInvoicesPage, payments: loadPaymentsPage,
  contracts: loadContractsPage, settings: loadSettingsPage, team: loadTeamManagementPage,
  showroomLayout: loadShowroomWorkspaceLayout, showroomCockpit: loadShowroomCockpitPage,
  showroomSell: loadShowroomSellPage, showroomDetails: loadShowroomSaleDetailsPage,
  customerCareLayout: loadMotoCustomerCareWorkspaceLayout, customerCareList: loadMotoCustomerCareSalesFollowUpListPage,
  customerCareDetails: loadMotoCustomerCareSaleFollowUpDetailsPage, receivables: loadReceivablesPage,
  accountant: loadAccountantHomePage, crmLayout: loadCrmWorkspaceLayout, crmHome: loadCrmHomePage,
  crmPlaceholder: loadCrmPlaceholderPage, crmLeads: loadCrmLeadsPage, crmLeadDetails: loadCrmLeadDetailsPage,
  crmSettings: loadCrmSettingsPage, crmFollowups: loadCrmFollowupsPage,
  crmInstallments: loadCrmInstallmentsPage, crmInstallmentDetails: loadCrmInstallmentDetailsPage,
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
export const InventoryDashboard = lazyNamed(loadInventoryPage, 'InventoryDashboard');
export const PosPage = lazyNamed(loadPosPage, 'PosPage');
export const InvoicesPage = lazyNamed(loadInvoicesPage, 'InvoicesPage');
export const PaymentsPage = lazyNamed(loadPaymentsPage, 'PaymentsPage');
export const ContractsPage = lazyNamed(loadContractsPage, 'ContractsPage');
export const SettingsPage = lazyNamed(loadSettingsPage, 'SettingsPage');
export const TeamManagementPage = lazyNamed(loadTeamManagementPage, 'TeamManagementPage');
export const ShowroomWorkspaceLayout = lazyNamed(loadShowroomWorkspaceLayout, 'ShowroomWorkspaceLayout');
export const ShowroomCockpitPage = lazyNamed(loadShowroomCockpitPage, 'ShowroomCockpitPage');
export const ShowroomSellPage = lazyNamed(loadShowroomSellPage, 'ShowroomSellPage');
export const ShowroomSaleDetailsPage = lazyNamed(loadShowroomSaleDetailsPage, 'ShowroomSaleDetailsPage');
export const MotoCustomerCareWorkspaceLayout = lazyNamed(loadMotoCustomerCareWorkspaceLayout, 'MotoCustomerCareWorkspaceLayout');
export const MotoCustomerCareSalesFollowUpListPage = lazyNamed(loadMotoCustomerCareSalesFollowUpListPage, 'MotoCustomerCareSalesFollowUpListPage');
export const MotoCustomerCareSaleFollowUpDetailsPage = lazyNamed(loadMotoCustomerCareSaleFollowUpDetailsPage, 'MotoCustomerCareSaleFollowUpDetailsPage');
export const ReceivablesPage = lazyNamed(loadReceivablesPage, 'ReceivablesPage');
export const AccountantHomePage = lazyNamed(loadAccountantHomePage, 'AccountantHomePage');
export const CrmWorkspaceLayout = lazyNamed(loadCrmWorkspaceLayout, 'CrmWorkspaceLayout');
export const CrmHomePage = lazyNamed(loadCrmHomePage, 'CrmHomePage');
export const CrmPlaceholderPage = lazyNamed(loadCrmPlaceholderPage, 'CrmPlaceholderPage');
export const CrmLeadsPage = lazyNamed(loadCrmLeadsPage, 'CrmLeadsPage');
export const CrmLeadDetailsPage = lazyNamed(loadCrmLeadDetailsPage, 'CrmLeadDetailsPage');
export const CrmSettingsPage = lazyNamed(loadCrmSettingsPage, 'CrmSettingsPage');
export const CrmFollowupsPage = lazyNamed(loadCrmFollowupsPage, 'CrmFollowupsPage');
export const CrmInstallmentsPage = lazyNamed(loadCrmInstallmentsPage, 'CrmInstallmentsPage');
export const CrmInstallmentDetailsPage = lazyNamed(loadCrmInstallmentDetailsPage, 'CrmInstallmentDetailsPage');

const protectedRoutePreloaders = {
  [ROUTES.dashboard]: loadDashboardPage,
  [ROUTES.partners]: loadPartnersPage,
  [ROUTES.products]: loadProductsPage,
  [ROUTES.inventory]: loadInventoryPage,
  [ROUTES.adminPos]: loadPosPage,
  [ROUTES.invoices]: loadInvoicesPage,
  [ROUTES.payments]: loadPaymentsPage,
  [ROUTES.contracts]: loadContractsPage,
  [ROUTES.settings]: loadSettingsPage,
  [ROUTES.settingsTeam]: loadSettingsPage,
};

export function preloadProtectedRoute(pathname) {
  return protectedRoutePreloaders[pathname]?.();
}
