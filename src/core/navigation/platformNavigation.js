import { ROUTES } from '../config/routes.config.js';

const APP_NAVIGATION = Object.freeze([
  Object.freeze({
    code: 'paperwork',
    label: 'إدارة أوراق الملكية',
    to: '/apps/paperwork',
    includePlatformHome: false,
    sections: Object.freeze([
      {
        label: 'طلبات الأوراق',
        to: '/apps/paperwork',
        primaryTo: '/apps/paperwork',
        matches: [
          { to: '/apps/paperwork', end: true },
          { to: '/apps/paperwork/requests' },
        ],
      },
      {
        label: 'عند الجهات',
        to: '/apps/paperwork/processors',
        primaryTo: '/apps/paperwork',
        parent: { label: 'طلبات الأوراق', to: '/apps/paperwork' },
      },
      {
        label: 'المستندات',
        to: '/apps/paperwork/documents',
        primaryTo: '/apps/paperwork/documents',
        matches: [
          { to: '/apps/paperwork/documents' },
          { to: '/apps/paperwork/vault' },
        ],
      },
    ]),
  }),
  Object.freeze({
    code: 'products',
    label: 'المخزون',
    to: '/apps/inventory',
    sections: Object.freeze([
      { label: 'المنتجات', to: '/apps/inventory/products' },
      { label: 'القطع الفريدة', to: '/apps/inventory/unique-units' },
      { label: 'أرصدة المخزون', to: '/apps/inventory/stock' },
      { label: 'حركات المخزون', to: '/apps/inventory/operations/moves' },
      { label: 'المواقع', to: '/apps/inventory/operations/locations' },
      { label: 'الجرد', to: '/apps/inventory/operations/counts' },
    ]),
  }),
  Object.freeze({
    code: 'crm',
    label: 'متابعة العملاء المحتملين',
    to: '/apps/crm',
    sections: Object.freeze([
      { label: 'العملاء المحتملون', to: '/apps/crm/leads' },
      { label: 'متابعات اليوم', to: '/apps/crm/followups' },
      { label: 'طلبات التقسيط', to: '/apps/crm/installments' },
      { label: 'الإعدادات', to: '/apps/crm/settings' },
    ]),
  }),
]);

function normalizePath(pathname = '') {
  const normalized = String(pathname).split('#')[0].split('?')[0].replace(/\/+$/, '');
  return normalized || '/';
}

function matchesPath(pathname, route) {
  return pathname === route || pathname.startsWith(`${route}/`);
}

function matchesSection(pathname, section) {
  if (!section.matches) return matchesPath(pathname, section.to);
  return section.matches.some((match) => (
    match.end ? pathname === match.to : matchesPath(pathname, match.to)
  ));
}

export function getPlatformRouteMetadata(pathname) {
  const currentPath = normalizePath(pathname);
  const app = APP_NAVIGATION
    .filter((item) => matchesPath(currentPath, item.to))
    .sort((left, right) => right.to.length - left.to.length)[0];
  if (!app) return null;

  const section = app.sections
    .filter((item) => matchesSection(currentPath, item))
    .sort((left, right) => right.to.length - left.to.length)[0] ?? null;
  return { app, section, currentPath };
}

export function getCanonicalBreadcrumbs(pathname, { currentLabel } = {}) {
  const metadata = getPlatformRouteMetadata(pathname);
  if (!metadata) return [];

  const items = [];
  if (metadata.app.includePlatformHome !== false) items.push({ label: 'الرئيسية', to: ROUTES.app });
  items.push({ label: metadata.app.label, to: metadata.app.to });
  if (metadata.section?.parent) items.push(metadata.section.parent);
  if (metadata.section) items.push({ label: metadata.section.label, to: metadata.section.to });

  const canonicalRoute = metadata.section?.to ?? metadata.app.to;
  if (currentLabel && metadata.currentPath !== canonicalRoute) {
    items.push({ label: currentLabel });
  }
  return items;
}

export const APP_MENU_CONVENTION = Object.freeze({
  root: '<app>.root = container',
  overview: '<app>.overview = optional clickable application home',
  section: '<app>.<section> = primary application section',
  details: 'Entity details and task flows are routes, not primary menu rows',
});
