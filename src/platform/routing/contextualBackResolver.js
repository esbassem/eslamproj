import { normalizePathname } from './routeMetadata.js';

export function resolveContextualBack({ breadcrumbs = [], pathname = '/', platformHome = '/app' } = {}) {
  const currentPath = normalizePathname(pathname);
  const homePath = normalizePathname(platformHome);

  const parent = breadcrumbs.findLast((breadcrumb) => {
    if (!breadcrumb?.to) return false;
    const targetPath = normalizePathname(breadcrumb.to);
    return targetPath !== currentPath && targetPath !== homePath;
  });

  return parent ? { label: `العودة إلى ${parent.label}`, to: parent.to } : null;
}
