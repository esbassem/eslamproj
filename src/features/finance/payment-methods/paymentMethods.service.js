import { requireSupabase } from '@/core/lib/supabase';
import { normalizeMoneyDestinationSelection } from '../money-destinations/moneyDestinationSelection';

function requireTenantId(tenantId) {
  if (!tenantId) throw new Error('لا توجد شركة نشطة.');
}

export async function listAvailablePaymentMethods({ tenantId, permissionCode = 'financial.payment.create' } = {}) {
  requireTenantId(tenantId);
  const client = requireSupabase();
  const { data, error } = await client.rpc('list_available_financial_payment_methods', {
    p_tenant_id: tenantId,
    p_permission_code: permissionCode,
  });
  if (error) throw new Error(error.message || 'تعذر تحميل طرق الدفع المتاحة.');
  return data ?? [];
}

export async function getPaymentMethodDestinationSelection({
  tenantId,
  paymentMethodId,
  permissionCode = 'financial.payment.create',
  accessType = 'initiate',
  branchId = null,
} = {}) {
  requireTenantId(tenantId);
  if (!paymentMethodId) throw new Error('يجب اختيار طريقة دفع.');
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_payment_method_destination_selection', {
    p_tenant_id: tenantId,
    p_payment_method_id: paymentMethodId,
    p_permission_code: permissionCode,
    p_access_type: accessType,
    p_branch_id: branchId || null,
  });
  if (error) throw new Error(error.message || 'تعذر تحميل وجهات الدفع المسموحة.');
  return normalizeMoneyDestinationSelection(data);
}

export async function savePaymentMethod({
  tenantId,
  paymentMethodId = null,
  name,
  semanticKey,
  methodType,
  isActive = true,
  requiresReference = null,
  requiresConfirmation = null,
  metadata = {},
} = {}) {
  requireTenantId(tenantId);
  const client = requireSupabase();
  const { data, error } = await client.rpc('save_financial_payment_method', {
    p_tenant_id: tenantId,
    p_payment_method_id: paymentMethodId,
    p_name: name,
    p_semantic_key: semanticKey,
    p_method_type: methodType,
    p_is_active: isActive,
    p_requires_reference: requiresReference,
    p_requires_confirmation: requiresConfirmation,
    p_metadata: metadata,
  });
  if (error) throw new Error(error.message || 'تعذر حفظ طريقة الدفع.');
  return data;
}
