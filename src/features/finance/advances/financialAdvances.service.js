import { requireSupabase } from '@/core/lib/supabase';

function tenant(tenantId) {
  if (!tenantId) throw new Error('لا توجد شركة نشطة.');
}

async function call(name, parameters, fallback) {
  const { data, error } = await requireSupabase().rpc(name, parameters);
  if (error) throw new Error(error.message || fallback);
  return data;
}

export function listAllocatableTargetsForAdvance({ tenantId, advancePaymentId, limit = 50, offset = 0 } = {}) {
  tenant(tenantId);
  return call('list_allocatable_targets_for_advance', {
    p_tenant_id: tenantId, p_advance_payment_id: advancePaymentId,
    p_limit: limit, p_offset: offset,
  }, 'تعذر تحميل البنود القابلة لتطبيق المقدم.');
}

export function applyFinancialAdvance({ tenantId, advancePaymentId, targetAccountLineId, amount, idempotencyKey, notes = null } = {}) {
  tenant(tenantId);
  return call('apply_financial_advance', {
    p_tenant_id: tenantId, p_advance_payment_id: advancePaymentId,
    p_target_account_line_id: targetAccountLineId, p_amount: amount,
    p_idempotency_key: idempotencyKey, p_notes: notes,
  }, 'تعذر تطبيق المقدم.');
}

export function getFinancialAdvanceApplicationSummary({ tenantId, advancePaymentId } = {}) {
  tenant(tenantId);
  return call('get_financial_advance_application_summary', {
    p_tenant_id: tenantId, p_advance_payment_id: advancePaymentId,
  }, 'تعذر تحميل ملخص المقدم.');
}

export function unapplyFinancialAdvance({ tenantId, applicationId, reason } = {}) {
  tenant(tenantId);
  return call('unapply_financial_advance', {
    p_tenant_id: tenantId, p_application_id: applicationId, p_reason: reason,
  }, 'فك تطبيق المقدم يتطلب دعم العكس المحاسبي.');
}
