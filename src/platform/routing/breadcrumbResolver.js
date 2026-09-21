import { normalizePathname } from './routeMetadata.js';

function evaluate(value, context) {
  return typeof value === 'function' ? value(context) : value;
}

function item(label, to) {
  return label ? { label, ...(to ? { to } : {}) } : null;
}

export function resolveBreadcrumbs({
  routeMetadata,
  appRegistration,
  context = {},
  platformHome = { label: 'الرئيسية', to: '/app' },
} = {}) {
  if (!routeMetadata && !appRegistration) return [];
  const breadcrumbs = [];
  if (platformHome !== false) breadcrumbs.push(platformHome);

  const appLabel = evaluate(routeMetadata?.appLabel, context) ?? appRegistration?.name;
  const appTo = evaluate(routeMetadata?.appTo, context) ?? appRegistration?.to ?? appRegistration?.href;
  const appItem = item(appLabel, appTo);
  if (appItem) breadcrumbs.push(appItem);

  const section = routeMetadata?.section;
  const sectionItem = item(evaluate(section?.label, context), evaluate(section?.to, context));
  if (sectionItem && sectionItem.label !== appItem?.label) breadcrumbs.push(sectionItem);

  const isAppLandingRoute = Boolean(routeMetadata?.path && appTo)
    && normalizePathname(routeMetadata.path) === normalizePathname(appTo);
  const hasPublishedCurrentLabel = Boolean(context.currentLabel);
  const currentLabel = context.currentLabel ?? evaluate(routeMetadata?.breadcrumb, context) ?? evaluate(routeMetadata?.title, context);
  const currentItem = item(currentLabel);
  if ((!isAppLandingRoute || hasPublishedCurrentLabel) && currentItem && currentItem.label !== breadcrumbs.at(-1)?.label) breadcrumbs.push(currentItem);
  return breadcrumbs;
}
