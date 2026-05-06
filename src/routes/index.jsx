import { Navigate } from 'react-router-dom';
import { AppLayout } from '@/app/layouts/AppLayout';
import { ROUTES } from '@/core/config/routes.config';
import { Dashboard } from '@/pages/admin/Dashboard';

export const modeRoutes = [
  {
    path: ROUTES.admin,
    element: <AppLayout />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'dashboard', element: <Navigate to={ROUTES.admin} replace /> },
      { path: 'partners', element: <Navigate to={ROUTES.partners} replace /> },
      { path: 'products', element: <Navigate to={ROUTES.products} replace /> },
      { path: 'inventory', element: <Navigate to={ROUTES.inventory} replace /> },
      { path: 'pos', element: <Navigate to={ROUTES.adminPos} replace /> },
      { path: 'invoices', element: <Navigate to={ROUTES.invoices} replace /> },
      { path: 'payments', element: <Navigate to={ROUTES.payments} replace /> },
      { path: 'contracts', element: <Navigate to={ROUTES.contracts} replace /> },
      { path: 'settings', element: <Navigate to={ROUTES.settings} replace /> },
      { path: 'settings/finance/payments', element: <Navigate to={ROUTES.paymentSettings} replace /> },
      { path: 'team', element: <Navigate to={ROUTES.team} replace /> },
    ],
  },
];
