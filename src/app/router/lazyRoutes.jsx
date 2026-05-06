import { lazy } from 'react';
import { ROUTES } from '@/core/config/routes.config';

function lazyNamed(loader, exportName) {
  const Component = lazy(() => loader().then((module) => ({ default: module[exportName] })));
  Component.preload = loader;
  return Component;
}

const loadPublicLayout = () => import('@/app/layouts/PublicLayout');
const loadAuthLayout = () => import('@/app/layouts/AuthLayout');
const loadAppLayout = () => import('@/app/layouts/AppLayout');
const loadLandingPage = () => import('@/pages/public/LandingPage');
const loadSignupPage = () => import('@/features/auth/pages/SignupPage');
const loadForgotPasswordPage = () => import('@/features/auth/pages/ForgotPasswordPage');
const loadNotFoundPage = () => import('@/pages/system/NotFoundPage');
const loadOnboardingPage = () => import('@/features/workspace/pages/OnboardingPage');
const loadDashboardPage = () => import('@/features/dashboard/pages/DashboardPage');
const loadPartnersPage = () => import('@/features/partners/pages/PartnersPage');
const loadProductsPage = () => import('@/features/products/pages/ProductsPage');
const loadInventoryPage = () => import('@/features/inventory/pages/InventoryDashboard');
const loadPosPage = () => import('@/features/pos/pages/PosPage');
const loadInvoicesPage = () => import('@/features/invoices/pages/InvoicesPage');
const loadPaymentsPage = () => import('@/features/payments/pages/PaymentsPage');
const loadContractsPage = () => import('@/features/contracts/pages/ContractsPage');
const loadSettingsPage = () => import('@/features/settings/pages/SettingsPage');
const loadTeamManagementPage = () => import('@/features/team/pages/TeamManagementPage');
const loadShowroomWorkspaceLayout = () => import('@/features/showroom/layouts/ShowroomWorkspaceLayout');
const loadShowroomCockpitPage = () => import('@/features/showroom/pages/ShowroomCockpitPage');
const loadShowroomSellPage = () => import('@/features/showroom/pages/ShowroomSellPage');
const loadShowroomSaleDetailsPage = () => import('@/features/showroom/pages/ShowroomSaleDetailsPage');

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
  [ROUTES.team]: loadTeamManagementPage,
};

export function preloadProtectedRoute(pathname) {
  return protectedRoutePreloaders[pathname]?.();
}

export function preloadAllProtectedRoutes() {
  Object.values(protectedRoutePreloaders).forEach((preload) => preload());
}
