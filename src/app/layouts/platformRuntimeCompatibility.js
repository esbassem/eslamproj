import { getPlatformRouteMetadata } from '../../core/navigation/platformNavigation.js';

const APP_POLICIES = Object.freeze({
  dashboard: Object.freeze({ navigationMode: 'none', contentWidth: 'fullBleed', variant: 'standard', topBarDivider: false, appIdentity: false, breadcrumbs: false }),
  paperwork: Object.freeze({ navigationMode: 'sidebar', contentWidth: 'wide', variant: 'standard', breadcrumbs: false }),
  old_cashbox: Object.freeze({ navigationMode: 'none', contentWidth: 'fullBleed', variant: 'fullBleed', topBar: false, breadcrumbs: false }),
  moto_customer_care: Object.freeze({ navigationMode: 'none', contentWidth: 'fullBleed', variant: 'fullBleed', topBar: false, breadcrumbs: false }),
  receivables: Object.freeze({ navigationMode: 'none', contentWidth: 'fullBleed', variant: 'fullBleed', topBar: false, breadcrumbs: false }),
  accountant_app: Object.freeze({ navigationMode: 'none', contentWidth: 'fullBleed', variant: 'fullBleed', topBar: false, breadcrumbs: false }),
});

const DEFAULT_APP_POLICY = Object.freeze({
  navigationMode: 'sidebar',
  contentWidth: 'wide',
  variant: 'standard',
  topBar: true,
  topBarDivider: true,
  appIdentity: true,
  breadcrumbs: true,
});

export function resolveLegacyRuntimePolicy(appCode, pathname = '') {
  if (/^\/app\/pos\/[^/]+\/session\/[^/]+\/sell\/?$/.test(pathname)) {
    return { ...DEFAULT_APP_POLICY, navigationMode: 'none', contentWidth: 'fullBleed', variant: 'fullBleed', topBar: false, breadcrumbs: false };
  }
  return { ...DEFAULT_APP_POLICY, ...(APP_POLICIES[appCode] ?? {}) };
}

export function adaptLegacyRouteMetadata(pathname, appCode, policy) {
  const legacyMetadata = getPlatformRouteMetadata(pathname);
  const section = legacyMetadata?.section
    ? { label: legacyMetadata.section.label, to: legacyMetadata.section.to }
    : null;
  return {
    id: `legacy-runtime:${pathname || '/'}`,
    path: pathname || '/',
    appCode,
    appLabel: legacyMetadata?.app.label,
    appTo: legacyMetadata?.app.to,
    section,
    title: section?.label,
    shell: {
      navigation: policy.navigationMode,
      contentWidth: policy.contentWidth,
      variant: policy.variant,
      topBar: policy.topBar,
      topBarDivider: policy.topBarDivider,
      appIdentity: policy.appIdentity,
      breadcrumbs: policy.breadcrumbs,
    },
  };
}

export function getLegacyVisibleMenus(activeMenus = [], appCode = '') {
  const normalizedCode = String(appCode).replaceAll('-', '_');
  const currentMenus = activeMenus.filter((menu) => !menu?.appCode || String(menu.appCode).replaceAll('-', '_') === normalizedCode);
  return currentMenus.length === 1 && currentMenus[0]?.children?.length
    ? currentMenus[0].children
    : currentMenus;
}

export function canActivateLegacyApp({ appCode, appAvailable, userRole }) {
  return appAvailable || (appCode === 'settings' && userRole === 'owner');
}
