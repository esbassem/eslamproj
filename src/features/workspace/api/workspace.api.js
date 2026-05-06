import { requireSupabase } from '@/core/lib/supabase';

const TENANT_COLUMNS = 'id, name, slug, domain, status, created_at, updated_at';
const TENANT_USER_COLUMNS = 'id, tenant_id, auth_user_id, full_name, phone, email, role, is_active, created_at, updated_at';

function normalizeTenant(tenant) {
  if (!tenant) {
    return null;
  }

  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    domain: tenant.domain ?? null,
    status: tenant.status ?? null,
    createdAt: tenant.created_at ?? null,
    updatedAt: tenant.updated_at ?? null,
  };
}

function normalizeTenantUser(tenantUser) {
  if (!tenantUser) {
    return null;
  }

  return {
    id: tenantUser.id,
    tenantId: tenantUser.tenant_id,
    authUserId: tenantUser.auth_user_id,
    fullName: tenantUser.full_name ?? '',
    phone: tenantUser.phone ?? '',
    email: tenantUser.email ?? '',
    role: tenantUser.role ?? 'member',
    isActive: tenantUser.is_active ?? false,
    createdAt: tenantUser.created_at ?? null,
    updatedAt: tenantUser.updated_at ?? null,
  };
}

export const workspaceService = {
  async getTenantBootstrap(authUserId) {
    const client = requireSupabase();
    const { data: tenantUser, error: tenantUserError } = await client
      .from('tenant_users')
      .select(TENANT_USER_COLUMNS)
      .eq('auth_user_id', authUserId)
      .limit(1)
      .maybeSingle();

    if (tenantUserError) {
      throw tenantUserError;
    }

    if (!tenantUser) {
      return {
        tenantUser: null,
        tenant: null,
      };
    }

    const { data: tenant, error: tenantError } = await client
      .from('tenants')
      .select(TENANT_COLUMNS)
      .eq('id', tenantUser.tenant_id)
      .single();

    if (tenantError) {
      throw tenantError;
    }

    return {
      tenantUser: normalizeTenantUser(tenantUser),
      tenant: normalizeTenant(tenant),
    };
  },

  async createTenantBootstrap({ authUser, payload }) {
    const client = requireSupabase();
    const tenantId = crypto.randomUUID();
    const tenantInsert = {
      id: tenantId,
      name: payload.name.trim(),
      slug: payload.slug.trim(),
    };

    if (payload.domain?.trim()) {
      tenantInsert.domain = payload.domain.trim();
    }

    const { error: tenantError } = await client.from('tenants').insert(tenantInsert);

    if (tenantError) {
      throw tenantError;
    }

    const ownerFullName =
      authUser.user_metadata?.full_name ||
      authUser.user_metadata?.name ||
      authUser.email?.split('@')[0] ||
      'Owner';
    const ownerPhone = authUser.phone || authUser.user_metadata?.phone || null;

    const { data: createdTenantUser, error: tenantUserError } = await client
      .from('tenant_users')
      .insert({
        tenant_id: tenantId,
        auth_user_id: authUser.id,
        full_name: ownerFullName,
        phone: ownerPhone,
        email: authUser.email ?? '',
        role: 'owner',
        is_active: true,
      })
      .select(TENANT_USER_COLUMNS)
      .single();

    if (tenantUserError) {
      await client.from('tenants').delete().eq('id', tenantId);
      throw tenantUserError;
    }

    const branchName = payload.branchName?.trim();

    if (branchName) {
      const { error: branchError } = await client.from('branches').insert({
        tenant_id: tenantId,
        name: branchName,
        is_active: true,
      });

      if (branchError) {
        await client.from('tenant_users').delete().eq('id', createdTenantUser.id);
        await client.from('tenants').delete().eq('id', tenantId);
        throw branchError;
      }
    }

    const { data: createdTenant, error: createdTenantError } = await client
      .from('tenants')
      .select(TENANT_COLUMNS)
      .eq('id', tenantId)
      .single();

    if (createdTenantError) {
      throw createdTenantError;
    }

    return {
      tenant: normalizeTenant(createdTenant),
      tenantUser: normalizeTenantUser(createdTenantUser),
    };
  },
};
