import { requireSupabase } from '@/core/lib/supabase';
import { listCurrentUserAllowedModuleIds } from '@/features/modules/appPermissions.api';

const MODULE_COLUMNS = 'id, technical_name, name, icon, route_path, application, technical, active';
const MENU_COLUMNS = 'id, module_id, parent_id, name, code, route_path, icon, sequence, active';

function isOwnerRole(role) {
  return role === 'owner';
}

export const modulesApi = {
  async listInstalledTenantModules(tenantId, options = {}) {
    if (!tenantId) {
      return [];
    }

    const client = requireSupabase();

    if (isOwnerRole(options.userRole)) {
      const { data, error } = await client
        .from('tenant_modules')
        .select(`tenant_id, module_id, state, module:ir_modules(${MODULE_COLUMNS})`)
        .eq('tenant_id', tenantId)
        .eq('state', 'installed');

      if (error) {
        throw error;
      }

      return data ?? [];
    }

    const moduleIds = await listCurrentUserAllowedModuleIds(tenantId);

    if (!moduleIds.length) {
      return [];
    }

    const { data, error } = await client
      .from('tenant_modules')
      .select(`tenant_id, module_id, state, module:ir_modules(${MODULE_COLUMNS})`)
      .eq('tenant_id', tenantId)
      .eq('state', 'installed')
      .in('module_id', moduleIds);

    if (error) {
      throw error;
    }

    return data ?? [];
  },

  async listMenusByModuleIds(moduleIds) {
    const normalizedModuleIds = Array.from(new Set((moduleIds ?? []).filter(Boolean)));

    if (!normalizedModuleIds.length) {
      return [];
    }

    const client = requireSupabase();
    const { data, error } = await client
      .from('ir_ui_menus')
      .select(MENU_COLUMNS)
      .in('module_id', normalizedModuleIds)
      .order('sequence', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return data ?? [];
  },
};
