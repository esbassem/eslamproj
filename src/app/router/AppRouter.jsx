import { Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { PublicOnlyRoute, ProtectedRoute, SessionGate } from '@/app/router/RouteGuards';
import { modeRoutes } from '@/routes';
import { CheckingSessionPage } from '@/pages/system/CheckingSessionPage';
import { RouteLoadingFallback } from '@/pages/system/RouteLoadingFallback';
import { DynamicAppPage } from '@/app/router/DynamicAppPage';
import {
  AppLayout,
  AuthLayout,
  ForgotPasswordPage,
  LandingPage,
  NotFoundPage,
  OnboardingPage,
  PosPage,
  PublicLayout,
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
              <Route path="/app/showroom_point" element={<ShowroomWorkspaceLayout />}>
                <Route index element={<ShowroomSellPage />} />
                <Route path="new" element={<ShowroomSellPage />} />
                <Route path="customers" element={<ShowroomSellPage />} />
                <Route path="settings" element={<ShowroomSellPage />} />
                <Route path="sale/:saleId" element={<ShowroomSaleDetailsPage />} />
              </Route>
              <Route path="/app/pos/:posId/session/:sessionId/sell" element={<PosPage />} />
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
