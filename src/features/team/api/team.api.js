import { requireSupabase } from '@/core/lib/supabase';
import { messages } from '@/core/i18n/messages';

const TEAM_MEMBER_COLUMNS = 'id, tenant_id, auth_user_id, full_name, phone, email, role, is_active, created_at, updated_at';

function normalizeTeamMember(record) {
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

    console.log('ACCESS TOKEN:', accessToken);

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
};
