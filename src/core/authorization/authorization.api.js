import { requireSupabase } from '@/core/lib/supabase';
import { createSingleEntryRequestCache } from '@/core/authorization/authorization.cache';

const authorizationRequestCache = createSingleEntryRequestCache();

export const authorizationApi = {
  async getCurrentAuthorization({ cacheKey, force = false } = {}) {
    if (!cacheKey) {
      authorizationRequestCache.clear();
      return { permissionCodes: [], resourceScope: null };
    }

    return authorizationRequestCache.load(cacheKey, async () => {
      const { data, error } = await requireSupabase().rpc('get_my_authorization');

      if (error) {
        throw error;
      }

      return {
        permissionCodes: Array.from(new Set((data?.permission_codes ?? []).filter(Boolean))),
        resourceScope: data?.resource_scope ?? null,
      };
    }, { force });
  },

  async listCurrentUserPermissions() {
    const { data, error } = await requireSupabase().rpc('get_my_permissions');

    if (error) {
      throw error;
    }

    return Array.from(new Set((data ?? []).filter(Boolean)));
  },

  async hasPermission(permissionCode, tenantId = null) {
    if (!permissionCode) return false;

    const { data, error } = await requireSupabase().rpc('has_permission', {
      p_permission_code: permissionCode,
      p_tenant_id: tenantId,
    });

    if (error) {
      throw error;
    }

    return data === true;
  },

  clearCache() {
    authorizationRequestCache.clear();
  },
};
