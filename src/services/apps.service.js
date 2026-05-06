import { fallbackAppNavigation } from '@/core/config/navigation.config';
import { ROUTES } from '@/core/config/routes.config';
import { requireSupabase } from '@/core/lib/supabase';
import { normalizeModuleRoute } from '@/features/modules/modules.navigation';
import { getAppBasePath, normalizeAppCode } from '@/utils/appResolver';

const APP_COLUMNS = 'id, technical_name, name, description, icon, icon_color, route_path, application, technical, installable, is_removable, active, sequence';
const MENU_COLUMNS = 'id, module_id, parent_id, name, code, route_path, icon, sequence, active';
const PRODUCT_MENU_ROUTES = new Set(['/app/products', '/app/products/attributes', '/app/products/attribute-values', '/app/products/tracking-identifiers']);

const FALLBACK_APP_CODES_BY_HREF = {
  [ROUTES.dashboard]: 'dashboard',
  [ROUTES.partners]: 'partners',
  [ROUTES.products]: 'products',
  [ROUTES.inventory]: 'inventory',
  [ROUTES.adminPos]: 'pos',
  [ROUTES.invoices]: 'sales',
  [ROUTES.payments]: 'accounting',
  [ROUTES.contracts]: 'contracts',
  [ROUTES.settings]: 'settings',
  [ROUTES.team]: 'team',
};

function getFallbackName(item) {
  return item.title ?? item.titleKey?.split('.').pop() ?? '';
}

function toAppCode(module) {
  return normalizeAppCode(module?.technical_name || module?.code || module?.name || module?.id);
}

function toDynamicRoute(routePath, appCode) {
  const normalizedRoute = normalizeModuleRoute(routePath);

  if (!normalizedRoute) {
    return getAppBasePath(appCode);
  }

  if (normalizedRoute.startsWith('/app/')) {
    return normalizedRoute;
  }

  const legacyPrefix = '/admin/';

  if (normalizedRoute === ROUTES.admin || normalizedRoute === ROUTES.dashboard) {
    return getAppBasePath(appCode);
  }

  if (normalizedRoute.startsWith(legacyPrefix)) {
    const suffix = normalizedRoute.slice(legacyPrefix.length);
    return suffix ? `${getAppBasePath(appCode)}/${suffix}` : getAppBasePath(appCode);
  }

  return normalizedRoute;
}

function normalizeApp(row) {
  const module = row?.module ?? row;

  if (!module || module.active === false) {
    return null;
  }

  const code = toAppCode(module);

  if (!code) {
    return null;
  }

  return {
    id: module.id,
    code,
    name: module.name ?? code,
    description: module.description ?? '',
    icon: module.icon ?? '',
    iconColor: module.icon_color ?? null,
    href: getAppBasePath(code),
    routePath: module.route_path ?? '',
    sortOrder: Number(module.sequence ?? 10),
    active: module.active ?? true,
    installable: module.installable ?? true,
    isRemovable: module.is_removable ?? true,
  };
}

function normalizeCatalogApp(module, tenantModule = null) {
  const app = normalizeApp(module);

  if (!app) {
    return null;
  }

  const tenantState = tenantModule?.state ?? 'not_installed';

  return {
    ...app,
    tenantModuleId: tenantModule?.id ?? null,
    tenantState,
    isInstalled: tenantState === 'installed',
    installedAt: tenantModule?.installed_at ?? null,
    uninstalledAt: tenantModule?.uninstalled_at ?? null,
  };
}

function normalizeMenu(menu, app) {
  if (!menu || menu.active === false) {
    return null;
  }

  const appCode = normalizeAppCode(app?.code);
  const routePath = toDynamicRoute(menu.route_path, appCode);

  return {
    id: menu.id,
    appId: app?.id ?? menu.module_id ?? null,
    appCode,
    parentId: menu.parent_id ?? null,
    name: menu.name ?? '',
    code: menu.code ?? '',
    href: routePath,
    routePath,
    icon: menu.icon || app?.icon || '',
    permissionKey: '',
    sortOrder: Number(menu.sequence ?? 10),
    sequence: Number(menu.sequence ?? 10),
    active: menu.active ?? true,
  };
}

