import { requireSupabase } from '@/core/lib/supabase';

function requireIdentity(tenantId, id, label) {
  if (!tenantId) throw new Error('تعذر تحديد المنشأة الحالية.');
  if (!id) throw new Error(`تعذر تحديد ${label}.`);
}

export async function getSaleReceiptContext({ tenantId, saleId } = {}) {
  requireIdentity(tenantId, saleId, 'عملية البيع');
  const { data, error } = await requireSupabase().rpc('get_sale_receipt_context', { p_sale_id: saleId });
  if (error) throw new Error(error.message || 'تعذر تحميل سياق تحصيل البيع.');
  return data;
}

export async function getFinancialSourceContext({ tenantId, moveId } = {}) {
  requireIdentity(tenantId, moveId, 'الحركة المالية');
  const { data, error } = await requireSupabase().rpc('get_financial_source_context', { p_move_id: moveId });
  if (error) throw new Error(error.message || 'تعذر تحديد المصدر التجاري للحركة.');
  return data;
}

export const financialSalesContextService = {
  getSaleReceiptContext,
  getFinancialSourceContext,
};
