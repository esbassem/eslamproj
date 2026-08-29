import { requireSupabase } from '@/core/lib/supabase';

function requireTenantId(tenantId) {
  if (!tenantId) throw new Error('لا توجد شركة نشطة.');
}

async function call(contract, parameters, fallbackMessage) {
  const { data, error } = await requireSupabase().rpc(contract, parameters);
  if (error) throw new Error(error.message || fallbackMessage);
  return data;
}

export function createInternalTransfer({
  tenantId, sourceDestinationId, destinationDestinationId, amount,
  transferMode, idempotencyKey, currencyCode = 'EGP',
  sourceBranchId = null, destinationBranchId = null,
  referenceNumber = null, notes = null,
} = {}) {
  requireTenantId(tenantId);
  return call('create_internal_transfer', {
    p_tenant_id: tenantId,
    p_source_destination_id: sourceDestinationId,
    p_destination_destination_id: destinationDestinationId,
    p_amount: amount,
    p_transfer_mode: transferMode,
    p_idempotency_key: idempotencyKey,
    p_currency_code: currencyCode,
    p_source_branch_id: sourceBranchId,
    p_destination_branch_id: destinationBranchId,
    p_reference_number: referenceNumber,
    p_notes: notes,
  }, 'تعذر إنشاء التحويل الداخلي.');
}

function transition(contract, fallbackMessage, { tenantId, transferId, idempotencyKey } = {}) {
  requireTenantId(tenantId);
  return call(contract, {
    p_tenant_id: tenantId,
    p_transfer_id: transferId,
    p_idempotency_key: idempotencyKey,
  }, fallbackMessage);
}

export const sendInternalTransfer = (input) => transition('send_internal_transfer', 'تعذر إرسال التحويل الداخلي.', input);
export const receiveInternalTransfer = (input) => transition('receive_internal_transfer', 'تعذر استلام التحويل الداخلي.', input);
export const confirmInternalTransfer = (input) => transition('confirm_internal_transfer', 'تعذر تأكيد التحويل الداخلي.', input);

export function getInternalTransfer({ tenantId, transferId } = {}) {
  requireTenantId(tenantId);
  return call('get_internal_transfer', { p_tenant_id: tenantId, p_transfer_id: transferId }, 'تعذر تحميل التحويل الداخلي.');
}

export function listInternalTransfers({ tenantId, status = null, mode = null, limit = 50, offset = 0 } = {}) {
  requireTenantId(tenantId);
  return call('list_internal_transfers', {
    p_tenant_id: tenantId, p_status: status, p_mode: mode,
    p_limit: limit, p_offset: offset,
  }, 'تعذر تحميل التحويلات الداخلية.');
}
