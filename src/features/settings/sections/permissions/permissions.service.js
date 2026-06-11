import { requireSupabase } from '@/core/lib/supabase';

const GROUP_COLUMNS = 'id, tenant_id, module_id, name, code, description, category, is_system, active, created_at, updated_at';
const MODULE_COLUMNS = 'id, technical_name, name, route_path, application, active, sequence';
const USER_COLUMNS = 'id, tenant_id, auth_user_id, full_name, phone, email, role, is_active, created_at, updated_at';
const USER_GROUP_COLUMNS = 'id, tenant_id, user_id, group_id, created_at';

function normalizeGroup(record, moduleById) {
  if (!record) {
    return null;
  }

  const module = moduleById.get(record.module_id) ?? null;

  return {
    id: record.id,
    tenantId: record.tenant_id,
    moduleId: record.module_id,
    name: record.name ?? '',
    code: record.code ?? '',
    description: record.description ?? '',
    category: record.category ?? '',
    isSystem: record.is_system ?? false,
    active: record.active ?? true,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
    module: module
      ? {
          id: module.id,
          technicalName: module.technical_name ?? '',
          name: module.name ?? '',
          routePath: module.route_path ?? '',
          application: module.application ?? false,
          active: module.active ?? true,
          sequence: Number(module.sequence ?? 10),
        }
      : null,
  };
}

function normalizeTenantUser(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    tenantId: record.tenant_id,
    authUserId: record.auth_user_id,
    fullName: record.full_name ?? '',
    phone: record.phone ?? '',
    email: record.email ?? '',
    role: record.role ?? 'staff',
    isActive: record.is_active ?? false,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function normalizeMembership(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    tenantId: record.tenant_id,
    userId: record.user_id,
    groupId: record.group_id,
    createdAt: record.created_at ?? null,
  };
}

export const permissionsService = {
  async listGroupsWithModules(tenantId) {
    if (!tenantId) {
      return [];
    }

    const client = requireSupabase();
    const { data: groups, error: groupsError } = await client
      .from('res_groups')
      .select(GROUP_COLUMNS)
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (groupsError) {
      throw groupsError;
    }

    const moduleIds = Array.from(new Set((groups ?? []).map((group) => group.module_id).filter(Boolean)));
    let moduleById = new Map();

    if (moduleIds.length) {
      const { data: modules, error: modulesError } = await client
        .from('ir_modules')
        .select(MODULE_COLUMNS)
        .in('id', moduleIds);

      if (modulesError) {
        throw modulesError;
      }

      moduleById = new Map((modules ?? []).map((module) => [module.id, module]));
    }

    return (groups ?? []).map((group) => normalizeGroup(group, moduleById)).filter(Boolean);
  },

  async listTenantUsers(tenantId) {
    if (!tenantId) {
      return [];
    }

    const client = requireSupabase();
    const { data, error } = await client
      .from('tenant_users')
      .select(USER_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('role', { ascending: true })
      .order('full_name', { ascending: true });

    if (error) {
      throw error;
    }

    return (data ?? []).map(normalizeTenantUser).filter(Boolean);
  },

  async listGroupMemberships({ tenantId, groupId }) {
    if (!tenantId || !groupId) {
      return [];
    }

    const client = requireSupabase();
    const { data, error } = await client
      .from('res_users_groups')
      .select(USER_GROUP_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('group_id', groupId);

    if (error) {
      throw error;
    }

    return (data ?? []).map(normalizeMembership).filter(Boolean);
  },

  async addUserToGroup({ tenantId, userId, groupId }) {
    if (!tenantId || !userId || !groupId) {
      throw new Error('بيانات الصلاحية غير مكتملة.');
    }

    const client = requireSupabase();
    const { data, error } = await client
      .from('res_users_groups')
      .insert({
        tenant_id: tenantId,
        user_id: userId,
        group_id: groupId,
      })
      .select(USER_GROUP_COLUMNS)
      .single();

    if (error) {
      throw error;
    }

    return normalizeMembership(data);
  },

  async removeUserFromGroup({ tenantId, userId, groupId }) {
    if (!tenantId || !userId || !groupId) {
      throw new Error('بيانات الصلاحية غير مكتملة.');
    }

    const client = requireSupabase();
    const { error } = await client
      .from('res_users_groups')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('user_id', userId)
      .eq('group_id', groupId);

    if (error) {
      throw error;
    }

    return true;
  },
};
