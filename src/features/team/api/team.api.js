import { requireSupabase } from '@/core/lib/supabase';
import { messages } from '@/core/i18n/messages';

const TEAM_MEMBER_COLUMNS = 'id, tenant_id, auth_user_id, partner_id, full_name, phone, email, role, is_active, created_at, updated_at';

function normalizeTeamMember(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    tenantId: record.tenant_id,
    authUserId: record.auth_user_id,
    partnerId: record.partner_id ?? null,
    fullName: record.full_name ?? '',
    phone: record.phone ?? '',
    email: record.email ?? '',
    role: record.role ?? 'staff',
    isActive: record.is_active ?? false,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

export const TEAM_ROLE_OPTIONS = ['owner', 'admin', 'cashier', 'sales', 'accountant', 'staff'];

async function extractFunctionError(error) {
  if (!error?.context) {
    return error?.message || messages.ar.errors.teamCreate;
  }

  try {
    const body = await error.context.json();
    if (body?.error) {
      return body.error;
    }
  } catch {}

  try {
    const text = await error.context.text();
    if (text) {
      return text;
    }
  } catch {}

  return error.message || messages.ar.errors.teamCreate;
}

export const teamService = {
  async listTeamMembers(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('tenant_users')
      .select(TEAM_MEMBER_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(await extractFunctionError(error));
    }

    return (data ?? []).map(normalizeTeamMember);
  },

  async createTeamMember({ tenantId, fullName, email, password, role, phone }) {
    const client = requireSupabase();
    const { data: sessionData } = await client.auth.getSession();

    if (!sessionData?.session?.access_token) {
      throw new Error('No access token found');
    }

    const accessToken = sessionData.session.access_token;

    const { data, error } = await client.functions.invoke('create-tenant-user', {
      body: {
        tenantId,
        fullName,
        email,
        password,
        role,
        phone,
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (error) {
      const functionErrorMessage = await extractFunctionError(error);
      throw new Error(functionErrorMessage);
    }

    if (!data?.member) {
      throw new Error(messages.ar.errors.teamCreate);
    }

    return normalizeTeamMember(data.member);
  },

  async createFinancialPartner(tenantUserId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('create_financial_partner_for_tenant_user', {
      p_tenant_user_id: tenantUserId,
    });

    if (error) {
      throw new Error(await extractFunctionError(error));
    }

    return {
      tenantUserId: data?.tenant_user_id ?? tenantUserId,
      partnerId: data?.partner_id ?? null,
      created: data?.created ?? false,
    };
  },

  async createFinancialPartnersForUnlinkedUsers(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client.rpc('create_financial_partners_for_unlinked_tenant_users', {
      p_tenant_id: tenantId,
    });

    if (error) {
      throw new Error(await extractFunctionError(error));
    }

    return Number(data ?? 0);
  },

  async getFinancialPartner({ tenantId, partnerId }) {
    if (!tenantId || !partnerId) {
      return null;
    }

    const client = requireSupabase();
    const { data, error } = await client
      .from('partners')
      .select('id, tenant_id, name, phone1, mobile, email, active, is_external_contact, created_at')
      .eq('id', partnerId)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      throw new Error(await extractFunctionError(error));
    }

    if (!data) {
      return null;
    }

    return {
      id: data.id,
      tenantId: data.tenant_id,
      name: data.name ?? '',
      phone: data.phone1 ?? data.mobile ?? '',
      email: data.email ?? '',
      isActive: data.active ?? true,
      isInternal: data.is_external_contact === false,
      createdAt: data.created_at ?? null,
    };
  },
};
