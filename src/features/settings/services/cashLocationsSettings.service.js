import { requireSupabase } from '@/core/lib/supabase';

const PARENT_ACCOUNT_NAME = 'نقدية لدى الموظفين';

function requireTenantId(tenantId) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة.');
  }
}

export const cashLocationsSettingsService = {
  async getEmployeeCustodyAccount(tenantId, responsibleUserId) {
    requireTenantId(tenantId);
    if (!responsibleUserId) return null;

    const client = requireSupabase();
    const { data, error } = await client
      .from('account_accounts')
      .select('id, code, name, account_type, responsible_user_id, active')
      .eq('tenant_id', tenantId)
      .eq('responsible_user_id', responsibleUserId)
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message || 'تعذر تحميل عهدة الموظف النقدية.');
    if (!data?.id) return null;

    const { data: lines, error: linesError } = await client
      .from('account_move_lines')
      .select('debit, credit')
      .eq('tenant_id', tenantId)
      .eq('account_id', data.id)
      .eq('parent_state', 'posted');

    if (linesError) return { ...data, kind: 'custody', balance: null, balanceUnavailable: true };

    const balance = (lines || []).reduce((total, line) => (
      total + Number(line.debit || 0) - Number(line.credit || 0)
    ), 0);

    return { ...data, kind: 'custody', balance: Math.round(balance * 100) / 100 };
  },

  async listEmployees(tenantId) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const { data, error } = await client
      .from('tenant_users')
      .select('id, full_name')
      .eq('tenant_id', tenantId)
      .order('full_name', { ascending: true });

    if (error) throw new Error(error.message || 'تعذر تحميل الموظفين.');

    return (data || []).map((employee) => ({
      id: employee.id,
      fullName: employee.full_name || '',
    }));
  },

  async listCustodyAccounts(tenantId) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const { data: parent, error: parentError } = await client
      .from('account_accounts')
      .select('group_id')
      .eq('tenant_id', tenantId)
      .or(`name.eq.${PARENT_ACCOUNT_NAME},code.eq.111003`)
      .limit(1)
      .maybeSingle();

    if (parentError) throw new Error(parentError.message || 'تعذر تحميل حسابات العهد.');
    if (!parent?.group_id) return [];

    const { data, error } = await client
      .from('account_accounts')
      .select('id, code, name, responsible_user_id, active')
      .eq('tenant_id', tenantId)
      .eq('group_id', parent.group_id)
      .not('responsible_user_id', 'is', null)
      .order('code', { ascending: true });

    if (error) throw new Error(error.message || 'تعذر تحميل حسابات العهد.');

    return data || [];
  },

  async createCustodyAccount({ tenantId, responsibleUserId, name }) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const { data, error } = await client.rpc('create_employee_custody_account', {
      p_tenant_id: tenantId,
      p_responsible_user_id: responsibleUserId,
      p_name: String(name || '').trim(),
    });

    if (error) throw new Error(error.message || 'تعذر إنشاء حساب العهدة.');
    return data;
  },

  async deleteCustodyAccount({ tenantId, accountId }) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const { data, error } = await client.rpc('delete_unused_employee_custody_account', {
      p_tenant_id: tenantId,
      p_account_id: accountId,
    });

    if (error) throw new Error(error.message || 'تعذر حذف حساب العهدة.');
    return data;
  },
};
