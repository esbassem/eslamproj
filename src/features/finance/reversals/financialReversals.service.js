import { requireSupabase } from '@/core/lib/supabase';

function requireTenant(tenantId) { if (!tenantId) throw new Error('لا توجد شركة نشطة.'); }
async function call(name, parameters, fallback) {
  const { data, error } = await requireSupabase().rpc(name, parameters);
  if (error) throw new Error(error.message || fallback);
  return data;
}

export function getReversalEligibility({ tenantId, domainType, domainId } = {}) {
  requireTenant(tenantId);
  return call('get_financial_reversal_eligibility', {
    p_tenant: tenantId, p_domain: domainType, p_domain_id: domainId,
  }, 'تعذر التحقق من أهلية العكس المحاسبي.');
}

export function reversePaymentAccounting({ tenantId, paymentId, reason, idempotencyKey, reversalDate = null } = {}) {
  requireTenant(tenantId);
  return call('reverse_financial_payment_accounting', {
    p_tenant: tenantId, p_payment: paymentId, p_reason: reason,
    p_idempotency: idempotencyKey, p_reversal_date: reversalDate,
  }, 'تعذر عكس الأثر المحاسبي للدفعة.');
}

export function reverseInternalTransferAccounting({ tenantId, transferId, reason, idempotencyKey, reversalDate = null } = {}) {
  requireTenant(tenantId);
  return call('reverse_internal_transfer_accounting', {
    p_tenant: tenantId, p_transfer: transferId, p_reason: reason,
    p_idempotency: idempotencyKey, p_reversal_date: reversalDate,
  }, 'تعذر عكس الأثر المحاسبي للتحويل الداخلي.');
}

export function unapplyAdvance({ tenantId, applicationId, reason, idempotencyKey, reversalDate = null } = {}) {
  requireTenant(tenantId);
  return call('unapply_financial_advance', {
    p_tenant_id: tenantId, p_application_id: applicationId, p_reason: reason,
    p_idempotency_key: idempotencyKey, p_reversal_date: reversalDate,
  }, 'تعذر فك تطبيق المقدم محاسبيًا.');
}
