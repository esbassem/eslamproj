import { getPaperworkDocumentStatusLabel, getPaperworkStageLabel } from '@/features/paperwork/services/internal/paperworkDataSupport';

export const REQUEST_FILTERS = Object.freeze([
  { id: 'all', label: 'الكل' },
  { id: 'action', label: 'يحتاج إجراء' },
  { id: 'preparation', label: 'تجهيز' },
  { id: 'sent_to_processor', label: 'عند الجهة' },
  { id: 'received_from_processor', label: 'وصل' },
  { id: 'delivered', label: 'مكتمل' },
  { id: 'cancelled', label: 'ملغي' },
]);

export const DOCUMENT_FILTERS = Object.freeze([
  { id: 'all', label: 'الكل' },
  { id: 'in_custody', label: 'في الحيازة' },
  { id: 'delivered', label: 'تم التسليم' },
  { id: 'cancelled', label: 'ملغي' },
]);

export function getRequestPrimaryAction(request) {
  const actions = {
    preparation: { id: 'send', label: 'إرسال إلى الجهة' },
    sent_to_processor: { id: 'receive', label: 'استلام من الجهة' },
    received_from_processor: { id: 'deliver', label: 'تسليم للعميل' },
    pending_processor_cancellation: { id: 'processor_cancellation', label: 'متابعة إلغاء الجهة' },
    delivered: { id: 'done', label: 'تم التسليم', disabled: true },
  };
  return actions[request?.currentStage] || null;
}

export function requestSummaryViewModel(row, maps = {}) {
  const customer = maps.partners?.get(row.customer_id);
  const processor = maps.partners?.get(row.processor_partner_id);
  const owner = maps.partners?.get(row.document_owner_partner_id);
  const unit = maps.units?.get(row.tracking_unit_id);
  const product = maps.products?.get(unit?.product_product_id);
  const identifiers = maps.identifiers?.get(row.tracking_unit_id) || [];
  return {
    id: row.id,
    shortNumber: row.id.slice(0, 8).toUpperCase(),
    status: row.status,
    currentStage: row.current_stage,
    stageLabel: getPaperworkStageLabel(row.current_stage),
    customerName: customer?.name || 'عميل غير محدد',
    ownerName: row.document_owner_name || owner?.name || '',
    processorId: row.processor_partner_id,
    processorName: processor?.name || 'جهة غير محددة',
    productName: product?.display_name || product?.sku || unit?.tracking_number || 'قطعة غير محددة',
    trackingNumber: unit?.tracking_number || '',
    identifiers,
    branchId: row.branch_id,
    updatedAt: row.updated_at,
    stageEnteredAt: row.stage_entered_at,
  };
}

export function documentSummaryViewModel(row, maps = {}) {
  const unit = maps.units?.get(row.tracking_unit_id);
  const product = maps.products?.get(unit?.product_product_id);
  return {
    id: row.id,
    title: row.document_title || row.manual_item_description || product?.display_name || 'مستند بدون عنوان',
    type: row.document_type || 'document',
    status: row.status,
    statusLabel: getPaperworkDocumentStatusLabel(row.status),
    ownerName: row.document_owner_name || maps.partners?.get(row.owner_partner_id)?.name || 'غير مسجل',
    requestId: row.paperwork_request_id,
    trackingUnitId: row.tracking_unit_id,
    productName: product?.display_name || product?.sku || '',
    trackingNumber: unit?.tracking_number || '',
    identifiers: maps.identifiers?.get(row.tracking_unit_id) || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
