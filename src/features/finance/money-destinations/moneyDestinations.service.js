import { requireSupabase } from '@/core/lib/supabase';
import { normalizeMoneyDestinationSelection } from './moneyDestinationSelection';
import { normalizeFinancialError, requireFinancialTenant } from '../shared/financialError';

export async function getMoneyDestinationSelection({
  tenantId,
  permissionCode,
  accessType,
  branchId = null,
  destinationTypes = null,
} = {}) {
  requireFinancialTenant(tenantId);
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
  if (error) throw normalizeFinancialError(error, 'تعذر تحميل أماكن الأموال المسموحة.');
  return normalizeMoneyDestinationSelection(data);
}

export async function listMoneyDestinationBalances({
  tenantId,
  permissionCode,
  accessType = 'view',
  branchId = null,
  destinationTypes = null,
} = {}) {
  requireFinancialTenant(tenantId);
  if (!permissionCode) throw normalizeFinancialError(null, 'تعذر تحديد العملية المالية المطلوبة.');
  const client = requireSupabase();
  const { data, error } = await client.rpc('list_money_destination_operational_balances', {
    p_tenant_id: tenantId,
    p_permission_code: permissionCode,
    p_access_type: accessType,
    p_branch_id: branchId || null,
    p_destination_types: Array.isArray(destinationTypes) && destinationTypes.length ? destinationTypes : null,
  });
  if (error) throw normalizeFinancialError(error, 'تعذر تحميل أرصدة أماكن الأموال.');
  return (data ?? []).map((row) => ({
    destinationId: row.destination_id,
    balance: Number(row.balance ?? 0),
    currencyCode: row.currency_code || null,
    calculatedAt: row.calculated_at || null,
  }));
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
