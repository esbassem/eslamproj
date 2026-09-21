import { requireSupabase } from '@/core/lib/supabase';
import {
  normalizeSaleExchangeEligibility,
  normalizeSaleExchangeResult,
  SALE_EXCHANGE_MESSAGES,
} from '@/features/sales/services/salesExchange.model';

async function rpc(name, params, normalize) {
  const { data, error } = await requireSupabase().rpc(name, params);
  if (error) {
    const diagnostic = `${error.message || ''} ${error.details || ''}`;
    const code = Object.keys(SALE_EXCHANGE_MESSAGES).find((item) => diagnostic.includes(item))
      || (diagnostic.includes('SALE_RETURN_') ? 'SALE_HAS_NO_RETURNABLE_LINES' : 'SALE_EXCHANGE_REQUEST_FAILED');
    const normalized = new Error(SALE_EXCHANGE_MESSAGES[code] || 'تعذر إكمال الاستبدال. حاول مرة أخرى.');
    normalized.code = code;
    normalized.cause = error;
    throw normalized;
  }
  return normalize(data);
}

export async function getSaleExchangeEligibility({ tenantId, saleId } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('get_sale_exchange_eligibility', { p_sale_id: saleId }, normalizeSaleExchangeEligibility);
}

export async function startSaleExchange({ tenantId, payload, idempotencyKey } = {}) {
  if (!tenantId || !payload?.originalSaleId) throw new Error('بيانات الاستبدال غير مكتملة.');
  return rpc('start_sale_exchange', {
    p_original_sale_id: payload.originalSaleId,
    p_expected_version: payload.expectedVersion,
    p_return_lines: payload.returnLines,
    p_replacement_lines: payload.replacementLines,
    p_return_destination_location_id: payload.returnDestinationLocationId,
    p_replacement_location_id: payload.replacementLocationId,
    p_reason: payload.reason,
    p_idempotency_key: idempotencyKey,
  }, normalizeSaleExchangeResult);
}

export const salesExchangeService = Object.freeze({
  getSaleExchangeEligibility,
  startSaleExchange,
});
