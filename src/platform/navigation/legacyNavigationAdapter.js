function normalizeLegacyItem(item) {
  if (!item) return null;
  const to = item.to ?? item.href ?? item.routePath;
  if (!to) return null;
  return {
    id: item.id ?? item.code ?? to,
    label: item.label ?? item.name ?? item.title,
    to,
    icon: item.icon,
    active: item.active !== false,
    visible: item.visible !== false,
    permissionKey: item.permissionKey ?? '',
    children: (item.children ?? []).map(normalizeLegacyItem).filter(Boolean),
  };
}

export function adaptLegacyNavigationItems(items = []) {
  return items.map(normalizeLegacyItem).filter(Boolean);
}

export function adaptLegacyInstalledApp(app, options = {}) {
  if (!app?.code) return null;
  return {
    code: app.code,
    name: app.name ?? app.code,
    icon: app.icon,
    color: app.iconColor,
    href: app.href ?? app.routePath,
    navigation: {
      mode: options.navigationMode ?? 'none',
      items: adaptLegacyNavigationItems(options.menus ?? []),
    },
    shell: {
      contentWidth: options.contentWidth ?? 'standard',
      variant: options.variant ?? 'standard',
      topBar: options.topBar ?? true,
      breadcrumbs: options.breadcrumbs ?? true,
    },
  };
}
