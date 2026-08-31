import { requireSupabase } from '@/core/lib/supabase';

async function call(name, params) {
  const { data, error } = await requireSupabase().rpc(name, params);
  if (error) throw new Error(error.message || 'تعذر تنفيذ عملية التسوية.');
  return data;
}

export const listSettleableClearingItems = ({ tenantId, paymentMethodId, currencyCode = null, branchId = null }) => call('list_settleable_clearing_items', { p_tenant: tenantId, p_method: paymentMethodId, p_currency: currencyCode, p_branch: branchId });
export const getSettlementEligibility = ({ tenantId, paymentMethodId, items, destinationId, grossAmount, feesAmount, netAmount, currencyCode, branchId = null }) => call('get_financial_settlement_eligibility', { p_tenant: tenantId, p_method: paymentMethodId, p_items: items, p_destination: destinationId, p_gross: grossAmount, p_fees: feesAmount, p_net: netAmount, p_currency: currencyCode, p_branch: branchId });
export const createFinancialSettlement = ({ tenantId, paymentMethodId, destinationId, items, grossAmount, feesAmount, netAmount, currencyCode, settlementDate, idempotencyKey, branchId = null, reference = null, externalReference = null }) => call('create_financial_settlement', { p_tenant: tenantId, p_method: paymentMethodId, p_destination: destinationId, p_items: items, p_gross: grossAmount, p_fees: feesAmount, p_net: netAmount, p_currency: currencyCode, p_date: settlementDate, p_idempotency: idempotencyKey, p_branch: branchId, p_reference: reference, p_external_reference: externalReference });
export const submitFinancialSettlement = ({ tenantId, settlementId }) => call('submit_financial_settlement', { p_tenant: tenantId, p_settlement: settlementId });
export const confirmFinancialSettlement = ({ tenantId, settlementId }) => call('confirm_financial_settlement', { p_tenant: tenantId, p_settlement: settlementId });
export const postFinancialSettlement = ({ tenantId, settlementId, idempotencyKey }) => call('post_financial_settlement', { p_tenant: tenantId, p_settlement: settlementId, p_idempotency: idempotencyKey });
