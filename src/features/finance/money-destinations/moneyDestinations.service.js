import { requireSupabase } from '@/core/lib/supabase';
import { normalizeMoneyDestinationSelection } from './moneyDestinationSelection';

function requireTenantId(tenantId) {
  if (!tenantId) throw new Error('لا توجد شركة نشطة.');
}

export async function getMoneyDestinationSelection({
  tenantId,
  permissionCode,
  accessType,
  branchId = null,
  destinationTypes = null,
} = {}) {
  requireTenantId(tenantId);
  if (!permissionCode || !accessType) throw new Error('تعذر تحديد العملية المالية المطلوبة.');

  const client = requireSupabase();
  const { data, error } = await client.rpc('get_money_destination_selection', {
    p_tenant_id: tenantId,
    p_permission_code: permissionCode,
    p_access_type: accessType,
    p_branch_id: branchId || null,
    p_destination_types: Array.isArray(destinationTypes) && destinationTypes.length
      ? destinationTypes
      : null,
  });
  if (error) throw new Error(error.message || 'تعذر تحميل الموارد المالية المسموحة.');
  return normalizeMoneyDestinationSelection(data);
}

export function getAllowedCollectionDestinations({ tenantId, branchId = null } = {}) {
  return getMoneyDestinationSelection({
    tenantId,
    branchId,
    permissionCode: 'financial.payment.create',
    accessType: 'initiate',
    destinationTypes: ['cashbox', 'employee_cash_custody', 'pos_drawer'],
  });
}
