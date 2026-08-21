import { requireSupabase } from '@/core/lib/supabase';
import { invokePaperworkNotification } from '@/core/notifications/paperworkNotifications';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';
import { invalidateVaultPaperworkCache } from '@/features/paperwork/services/vaultPaperworkCache';

export const TENANT_FILES_BUCKET = 'tenant-files';
export const SIGNED_URL_EXPIRES_IN = 60 * 60;
export const SALE_COLUMNS = `
  id,
  tenant_id,
  branch_id,
  customer_id,
  sale_date,
  status,
  total_amount,
  notes,
  account_move_id,
  created_by,
  created_at,
  updated_at,
  showroom_config_id
`;

export const PARTNER_COLUMNS = 'id, name, phone1, phone2, address, national_id';
export const SALE_LINE_COLUMNS = `
  id,
  sale_id,
  product_product_id,
  tracking_unit_id,
  description,
  quantity,
  unit_price,
  total,
  ownership_name,
  created_at
`;
export const SALE_PAYMENT_MOVE_COLUMNS = `
  id,
  tenant_id,
  amount_total,
  invoice_date,
  date,
  pay_method,
  ref,
  notes,
  created_by,
  created_at
`;
export const PAPERWORK_REQUEST_COLUMNS = `
  id,
  tenant_id,
  branch_id,
  request_source,
  request_type,
  sale_id,
  sale_line_id,
  tracking_unit_id,
  customer_id,
  document_owner_partner_id,
  document_owner_name,
  document_owner_national_id,
  document_owner_status,
  document_owner_note,
  processor_partner_id,
  tracking_photos_ignored,
  tracking_photos_ignore_reason,
  current_stage,
  stage_entered_at,
  customer_notified_at,
  customer_notified_by,
  customer_notification_channel,
  customer_notification_notes,
  assigned_to,
  status,
  priority,
  blocked_reason,
  deferred_reason,
  cancel_reason,
  notes,
  created_by,
  created_at,
  updated_at,
  closed_at
`;
export const PAPERWORK_DOCUMENT_COLUMNS = `
  id,
  tenant_id,
  branch_id,
  document_type,
  document_title,
  document_owner_name,
  tracking_unit_id,
  paperwork_request_id,
  owner_partner_id,
  manual_item_description,
  source_type,
  status,
  cancelled_at,
  cancelled_by,
  cancellation_reason,
  cancellation_notes,
  release_authorized_at,
  release_authorized_by,
  release_authorized_to_partner_id,
  release_authorized_to_name,
  release_authorization_notes,
  release_authorization_consumed_at,
  notes,
  created_by,
  created_at,
  updated_at
`;
export const VAULT_PAPERWORK_SUMMARY_COLUMNS = `
  id,
  tenant_id,
  document_type,
  document_title,
  document_owner_name,
  tracking_unit_id,
  paperwork_request_id,
  owner_partner_id,
  manual_item_description,
  source_type,
  status,
  release_authorized_at,
  release_authorized_to_name,
  release_authorization_consumed_at,
  created_at,
  updated_at
`;
export const PAPERWORK_DOCUMENT_MOVE_COLUMNS = `
  id,
  tenant_id,
  document_id,
  move_direction,
  source_type,
  from_user_id,
  from_partner_id,
  from_location,
  to_user_id,
  to_partner_id,
  to_location,
  moved_at,
  notes,
  created_by,
  created_at
`;
export const PAPERWORK_REQUEST_EVENT_COLUMNS = `
  id,
  tenant_id,
  request_id,
  event_type,
  new_status,
  old_stage,
  new_stage,
  notes,
  created_by,
  created_at
`;
export const TENANT_USER_COLUMNS = 'id, full_name, email';
export const PAPERWORK_STAGE_LABELS = {
  preparation: 'تجهيز بيانات الورق',
  sent_to_processor: 'تم الإرسال للجهة',
  pending_processor_cancellation: 'بانتظار الإلغاء لدى الجهة',
  received_from_processor: 'تم استلام الورق من الجهة',
  delivered: 'تم التسليم للعميل',
  cancelled: 'ملغي',
};

