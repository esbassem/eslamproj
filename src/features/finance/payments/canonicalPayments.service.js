import { requireSupabase } from '@/core/lib/supabase';

function requireTenantId(tenantId) {
  if (!tenantId) throw new Error('لا توجد شركة نشطة.');
}

async function call(contract, parameters, fallbackMessage) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(contract, parameters);
  if (error) throw new Error(error.message || fallbackMessage);
  return data;
}

export function createFinancialPayment({
  tenantId, direction, amount, paymentMethodId, idempotencyKey,
  moneyDestinationId = null, currencyCode = 'EGP', partnerId = null,
  branchId = null, referenceNumber = null, notes = null,
  sourceApp = null, sourceModel = null, sourceId = null,
} = {}) {
  requireTenantId(tenantId);
  return call('create_financial_payment', {
    p_tenant_id: tenantId, p_direction: direction, p_amount: amount,
    p_payment_method_id: paymentMethodId, p_idempotency_key: idempotencyKey,
    p_money_destination_id: moneyDestinationId, p_currency_code: currencyCode,
    p_partner_id: partnerId, p_branch_id: branchId,
    p_reference_number: referenceNumber, p_notes: notes,
    p_source_app: sourceApp, p_source_model: sourceModel, p_source_id: sourceId,
  }, 'تعذر إنشاء الدفعة.');
}

export function submitFinancialPayment({ tenantId, paymentId } = {}) {
  requireTenantId(tenantId);
  return call('submit_financial_payment', { p_tenant_id: tenantId, p_payment_id: paymentId }, 'تعذر إرسال الدفعة.');
}

export function confirmFinancialPayment({ tenantId, paymentId } = {}) {
  requireTenantId(tenantId);
  return call('confirm_financial_payment', { p_tenant_id: tenantId, p_payment_id: paymentId }, 'تعذر تأكيد الدفعة.');
}

export function postFinancialPayment({ tenantId, paymentId, paymentPurpose } = {}) {
  requireTenantId(tenantId);
  return call('post_financial_payment', {
    p_tenant_id: tenantId,
    p_payment_id: paymentId,
    p_payment_purpose: paymentPurpose,
  }, 'تعذر ترحيل الدفعة محاسبيًا.');
}

export function rejectFinancialPayment({ tenantId, paymentId, reason } = {}) {
  requireTenantId(tenantId);
  return call('reject_financial_payment', { p_tenant_id: tenantId, p_payment_id: paymentId, p_reason: reason }, 'تعذر رفض الدفعة.');
}

export function reverseFinancialPayment({ tenantId, paymentId, reason } = {}) {
  requireTenantId(tenantId);
  return call('reverse_financial_payment', { p_tenant_id: tenantId, p_payment_id: paymentId, p_reason: reason }, 'تعذر عكس حالة الدفعة.');
}

export function getFinancialPayment({ tenantId, paymentId } = {}) {
  requireTenantId(tenantId);
  return call('get_financial_payment', { p_tenant_id: tenantId, p_payment_id: paymentId }, 'تعذر تحميل الدفعة.');
}

export function listFinancialPayments({ tenantId, limit = 50, offset = 0, ...filters } = {}) {
  requireTenantId(tenantId);
  return call('list_financial_payments', {
    p_tenant_id: tenantId, p_status: filters.status ?? null,
    p_direction: filters.direction ?? null, p_payment_method_id: filters.paymentMethodId ?? null,
    p_money_destination_id: filters.moneyDestinationId ?? null, p_partner_id: filters.partnerId ?? null,
    p_branch_id: filters.branchId ?? null, p_source_app: filters.sourceApp ?? null,
    p_source_model: filters.sourceModel ?? null, p_source_id: filters.sourceId ?? null,
    p_payment_number: filters.paymentNumber ?? null, p_created_from: filters.createdFrom ?? null,
    p_created_to: filters.createdTo ?? null, p_created_by: filters.createdBy ?? null,
    p_limit: limit, p_offset: offset,
  }, 'تعذر تحميل الدفعات.');
}

export function listAllocatableOpenItems({ tenantId, paymentId, limit = 50, offset = 0 } = {}) {
  requireTenantId(tenantId);
  return call('list_allocatable_open_items_for_payment', {
    p_tenant_id: tenantId, p_payment_id: paymentId,
    p_limit: limit, p_offset: offset,
  }, 'تعذر تحميل البنود المفتوحة القابلة للتخصيص.');
}

export function allocatePayment({ tenantId, paymentId, targetAccountLineId, amount, idempotencyKey } = {}) {
  requireTenantId(tenantId);
  return call('allocate_financial_payment', {
    p_tenant_id: tenantId, p_payment_id: paymentId,
    p_target_account_line_id: targetAccountLineId,
    p_amount: amount, p_idempotency_key: idempotencyKey,
  }, 'تعذر تخصيص الدفعة.');
}

export function unallocatePayment({ tenantId, allocationId, reason } = {}) {
  requireTenantId(tenantId);
  return call('unallocate_financial_payment_allocation', {
    p_tenant_id: tenantId, p_allocation_id: allocationId, p_reason: reason,
  }, 'تعذر فك تخصيص الدفعة.');
}

export function getPaymentAllocationSummary({ tenantId, paymentId } = {}) {
  requireTenantId(tenantId);
  return call('get_financial_payment_allocation_summary', {
    p_tenant_id: tenantId, p_payment_id: paymentId,
  }, 'تعذر تحميل ملخص تخصيص الدفعة.');
}
