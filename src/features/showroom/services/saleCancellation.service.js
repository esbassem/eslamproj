import { requireSupabase } from '@/core/lib/supabase';

function requireId(value, message) {
  if (!value) throw new Error(message);
}

export async function previewSaleCancellation({ tenantId, saleId } = {}) {
  requireId(tenantId, 'لا توجد شركة نشطة.');
  requireId(saleId, 'تعذر تحديد الفاتورة.');

  const client = requireSupabase();
  const { data, error } = await client.rpc('preview_showroom_sale_cancellation', {
    p_tenant_id: tenantId,
    p_sale_id: saleId,
  });

  if (error) throw error;
  if (!data?.preview_version) {
    throw new Error('تعذر تحميل معاينة إلغاء الفاتورة.');
  }
  return data;
}

export async function cancelSale({
  tenantId,
  saleId,
  reason,
  previewVersion,
} = {}) {
  requireId(tenantId, 'لا توجد شركة نشطة.');
  requireId(saleId, 'تعذر تحديد الفاتورة.');
  requireId(previewVersion, 'يجب إعادة فحص الفاتورة قبل الإلغاء.');

  const normalizedReason = String(reason || '').trim();
  if (!normalizedReason) throw new Error('سبب الإلغاء إلزامي.');

  const client = requireSupabase();
  const { data, error } = await client.rpc('cancel_showroom_sale', {
    p_tenant_id: tenantId,
    p_sale_id: saleId,
    p_reason: normalizedReason,
    p_preview_version: previewVersion,
  });

  if (error) throw error;
  if (data?.status !== 'cancelled') {
    throw new Error('لم يكتمل إلغاء الفاتورة.');
  }
  return data;
}

export const saleCancellationService = {
  previewSaleCancellation,
  cancelSale,
};
