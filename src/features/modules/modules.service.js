import { modulesApi } from '@/features/modules/modules.api';

function normalizeModule(row) {
  const module = row?.module;

  if (!module || module.active === false) {
    return null;
  }

  return {
    id: module.id,
    technicalName: module.technical_name ?? '',
    name: module.name ?? '',
    icon: module.icon ?? '',
    routePath: module.route_path ?? '',
    application: module.application ?? false,
    technical: module.technical ?? false,
    active: module.active ?? true,
    tenantState: row.state ?? '',
  };
}

function normalizeMenu(menu, moduleById) {
  if (!menu) {
    return null;
  }

  const module = moduleById.get(menu.module_id) ?? null;

  return {
    id: menu.id,
    moduleId: menu.module_id ?? null,
    moduleTechnicalName: module?.technicalName ?? '',
    parentId: menu.parent_id ?? null,
    name: menu.name ?? '',
    code: menu.code ?? '',
    routePath: menu.route_path ?? '',
    icon: menu.icon || module?.icon || '',
    sequence: Number(menu.sequence ?? 10),
    active: menu.active ?? true,
  };
}

function compareMenus(first, second) {
  return first.sequence - second.sequence || first.name.localeCompare(second.name, 'ar');
}

function orderMenus(menus) {
  const childrenByParentId = menus.reduce((groups, menu) => {
    const parentKey = menu.parentId || 'root';
    const group = groups.get(parentKey) ?? [];
    group.push(menu);
    groups.set(parentKey, group);
    return groups;
  }, new Map());

  for (const group of childrenByParentId.values()) {
    group.sort(compareMenus);
  }

  const orderedMenus = [];
  const visited = new Set();

  function visit(menu) {
    if (!menu || visited.has(menu.id)) {
      return;
    }

    visited.add(menu.id);
    orderedMenus.push(menu);

    for (const child of childrenByParentId.get(menu.id) ?? []) {
      visit(child);
    }
  }

  for (const menu of childrenByParentId.get('root') ?? []) {
    visit(menu);
  }

  for (const menu of menus.sort(compareMenus)) {
    visit(menu);
  }

  return orderedMenus;
}

export const modulesService = {
  async loadInstalledModules(tenantId, options = {}) {
    const tenantModuleRows = await modulesApi.listInstalledTenantModules(tenantId, options);
    const modules = tenantModuleRows.map(normalizeModule).filter(Boolean);
    const moduleById = new Map(modules.map((module) => [module.id, module]));
    const menuRows = await modulesApi.listMenusByModuleIds(modules.map((module) => module.id));
    const menus = orderMenus(menuRows.map((menu) => normalizeMenu(menu, moduleById)).filter(Boolean));

    return {
      modules,
      menus,
    };
  },
};