function filterMenusByAppRules(menus, appCode) {
  if (appCode !== 'products') {
    return menus;
  }

  return menus.filter((menu) => PRODUCT_MENU_ROUTES.has(menu.routePath));
}

function compareBySortOrder(first, second) {
  return first.sortOrder - second.sortOrder || first.name.localeCompare(second.name, 'ar');
}

function buildMenuTree(rows) {
  const map = new Map();
  const roots = [];

  rows.forEach((row) => {
    map.set(row.id, {
      ...row,
      children: [],
    });
  });

  rows.forEach((row) => {
    const item = map.get(row.id);
    const parentId = row.parentId ?? row.parent_id ?? null;

    if (parentId && map.has(parentId)) {
      map.get(parentId).children.push(item);
    } else {
      roots.push(item);
    }
  });

  return roots;
}

function fallbackApps() {
  return fallbackAppNavigation
    .map((item, index) => {
      const code = FALLBACK_APP_CODES_BY_HREF[item.href] ?? normalizeAppCode(getFallbackName(item));

      return {
        id: `fallback-${code}`,
        code,
        name: getFallbackName(item),
        titleKey: item.titleKey,
        icon: item.icon,
        href: getAppBasePath(code),
        routePath: item.href,
        sortOrder: index * 10,
        active: true,
      };
    })
    .filter((app) => app.code && app.code !== 'dashboard');
}

function fallbackMenus(appCode) {
  const normalizedAppCode = normalizeAppCode(appCode);
  const app = fallbackApps().find((item) => item.code === normalizedAppCode);

  if (!app) {
    return [];
  }

  return [
    {
      id: `fallback-menu-${app.code}`,
      appId: app.id,
      appCode: app.code,
      parentId: null,
      name: app.name,
      titleKey: app.titleKey,
      code: app.code,
      href: app.href,
      routePath: app.href,
      icon: app.icon,
      permissionKey: '',
      sortOrder: 10,
      sequence: 10,
      active: true,
    },
  ];
}

