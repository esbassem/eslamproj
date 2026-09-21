import { requireSupabase } from '@/core/lib/supabase';
import { normalizeMoneyDestinationSelection } from '../money-destinations/moneyDestinationSelection';
import { normalizeFinancialError, requireFinancialTenant } from '../shared/financialError';

export async function listAvailablePaymentMethods({ tenantId, permissionCode = 'financial.payment.create' } = {}) {
  requireFinancialTenant(tenantId);
  const client = requireSupabase();
  const { data, error } = await client.rpc('list_available_financial_payment_methods', {
    p_tenant_id: tenantId,
    p_permission_code: permissionCode,
  });
  if (error) throw normalizeFinancialError(error, 'تعذر تحميل طرق الدفع المتاحة.');
  const methods = data ?? [];
  const usability = await Promise.all(methods.map(async (method) => {
    const result = await client.rpc('is_financial_payment_method_usable', {
      p_tenant_id: tenantId,
      p_payment_method_id: method.payment_method_id,
    });
    if (result.error) throw normalizeFinancialError(result.error, 'تعذر التحقق من جاهزية طرق الدفع.');
    return result.data === true;
  }));
  return methods.filter((_, index) => usability[index]);
}

export async function getPaymentMethodDestinationSelection({
  tenantId,
  paymentMethodId,
  permissionCode = 'financial.payment.create',
  accessType = 'initiate',
  branchId = null,
} = {}) {
  requireFinancialTenant(tenantId);
  if (!paymentMethodId) throw new Error('يجب اختيار طريقة دفع.');
  const client = requireSupabase();
  const { data, error } = await client.rpc('get_payment_method_destination_selection', {
    p_tenant_id: tenantId,
    p_payment_method_id: paymentMethodId,
    p_permission_code: permissionCode,
    p_access_type: accessType,
    p_branch_id: branchId || null,
  });
  if (error) throw normalizeFinancialError(error, 'تعذر تحميل أماكن الأموال المسموحة.');
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
  requireFinancialTenant(tenantId);
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
  if (error) throw normalizeFinancialError(error, 'تعذر حفظ طريقة الدفع.');
  return data;
}