export const PAPERWORK_DOCUMENT_MOVE_DIRECTION_LABELS = {
  in: 'استلام',
  out: 'خروج',
};

export const PAPERWORK_DOCUMENT_SOURCE_LABELS = {
  manual: 'استلام يدوي',
  from_processor: 'استلام من الجهة',
  to_customer: 'تسليم للعميل',
  retrospective_delivery: 'صرف سابق مسجل بأثر رجعي',
  request: 'طلب أوراق',
};

export const PAPERWORK_DOCUMENT_STATUS_LABELS = {
  in_custody: 'موجود في الخزنة',
  available: 'متاح',
  delivered: 'تم التسليم',
  out: 'خارج الخزنة',
  cancelled: 'ملغى',
};

export function getPaperworkDocumentMoveDirectionLabel(value) {
  return PAPERWORK_DOCUMENT_MOVE_DIRECTION_LABELS[value] || value || 'حركة';
}

export function getPaperworkDocumentSourceLabel(value) {
  return PAPERWORK_DOCUMENT_SOURCE_LABELS[value] || value || 'غير محدد';
}

export function getPaperworkDocumentStatusLabel(value) {
  return PAPERWORK_DOCUMENT_STATUS_LABELS[value] || value || 'غير محدد';
}

export function getPaperworkStageLabel(stageCode) {
  return PAPERWORK_STAGE_LABELS[stageCode] || stageCode || 'مرحلة غير محددة';
}

export function requireTenantId(tenantId) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة.');
  }
}

export function requireSaleId(saleId) {
  if (!saleId) {
    throw new Error('تعذر تحديد عملية البيع المطلوبة.');
  }
}

export function normalizeOptionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function getFileExtension(file) {
  const nameExtension = String(file?.name || '').split('.').pop();
  const mimeExtension = String(file?.type || '').split('/').pop();
  return (nameExtension && nameExtension !== file?.name ? nameExtension : mimeExtension || 'jpg')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase() || 'jpg';
}

export function assertPaperworkImage(file) {
  if (!file) return;
  const looksLikeImage = file.type?.startsWith('image/')
    || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(String(file.name || ''));
  if (!looksLikeImage) {
    throw new Error('يمكن رفع صورة فقط للجواب.');
  }
}

export function isStorageImage(file) {
  const mimeType = file?.metadata?.mimetype || file?.metadata?.mimeType || '';
  const name = String(file?.name || '').toLowerCase();
  return mimeType.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i.test(name);
}

export function normalizeStoragePath(value) {
  return String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/^tenant-files\//, '');
}

export async function listTenantStorageImages(client, tenantId, prefix = tenantId, images = [], depth = 0, limit = 120) {
  if (images.length >= limit || depth > 5) {
    return images;
  }

  const { data, error } = await client.storage.from(TENANT_FILES_BUCKET).list(prefix, {
    limit: 1000,
    offset: 0,
    sortBy: { column: 'created_at', order: 'desc' },
  });

  if (error) {
    throw error;
  }

  const rows = data || [];

  for (const row of rows) {
    if (!row?.name || row.name.startsWith('.') || images.length >= limit) {
      continue;
    }

    const path = `${prefix}/${row.name}`;

    if (isStorageImage(row)) {
      images.push({
        id: path,
        bucket: TENANT_FILES_BUCKET,
        path,
        documentType: '',
        name: row.name,
        mimeType: row.metadata?.mimetype || row.metadata?.mimeType || '',
        size: Number(row.metadata?.size || 0) || null,
        createdAt: row.created_at || row.updated_at || null,
        signedUrl: '',
      });
      continue;
    }

    const maybeFolder = !/\.[a-z0-9]{2,8}$/i.test(row.name);
    if (maybeFolder) {
      await listTenantStorageImages(client, tenantId, path, images, depth + 1, limit);
    }
  }

  return images;
}


export function formatPaperAttributesTextForService(attributes) {
  return (Array.isArray(attributes) ? attributes : [])
    .map((attribute) => attribute.value)
    .filter(Boolean)
    .join(' / ');
}
