import { requireSupabase } from '@/core/lib/supabase';
import { normalizeSaleRefundOptions, normalizeSaleRefundResult, normalizeSaleReturnEligibility, normalizeSaleReturnResult } from '@/features/sales/services/salesReturn.model';

const MESSAGES = Object.freeze({
  SALES_RETURN_DENIED: 'ليس لديك صلاحية تسجيل مرتجع.',
  SALES_RETURN_VIEW_DENIED: 'ليس لديك صلاحية عرض المرتجعات.',
  SALES_RETURN_INPUT_INVALID: 'بيانات المرتجع غير مكتملة.',
  SALE_RETURN_LINES_INVALID: 'اختر بنودًا صحيحة للمرتجع.',
  SALE_RETURN_EXCEEDS_DELIVERED_QUANTITY: 'الكمية المطلوبة أكبر من المسلّم غير المرتجع.',
  SALE_RETURN_SERIAL_NOT_RETURNABLE: 'القطعة لم تُسلّم أو سبق إرجاعها.',
  SALE_RETURN_DESTINATION_DENIED: 'موقع استلام المرتجع غير مسموح.',
  SALES_RETURN_IDEMPOTENCY_CONFLICT: 'تعارضت محاولة المرتجع مع طلب سابق.',
  SALES_VERSION_CONFLICT: 'تم تحديث البيع من مستخدم آخر.',
  SALES_REFUND_DENIED: 'ليست لديك صلاحية رد أموال من المورد المالي.',
  SALES_REFUND_INPUT_INVALID: 'بيانات رد المبلغ غير مكتملة.',
  SALES_REFUND_EXCEEDS_REFUNDABLE: 'المبلغ المطلوب أكبر من الرصيد القابل للرد.',
  SALES_REFUND_IDEMPOTENCY_CONFLICT: 'تعارضت محاولة رد المبلغ مع طلب سابق.',
  FINANCIAL_AUTHORIZATION_DENIED: 'نطاق الصلاحية المالية أو المورد المالي لا يسمح بهذه العملية.',
});

async function rpc(name, params, normalize) {
  const { data, error } = await requireSupabase().rpc(name, params);
  if (error) {
    const diagnostic = `${error.message || ''} ${error.details || ''}`;
    const code = Object.keys(MESSAGES).find((item) => diagnostic.includes(item)) || 'SALES_RETURN_REQUEST_FAILED';
    const normalized = new Error(MESSAGES[code] || 'تعذر إكمال العملية. حاول مرة أخرى.');
    normalized.code = code; normalized.cause = error; throw normalized;
  }
  return normalize(data);
}

export async function getSaleReturnEligibility({ tenantId, saleId } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('get_sale_return_eligibility', { p_sale_id: saleId }, normalizeSaleReturnEligibility);
}
export async function returnSale({ tenantId, saleId, expectedVersion, returnLines, destinationLocationId, reason, idempotencyKey } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('return_sale', { p_sale_id: saleId, p_expected_version: expectedVersion, p_return_lines: returnLines, p_destination_location_id: destinationLocationId || null, p_reason: reason, p_idempotency_key: idempotencyKey }, normalizeSaleReturnResult);
}
export async function getSaleRefundOptions({ tenantId, saleId } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('get_sale_refund_options', { p_sale_id: saleId }, normalizeSaleRefundOptions);
}
export async function refundSaleReturn({ tenantId, saleReturnId, amount, paymentMethodId, moneyDestinationId, reason, reference = '', notes = '', idempotencyKey } = {}) {
  if (!tenantId || !saleReturnId) throw new Error('بيانات المرتجع غير مكتملة.');
  return rpc('refund_sale_return', { p_sale_return_id: saleReturnId, p_amount: amount, p_payment_method_id: paymentMethodId, p_money_destination_id: moneyDestinationId, p_reason: reason, p_reference: reference || null, p_notes: notes || null, p_idempotency_key: idempotencyKey }, normalizeSaleRefundResult);
}

export const salesReturnService = Object.freeze({ getSaleReturnEligibility, returnSale, getSaleRefundOptions, refundSaleReturn });
