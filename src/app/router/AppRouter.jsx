import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { AppAccessRoute, PublicOnlyRoute, ProtectedRoute, SessionGate } from '@/app/router/RouteGuards';
import { modeRoutes } from '@/routes';
import { CheckingSessionPage } from '@/pages/system/CheckingSessionPage';
import { RouteLoadingFallback } from '@/pages/system/RouteLoadingFallback';
import { DynamicAppPage } from '@/app/router/DynamicAppPage';
import {
  AppLayout,
  AccountantHomePage,
  AuthLayout,
  ForgotPasswordPage,
  LandingPage,
  MotoCustomerCareSaleFollowUpDetailsPage,
  MotoCustomerCareHomePage,
  MotoCustomerCareSalesFollowUpListPage,
  MotoCustomerCareWorkspaceLayout,
  NotFoundPage,
  OnboardingPage,
  PosPage,
  PublicLayout,
  ReceivablesPage,
  ShowroomSaleDetailsPage,
  ShowroomSellPage,
  ShowroomWorkspaceLayout,
  SignupPage,
} from '@/app/router/lazyRoutes';

function renderModeRoute(route) {
  return (
    <Route key={route.path} path={route.path} element={route.element}>
      {route.children?.map((child) => (
        <Route
          key={child.index ? `${route.path}-index` : `${route.path}-${child.path}`}
          index={child.index}
          path={child.path}
          element={child.element}
        />
      ))}
    </Route>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          <Route path={ROUTES.checkingSession} element={<CheckingSessionPage />} />

          <Route element={<SessionGate />}>
            <Route element={<PublicOnlyRoute />}>
              <Route element={<PublicLayout />}>
                <Route path={ROUTES.landing} element={<LandingPage />} />
                <Route path={ROUTES.login} element={<Navigate to={ROUTES.landing} replace />} />
              </Route>
              <Route element={<AuthLayout />}>
                <Route path={ROUTES.signup} element={<SignupPage />} />
                <Route path={ROUTES.forgotPassword} element={<ForgotPasswordPage />} />
              </Route>
            </Route>

            <Route element={<ProtectedRoute />}>
              <Route path={ROUTES.onboarding} element={<OnboardingPage />} />
              {modeRoutes.map(renderModeRoute)}
              <Route path="/products/tracking-identifiers" element={<Navigate to="/app/products/tracking-identifiers" replace />} />
              <Route path="/app" element={<Navigate to={ROUTES.admin} replace />} />
              <Route path="/app/dashboard" element={<Navigate to={ROUTES.admin} replace />} />
              <Route path="/app/team" element={<Navigate to={ROUTES.settingsTeam} replace />} />
              <Route path="/app/showroom_point" element={<AppAccessRoute appCode="showroom_point"><ShowroomWorkspaceLayout /></AppAccessRoute>}>
                <Route index element={<ShowroomSellPage />} />
                <Route path="new" element={<ShowroomSellPage />} />
                <Route path="customers" element={<ShowroomSellPage />} />
                <Route path="settings" element={<Navigate to="/app/showroom_point" replace />} />
                <Route path="sale/:saleId" element={<ShowroomSaleDetailsPage />} />
              </Route>
              <Route path="/app/moto_customer_care" element={<AppAccessRoute appCode="moto_customer_care"><Navigate to="/app/moto-customer-care/sales" replace /></AppAccessRoute>} />
              <Route path="/app/moto-customer-care" element={<AppAccessRoute appCode="moto_customer_care"><Navigate to="/app/moto-customer-care/sales" replace /></AppAccessRoute>} />
              <Route path="/app/moto_customer_care/dashboard" element={<AppAccessRoute appCode="moto_customer_care"><Navigate to="/app/moto-customer-care/sales" replace /></AppAccessRoute>} />
              <Route path="/app/moto-customer-care/dashboard" element={<AppAccessRoute appCode="moto_customer_care"><Navigate to="/app/moto-customer-care/sales" replace /></AppAccessRoute>} />
              <Route path="/app/moto_customer_care/sales" element={<AppAccessRoute appCode="moto_customer_care"><Navigate to="/app/moto-customer-care/sales" replace /></AppAccessRoute>} />
              <Route path="/app/moto_customer_care/sales/:saleId" element={<AppAccessRoute appCode="moto_customer_care"><MotoCustomerCareWorkspaceLayout /></AppAccessRoute>}>
                <Route index element={<MotoCustomerCareSaleFollowUpDetailsPage />} />
              </Route>
              <Route path="/app/moto-customer-care/sales" element={<AppAccessRoute appCode="moto_customer_care"><MotoCustomerCareWorkspaceLayout /></AppAccessRoute>}>
                <Route index element={<MotoCustomerCareHomePage />} />
                <Route path=":saleId" element={<MotoCustomerCareSaleFollowUpDetailsPage />} />
              </Route>
              <Route path="/app/moto-customer-care/legacy" element={<AppAccessRoute appCode="moto_customer_care"><MotoCustomerCareWorkspaceLayout /></AppAccessRoute>}>
                <Route index element={<MotoCustomerCareSalesFollowUpListPage />} />
                <Route path=":saleId" element={<MotoCustomerCareSaleFollowUpDetailsPage />} />
              </Route>
              <Route path="/photos" element={<AppLayout />}>
                <Route index element={<DynamicAppPage />} />
                <Route path="*" element={<DynamicAppPage />} />
              </Route>
              <Route path="/apps/moto-customer-care/sales" element={<AppAccessRoute appCode="moto_customer_care"><MotoCustomerCareWorkspaceLayout /></AppAccessRoute>}>
                <Route index element={<MotoCustomerCareHomePage />} />
                <Route path=":saleId" element={<MotoCustomerCareSaleFollowUpDetailsPage />} />
              </Route>
              <Route path="/app/receivables" element={<AppAccessRoute appCode="receivables"><MotoCustomerCareWorkspaceLayout /></AppAccessRoute>}>
                <Route index element={<ReceivablesPage />} />
                <Route path="installments" element={<ReceivablesPage />} />
              </Route>
              <Route path="/apps/receivables" element={<Navigate to="/app/receivables" replace />} />
              <Route path="/apps/receivables/installments" element={<Navigate to="/app/receivables/installments" replace />} />
              <Route path="/apps/accountant" element={<AppAccessRoute appCode="accountant_app"><MotoCustomerCareWorkspaceLayout /></AppAccessRoute>}>
                <Route index element={<AccountantHomePage />} />
                <Route path="payments" element={<AccountantHomePage />} />
              </Route>
              <Route path="/app/accounting" element={<Navigate to="/apps/accounting" replace />} />
              <Route path="/app/accounting/payments" element={<Navigate to="/apps/accounting/payments" replace />} />
              <Route path="/app/accounting/journals" element={<Navigate to="/apps/accounting/journals" replace />} />
              <Route path="/apps/accounting" element={<AppLayout />}>
                <Route index element={<DynamicAppPage />} />
                <Route path="*" element={<DynamicAppPage />} />
              </Route>
              <Route path="/apps/:appCode" element={<AppLayout />}>
                <Route index element={<DynamicAppPage />} />
                <Route path="*" element={<DynamicAppPage />} />
              </Route>
              <Route path="/app/pos/:posId/session/:sessionId/sell" element={<AppAccessRoute appCode="pos"><PosPage /></AppAccessRoute>} />
              <Route path="/app/:appCode" element={<AppLayout />}>
                <Route index element={<DynamicAppPage />} />
                <Route path="*" element={<DynamicAppPage />} />
              </Route>
            </Route>
          </Route>

          <Route path="/app/" element={<Navigate to={ROUTES.admin} replace />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