async function getInstalledApplicationRows(tenantId) {
  if (!tenantId) {
    return [];
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from('tenant_modules')
    .select(`tenant_id, module_id, state, module:ir_modules(${APP_COLUMNS})`)
    .eq('tenant_id', tenantId)
    .eq('state', 'installed');

  if (error) {
    throw error;
  }

  return (data ?? []).filter((row) => row.module?.application !== false && row.module?.technical !== true);
}

export async function getApps(options = {}) {
  const rows = await getInstalledApplicationRows(options.tenantId);
  const apps = rows.map(normalizeApp).filter(Boolean).sort(compareBySortOrder);
  return apps;
}

export async function getAppMenus(appCode, options = {}) {
  const normalizedAppCode = normalizeAppCode(appCode);

  if (!normalizedAppCode) {
    return [];
  }

  const apps = await getApps(options);
  const app = apps.find((item) => item.code === normalizedAppCode);

  if (!app) {
    return [];
  }

  const client = requireSupabase();
  const { data, error } = await client
    .from('ir_ui_menus')
    .select(MENU_COLUMNS)
    .eq('module_id', app.id)
    .eq('active', true)
    .order('sequence', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw error;
  }

  const menus = filterMenusByAppRules(
    (data ?? []).map((menu) => normalizeMenu(menu, app)).filter(Boolean),
    normalizedAppCode,
  ).sort(compareBySortOrder);
  return buildMenuTree(menus);
}

export async function getAllApplicationModules() {
  const client = requireSupabase();
  const { data, error } = await client
    .from('ir_modules')
    .select(APP_COLUMNS)
    .eq('application', true)
    .eq('technical', false)
    .eq('active', true)
    .order('sequence', { ascending: true });

  if (error) {
    return [];
  }

  return (data ?? []).map(normalizeApp).filter(Boolean).sort(compareBySortOrder);
}

export async function getApplicationModulesWithTenantState(tenantId) {
  const client = requireSupabase();
  const [{ data: modules, error: modulesError }, { data: tenantModules, error: tenantModulesError }] = await Promise.all([
    client
      .from('ir_modules')
      .select(APP_COLUMNS)
      .eq('application', true)
      .eq('technical', false)
      .eq('active', true)
      .order('sequence', { ascending: true }),
    tenantId
      ? client
          .from('tenant_modules')
          .select('id, tenant_id, module_id, state, installed_at, uninstalled_at')
          .eq('tenant_id', tenantId)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (modulesError) {
    throw modulesError;
  }

  if (tenantModulesError) {
    throw tenantModulesError;
  }

  const tenantModuleByModuleId = new Map((tenantModules ?? []).map((row) => [row.module_id, row]));

  return (modules ?? [])
    .map((module) => normalizeCatalogApp(module, tenantModuleByModuleId.get(module.id)))
    .filter(Boolean)
    .sort(compareBySortOrder);
}

export async function uninstallAppByModuleId({ tenantId, moduleId }) {
  if (!tenantId || !moduleId) {
    throw new Error('بيانات إزالة تثبيت التطبيق غير مكتملة.');
  }

  const client = requireSupabase();
  const { data: module, error: moduleError } = await client
    .from('ir_modules')
    .select('id, technical_name, application, technical, active, is_removable')
    .eq('id', moduleId)
    .single();

  if (moduleError) {
    throw moduleError;
  }

  if (!module?.application || module.technical || module.active === false || module.is_removable === false) {
    throw new Error('لا يمكن إزالة تثبيت هذا التطبيق.');
  }

  const now = new Date().toISOString();
  const { data, error } = await client
    .from('tenant_modules')
    .update({
      state: 'uninstalled',
      uninstalled_at: now,
      updated_at: now,
    })
    .eq('tenant_id', tenantId)
    .eq('module_id', moduleId)
    .eq('state', 'installed')
    .select('tenant_id, module_id, state');

  if (error) {
    throw error;
  }

  if (!data?.length) {
    throw new Error('تعذر العثور على التطبيق ضمن التطبيقات المثبتة.');
  }

  return data[0];
}

export async function installAppByModuleId({ tenantId, moduleId }) {
  if (!tenantId || !moduleId) {
    throw new Error('بيانات تثبيت التطبيق غير مكتملة.');
  }

  const client = requireSupabase();
  const { data: module, error: moduleError } = await client
    .from('ir_modules')
    .select('id, technical_name, application, technical, active, installable')
    .eq('id', moduleId)
    .single();

  if (moduleError) {
    throw moduleError;
  }

  if (!module?.application || module.technical || module.active === false || module.installable === false) {
    throw new Error('لا يمكن تثبيت هذا التطبيق.');
  }

  const now = new Date().toISOString();
  const { data: existingRows, error: existingError } = await client
    .from('tenant_modules')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('module_id', moduleId)
    .limit(1);

  if (existingError) {
    throw existingError;
  }

  if (existingRows?.length) {
    const { data, error } = await client
      .from('tenant_modules')
      .update({
        state: 'installed',
        installed_at: now,
        uninstalled_at: null,
        updated_at: now,
      })
      .eq('tenant_id', tenantId)
      .eq('module_id', moduleId)
      .select('tenant_id, module_id, state');

    if (error) {
      throw error;
    }

    if (!data?.length) {
      throw new Error('تعذر تثبيت التطبيق.');
    }

    return data[0];
  }

  const { data, error } = await client
    .from('tenant_modules')
    .insert({
      tenant_id: tenantId,
      module_id: moduleId,
      state: 'installed',
      installed_at: now,
      uninstalled_at: null,
      updated_at: now,
    })
    .select('tenant_id, module_id, state');

  if (error) {
    throw error;
  }

  if (!data?.length) {
    throw new Error('تعذر تثبيت التطبيق.');
  }

  return data[0];
}

export const appsService = {
  getApps,
  getAppMenus,
  getAllApplicationModules,
  getApplicationModulesWithTenantState,
  installAppByModuleId,
  uninstallAppByModuleId,
  fallbackApps,
  fallbackMenus,
};
