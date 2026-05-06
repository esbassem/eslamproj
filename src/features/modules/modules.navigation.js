import * as Icons from 'lucide-react';
import { ROUTES } from '@/core/config/routes.config';

const APP_ROUTE_VALUES = Object.values(ROUTES);

function normalizePathValue(routePath) {
  if (!routePath) {
    return '';
  }

  const trimmedPath = String(routePath).trim();

  if (!trimmedPath) {
    return '';
  }

  return trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
}

function splitPathParts(routePath) {
  const hashIndex = routePath.indexOf('#');
  const pathAndSearch = hashIndex >= 0 ? routePath.slice(0, hashIndex) : routePath;
  const hash = hashIndex >= 0 ? routePath.slice(hashIndex) : '';
  const searchIndex = pathAndSearch.indexOf('?');
  const pathname = searchIndex >= 0 ? pathAndSearch.slice(0, searchIndex) : pathAndSearch;
  const search = searchIndex >= 0 ? pathAndSearch.slice(searchIndex) : '';

  return { pathname, search, hash };
}

export function normalizeModuleRoute(routePath) {
  const normalizedPath = normalizePathValue(routePath);

  if (!normalizedPath) {
    return '';
  }

  if (APP_ROUTE_VALUES.includes(normalizedPath)) {
    return normalizedPath;
  }

  const requestedParts = splitPathParts(normalizedPath);
  const requestedPathname = requestedParts.pathname.replace(/\/+$/, '') || '/';
  const requestedSuffix = requestedPathname.replace(/^\/+/, '');
  const matchedRoute = APP_ROUTE_VALUES.find((routeValue) => {
    const routePathname = splitPathParts(routeValue).pathname.replace(/\/+$/, '') || '/';
    return routePathname === requestedPathname || (requestedSuffix && routePathname.endsWith(`/${requestedSuffix}`));
  });

  if (!matchedRoute) {
    return normalizedPath;
  }

  if (requestedParts.search || requestedParts.hash) {
    const matchedPathname = splitPathParts(matchedRoute).pathname;
    return `${matchedPathname}${requestedParts.search}${requestedParts.hash}`;
  }

  return matchedRoute;
}

export function resolveModuleIcon(iconName) {
  if (typeof iconName === 'function') {
    return iconName;
  }

  if (!iconName) {
    return Icons.Circle;
  }

  const pascalIconName = String(iconName)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join('');

  return Icons[iconName] ?? Icons[pascalIconName] ?? Icons.Circle;
}

function sortMenusBySequence(menus) {
  return [...menus].sort((first, second) => first.sequence - second.sequence || first.name.localeCompare(second.name, 'ar'));
}

export function buildMenuTree(menus) {
  const menuById = new Map(
    sortMenusBySequence(menus ?? []).map((menu) => [
      menu.id,
      {
        ...menu,
        children: [],
      },
    ]),
  );
  const rootMenus = [];

  for (const menu of menuById.values()) {
    if (!menu.parentId) {
      rootMenus.push(menu);
      continue;
    }

    const parent = menuById.get(menu.parentId);

    if (parent) {
      parent.children.push(menu);
    }
  }

  function sortChildren(menu) {
    menu.children = sortMenusBySequence(menu.children);
    menu.children.forEach(sortChildren);
    return menu;
  }

  return sortMenusBySequence(rootMenus).map(sortChildren);
}

export function getFirstChildRoutePath(children = []) {
  for (const child of children) {
    const childRoutePath = normalizeModuleRoute(child.routePath);

    if (childRoutePath) {
      return childRoutePath;
    }

    const nestedChildRoutePath = getFirstChildRoutePath(child.children);

    if (nestedChildRoutePath) {
      return nestedChildRoutePath;
    }
  }

  return '';
}

export function getRootMenuByModule(menus, technicalName) {
  return buildMenuTree(menus).find((menu) => menu.moduleTechnicalName === technicalName) ?? null;
}
