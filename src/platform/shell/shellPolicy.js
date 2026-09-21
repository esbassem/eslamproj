import { CONTENT_WIDTHS, SHELL_VARIANTS } from '../navigation/navigationRegistry.js';
import { resolveNavigationMode } from '../navigation/navigationResolver.js';

export const DEFAULT_SHELL_POLICY = Object.freeze({
  navigation: 'none',
  contentWidth: 'standard',
  variant: 'standard',
  topBar: true,
  topBarDivider: true,
  appIdentity: true,
  breadcrumbs: true,
});

export function resolveShellPolicy({ appRegistration, routeMetadata } = {}) {
  const contentWidth = routeMetadata?.shell?.contentWidth ?? appRegistration?.shell?.contentWidth ?? DEFAULT_SHELL_POLICY.contentWidth;
  const variant = routeMetadata?.shell?.variant ?? appRegistration?.shell?.variant ?? DEFAULT_SHELL_POLICY.variant;
  const topBar = routeMetadata?.shell?.topBar ?? appRegistration?.shell?.topBar ?? DEFAULT_SHELL_POLICY.topBar;
  const topBarDivider = routeMetadata?.shell?.topBarDivider ?? appRegistration?.shell?.topBarDivider ?? DEFAULT_SHELL_POLICY.topBarDivider;
  const appIdentity = routeMetadata?.shell?.appIdentity ?? appRegistration?.shell?.appIdentity ?? DEFAULT_SHELL_POLICY.appIdentity;
  const breadcrumbs = routeMetadata?.shell?.breadcrumbs ?? appRegistration?.shell?.breadcrumbs ?? DEFAULT_SHELL_POLICY.breadcrumbs;
  return Object.freeze({
    navigation: resolveNavigationMode({ routeMetadata, appRegistration }),
    contentWidth: CONTENT_WIDTHS.includes(contentWidth) ? contentWidth : DEFAULT_SHELL_POLICY.contentWidth,
    variant: SHELL_VARIANTS.includes(variant) ? variant : DEFAULT_SHELL_POLICY.variant,
    topBar: typeof topBar === 'boolean' ? topBar : DEFAULT_SHELL_POLICY.topBar,
    topBarDivider: typeof topBarDivider === 'boolean' ? topBarDivider : DEFAULT_SHELL_POLICY.topBarDivider,
    appIdentity: typeof appIdentity === 'boolean' ? appIdentity : DEFAULT_SHELL_POLICY.appIdentity,
    breadcrumbs: typeof breadcrumbs === 'boolean' ? breadcrumbs : DEFAULT_SHELL_POLICY.breadcrumbs,
  });
}
