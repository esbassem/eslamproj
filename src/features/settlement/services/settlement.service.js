import { requireSupabase } from '@/core/lib/supabase';
import {
  buildSettlementOptionsRpcArgs,
  buildSettleObligationRpcArgs,
  normalizeSettlementError,
  normalizeSettlementOptions,
  normalizeSettlementResult,
} from './settlement.model';

export async function getSettlementOptions({ targetType, targetId } = {}) {
  const args = buildSettlementOptionsRpcArgs({ targetType, targetId });
  const { data, error } = await requireSupabase().rpc('get_settlement_options', args);
  if (error) throw normalizeSettlementError(error, 'تعذر تحميل خيارات التحصيل.');
  return normalizeSettlementOptions(data, { targetType, targetId });
}

export async function settleObligation(input = {}) {
  const args = buildSettleObligationRpcArgs(input);
  const { data, error } = await requireSupabase().rpc('settle_obligation', args);
  if (error) throw normalizeSettlementError(error);
  return normalizeSettlementResult(data);
}

export const settlementService = {
  getSettlementOptions,
  settleObligation,
};
