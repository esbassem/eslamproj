import { requireSupabase } from '@/core/lib/supabase';

function requireIdentifier(value, message) {
  if (!value) throw new Error(message);
}

export const ledgerDeletionService = {
  async deleteAccountMove({ tenantId, moveId } = {}) {
    requireIdentifier(tenantId, 'لا توجد شركة نشطة.');
    requireIdentifier(moveId, 'تعذر تحديد القيد المراد حذفه.');

    const client = requireSupabase();
    const { data, error } = await client.rpc('delete_account_move_atomic', {
      p_tenant_id: tenantId,
      p_move_id: moveId,
    });

    if (error) {
      throw new Error(error.message || 'لم تكتمل عملية الحذف، ولم يتم تغيير أي بيانات.');
    }
    if (!data?.success) {
      throw new Error('لم تكتمل عملية الحذف، ولم يتم تغيير أي بيانات.');
    }

    return data;
  },
};
