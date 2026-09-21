import { requireSupabase } from '@/core/lib/supabase';

export async function resolveFunctionalAccounts({ tenantId, roles, branchId = null }) {
  const requestedRoles = [...new Set((roles || []).filter(Boolean))];
  if (!tenantId) throw new Error('لا توجد شركة نشطة.');
  if (!requestedRoles.length) return new Map();

  const { data, error } = await requireSupabase().rpc('resolve_functional_accounts', {
    p_tenant_id: tenantId,
    p_functional_roles: requestedRoles,
    p_branch_id: branchId,
  });
  if (error) throw error;
  return new Map((data || []).map((row) => [row.functional_role, row.account_id]));
}

export async function resolveFunctionalAccount({ tenantId, role, branchId = null }) {
  const accounts = await resolveFunctionalAccounts({ tenantId, roles: [role], branchId });
  const accountId = accounts.get(role);
  if (!accountId) throw new Error(`الحساب الوظيفي غير مهيأ: ${role}`);
  return accountId;
}
