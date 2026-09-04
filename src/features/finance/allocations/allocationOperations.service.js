import {
  allocatePayment,
  getPaymentAllocationSummary,
  listAllocatableOpenItems,
  unallocatePayment,
} from '../payments/canonicalPayments.service';

function normalizeOpenItem(item) {
  return {
    id: item.account_line_id,
    documentNumber: item.move_name || item.move_reference || 'مستند مالي',
    reference: item.move_reference || '',
    documentType: item.move_type || '',
    documentDate: item.move_date || null,
    dueDate: item.due_date || null,
    originalAmount: Number(item.original_amount ?? 0),
    residualAmount: Number(item.residual_amount ?? 0),
    currencyCode: item.currency_code || null,
  };
}

export async function loadPaymentAllocationWorkspace({ tenantId, paymentId } = {}) {
  const [summary, items] = await Promise.all([
    getPaymentAllocationSummary({ tenantId, paymentId }),
    listAllocatableOpenItems({ tenantId, paymentId, limit: 50, offset: 0 }),
  ]);
  return { summary, openItems: (items ?? []).map(normalizeOpenItem) };
}

export function allocatePaymentToOpenItem({ tenantId, paymentId, openItemId, amount, idempotencyKey } = {}) {
  return allocatePayment({
    tenantId,
    paymentId,
    targetAccountLineId: openItemId,
    amount,
    idempotencyKey,
  });
}

export function unallocatePaymentAllocation({ tenantId, allocationId, reason } = {}) {
  return unallocatePayment({ tenantId, allocationId, reason });
}
