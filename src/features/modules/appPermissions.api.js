import { requireSupabase } from '@/core/lib/supabase';

export async function listCurrentUserAllowedModuleIds(tenantId) {
  if (!tenantId) {
    return [];
  }

  const client = requireSupabase();
  const {
    data: { user },
    error: userError,
  } = await client.auth.getUser();

  if (userError) {
    throw userError;
  }

  if (!user?.id) {
    return [];
  }

  const { data: tenantUser, error: tenantUserError } = await client
    .from('tenant_users')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (tenantUserError) {
    throw tenantUserError;
  }

  if (!tenantUser?.id) {
    return [];
  }

  const { data: memberships, error: membershipsError } = await client
    .from('res_users_groups')
    .select('group_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', tenantUser.id);

  if (membershipsError) {
    throw membershipsError;
  }

  const groupIds = Array.from(new Set((memberships ?? []).map((membership) => membership.group_id).filter(Boolean)));

  if (!groupIds.length) {
    return [];
  }

  const { data: groups, error: groupsError } = await client
    .from('res_groups')
    .select('module_id, tenant_id, active')
    .in('id', groupIds)
    .eq('active', true);

  if (groupsError) {
    throw groupsError;
  }

  return Array.from(
    new Set(
      (groups ?? [])
        .filter((group) => !group.tenant_id || group.tenant_id === tenantId)
        .map((group) => group.module_id)
        .filter(Boolean),
    ),
  );
}
