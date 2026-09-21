import { SALES_ROUTES } from './salesRoutes.js';

const SALES_NAVIGATION = Object.freeze([
  Object.freeze({ code: 'sales.overview', name: 'نظرة عامة', routePath: SALES_ROUTES.overview, icon: 'LayoutDashboard', sequence: 10 }),
  Object.freeze({ code: 'sales.new', name: 'بيع جديد', routePath: SALES_ROUTES.create, icon: 'PlusCircle', sequence: 20 }),
]);

export function createCanonicalSalesNavigationMenus(app = {}) {
  return SALES_NAVIGATION.map((item) => ({
    id: `canonical-${item.code}`,
    appId: app.id ?? null,
    appCode: 'sales',
    parentId: null,
    name: item.name,
    code: item.code,
    href: item.routePath,
    routePath: item.routePath,
    icon: item.icon,
    permissionKey: '',
    sortOrder: item.sequence,
    sequence: item.sequence,
    active: true,
  }));
}

export const CANONICAL_SALES_NAVIGATION = SALES_NAVIGATION;
