import { groupPermissionCatalog, permissionMatches } from './permissionCatalog.js';

export function buildPermissionCatalogView({ permissions = [], modules = [], term = '', moduleFilter = 'all', typeFilter = 'all' }) {
  const knownCodes = new Set(modules.map((module) => module.technical_name));
  const normalized = permissions.map((permission) => ({ ...permission, catalog_module_code: knownCodes.has(permission.module_code) ? permission.module_code : '__unclassified' }));
  const sections = groupPermissionCatalog(normalized.map((permission) => ({ ...permission, module_code: permission.catalog_module_code })), [...modules,{technical_name:'__unclassified',name:'غير مصنفة / تحتاج مراجعة'}]);
  return sections.filter((section)=>moduleFilter==='all'||section.code===moduleFilter).map((section)=>{
    const moduleMatches=section.name.toLowerCase().includes(term.trim().toLowerCase());
    const filter=(permission)=>(moduleMatches||permissionMatches(permission,term))&&(typeFilter==='all'||permission.permission_type===typeFilter);
    return {...section,appAccess:section.appAccess.filter(filter),actions:section.actions.filter(filter)};
  }).filter((section)=>section.appAccess.length||section.actions.length);
}

export function catalogStats(permissions = [], modules = []) {
  const known=new Set(modules.map(module=>module.technical_name));
  return {total:permissions.length,appAccess:permissions.filter(p=>p.permission_type==='app_access').length,actions:permissions.filter(p=>p.permission_type==='action').length,apps:new Set(permissions.filter(p=>known.has(p.module_code)).map(p=>p.module_code)).size,unclassified:permissions.filter(p=>!known.has(p.module_code)).length};
}
