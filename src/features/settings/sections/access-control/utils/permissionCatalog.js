export function groupPermissionCatalog(permissions = [], modules = []) {
  const moduleByCode = new Map(modules.map((module) => [module.technical_name, module]));
  const sections = new Map();
  permissions.filter((permission) => permission.active !== false).forEach((permission) => {
    const code = permission.module_code || permission.resource;
    if (!sections.has(code)) sections.set(code, { code, name: moduleByCode.get(code)?.name || code, appAccess: [], actions: [] });
    sections.get(code)[permission.permission_type === 'app_access' ? 'appAccess' : 'actions'].push(permission);
  });
  const sort = (a, b) => (a.sort_order || 100) - (b.sort_order || 100) || a.name.localeCompare(b.name, 'ar');
  return [...sections.values()].map((section) => ({ ...section, appAccess: section.appAccess.sort(sort), actions: section.actions.sort(sort) })).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export function permissionMatches(permission, term = '') {
  const query = term.trim().toLowerCase();
  return !query || [permission.name, permission.description, permission.code].some((value) => value?.toLowerCase().includes(query));
}

export function calculatePermissionRemovalImpact({ permissionId, groupId, memberIds = [], memberships = [], grants = [] }) {
  const groupsWithPermission = new Set(grants.filter((grant) => grant.permission_id === permissionId).map((grant) => grant.group_id));
  return memberIds.filter((userId) => !memberships.some((membership) => membership.user_id === userId && membership.group_id !== groupId && groupsWithPermission.has(membership.group_id))).length;
}
