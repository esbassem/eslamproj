import { requireSupabase } from '@/core/lib/supabase';

function requireTenantId(tenantId) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة.');
  }
}

export const employeeCustodyService = {
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
      .select('debit, credit, account_move:account_moves!inner(state)')
      .eq('tenant_id', tenantId)
      .eq('account_id', data.id)
      .eq('account_move.state', 'posted');

    if (linesError) return { ...data, kind: 'custody', balance: null, balanceUnavailable: true };

    const balance = (lines || []).reduce((total, line) => (
      total + Number(line.debit || 0) - Number(line.credit || 0)
    ), 0);

    return { ...data, kind: 'custody', balance: Math.round(balance * 100) / 100 };
  },
};
