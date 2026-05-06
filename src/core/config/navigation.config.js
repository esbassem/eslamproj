import {
  CreditCard,
  Handshake,
  LayoutDashboard,
  Package,
  Warehouse,
  Settings,
  ShoppingCart,
  Users2,
} from 'lucide-react';
import { ROUTES } from '@/core/config/routes.config';

export const fallbackAppNavigation = [
  { titleKey: 'navigation.dashboard', href: ROUTES.dashboard, icon: LayoutDashboard },
  { titleKey: 'navigation.partners', href: ROUTES.partners, icon: Handshake },
  { titleKey: 'navigation.products', href: ROUTES.products, icon: Package },
  { titleKey: 'navigation.inventory', href: ROUTES.inventory, icon: Warehouse },
  { titleKey: 'navigation.pos', href: ROUTES.adminPos, icon: ShoppingCart },
  { titleKey: 'navigation.payments', href: ROUTES.payments, icon: CreditCard },
  { titleKey: 'navigation.team', href: ROUTES.team, icon: Users2 },
  { titleKey: 'navigation.settings', href: ROUTES.settings, icon: Settings },
];

export const appNavigation = fallbackAppNavigation;

