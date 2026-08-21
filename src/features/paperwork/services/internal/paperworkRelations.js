import { requireSupabase } from '@/core/lib/supabase';
import { invokePaperworkNotification } from '@/core/notifications/paperworkNotifications';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';
import { invalidateVaultPaperworkCache } from '@/features/paperwork/services/vaultPaperworkCache';
import * as Core from './paperworkDataCore';
import { normalizeCustomer } from './paperworkSalesIntegration';

const {
  PARTNER_COLUMNS, SALE_LINE_COLUMNS, TENANT_USER_COLUMNS,
  PAPERWORK_REQUEST_EVENT_COLUMNS, TENANT_FILES_BUCKET, SIGNED_URL_EXPIRES_IN,
} = Core;

export async function loadPaperworkPartnersMap(client, tenantId, requests) {
  const partnerIds = Array.from(new Set(
    (Array.isArray(requests) ? requests : [])
      .flatMap((request) => [
        request?.customer_id,
        request?.document_owner_partner_id,
        request?.processor_partner_id,
      ])
      .filter(Boolean),
  ));

  if (!partnerIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('partners')
    .select(PARTNER_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', partnerIds);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, partner) => {
    map.set(partner.id, normalizeCustomer(partner));
    return map;
  }, new Map());
}

export async function loadPaperworkSaleLinesMap(client, tenantId, requests) {
  const saleLineIds = Array.from(new Set(
    (Array.isArray(requests) ? requests : [])
      .map((request) => request?.sale_line_id)
      .filter(Boolean),
  ));

  if (!saleLineIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('showroom_sale_lines')
    .select(SALE_LINE_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', saleLineIds);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, line) => {
    map.set(line.id, line);
    return map;
  }, new Map());
}

export async function loadPaperworkTrackingUnitsMap(client, tenantId, requests) {
  const trackingUnitIds = Array.from(new Set(
    (Array.isArray(requests) ? requests : [])
      .map((request) => request?.tracking_unit_id)
      .filter(Boolean),
  ));

  if (!trackingUnitIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('stock_tracking_units')
    .select('id, product_product_id, tracking_number, tracking_type, status, data_status, incomplete_reason')
    .eq('tenant_id', tenantId)
    .in('id', trackingUnitIds);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, unit) => {
    map.set(unit.id, unit);
    return map;
  }, new Map());
}

export async function loadPartnersByIdsMap(client, tenantId, partnerIds = []) {
  const ids = Array.from(new Set((Array.isArray(partnerIds) ? partnerIds : []).filter(Boolean)));

  if (!ids.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('partners')
    .select(PARTNER_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', ids);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, partner) => {
    map.set(partner.id, normalizeCustomer(partner));
    return map;
  }, new Map());
}

export async function loadTenantUsersByIdsMap(client, tenantId, userIds = []) {
  const ids = Array.from(new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean)));

  if (!ids.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('tenant_users')
    .select(TENANT_USER_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('id', ids);

  if (error) {
    throw error;
  }

  return (data || []).reduce((map, user) => {
    map.set(user.id, {
      id: user.id,
      name: user.full_name || user.email || 'مستخدم غير محدد',
      email: user.email || '',
    });
    return map;
  }, new Map());
}

export async function loadPaperworkRequestEventsMap(client, tenantId, requests = []) {
  const requestIds = Array.from(new Set(
    (Array.isArray(requests) ? requests : [])
      .map((request) => request?.id)
      .filter(Boolean),
  ));

  if (!requestIds.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('paperwork_request_events')
    .select(PAPERWORK_REQUEST_EVENT_COLUMNS)
    .eq('tenant_id', tenantId)
    .in('request_id', requestIds)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const events = data || [];
  const usersMap = await loadTenantUsersByIdsMap(
    client,
    tenantId,
    events.map((event) => event.created_by).filter(Boolean),
  );

  return events.reduce((map, event) => {
    const normalizedEvent = {
      id: event.id,
      tenantId: event.tenant_id,
      requestId: event.request_id,
      eventType: event.event_type || '',
      newStatus: event.new_status || '',
      oldStage: event.old_stage || '',
      newStage: event.new_stage || '',
      notes: event.notes || '',
      createdBy: event.created_by,
      createdByName: usersMap.get(event.created_by)?.name || '',
      createdAt: event.created_at,
    };
    const current = map.get(event.request_id) || [];
    current.push(normalizedEvent);
    map.set(event.request_id, current);
    return map;
  }, new Map());
}

export async function loadPaperworkDocumentAttachmentsMap(client, tenantId, documentIds = []) {
  const ids = Array.from(new Set((Array.isArray(documentIds) ? documentIds : []).filter(Boolean)));

  if (!ids.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('ir_attachments')
    .select('id, related_id, document_type, bucket_name, file_path, original_file_name, mime_type, created_at')
    .eq('tenant_id', tenantId)
    .eq('related_model', 'paperwork_documents')
    .eq('document_type', 'jawab_photo')
    .in('related_id', ids)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rowsWithUrls = await Promise.all((data || []).map(async (row) => {
    const bucket = row.bucket_name || TENANT_FILES_BUCKET;
    const { data: signedData } = await client.storage.from(bucket).createSignedUrl(row.file_path, SIGNED_URL_EXPIRES_IN);

    return {
      id: row.id,
      documentId: row.related_id,
      documentType: row.document_type,
      bucket,
      path: row.file_path,
      name: row.original_file_name || '',
      mimeType: row.mime_type || '',
      createdAt: row.created_at || null,
      signedUrl: signedData?.signedUrl || '',
    };
  }));

  return rowsWithUrls.reduce((map, attachment) => {
    if (!map.has(attachment.documentId)) {
      map.set(attachment.documentId, attachment);
    }
    return map;
  }, new Map());
}

export async function loadPaperworkRequestOwnerAttachmentsMap(client, tenantId, requestIds = []) {
  const ids = Array.from(new Set((Array.isArray(requestIds) ? requestIds : []).filter(Boolean)));

  if (!ids.length) {
    return new Map();
  }

  const { data, error } = await client
    .from('ir_attachments')
    .select('id, related_id, document_type, bucket_name, file_path, original_file_name, mime_type, created_at')
    .eq('tenant_id', tenantId)
    .eq('related_model', 'paperwork_requests')
    .in('document_type', ['document_owner_id_card', 'document_owner_id_front', 'document_owner_id_back'])
    .in('related_id', ids)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const rowsWithUrls = await Promise.all((data || []).map(async (row) => {
    const bucket = row.bucket_name || TENANT_FILES_BUCKET;
    const { data: signedData } = await client.storage.from(bucket).createSignedUrl(row.file_path, SIGNED_URL_EXPIRES_IN);

    return {
      id: row.id,
      requestId: row.related_id,
      documentType: row.document_type,
      name: row.original_file_name || '',
      signedUrl: signedData?.signedUrl || '',
    };
  }));

  return rowsWithUrls.reduce((map, attachment) => {
    const current = map.get(attachment.requestId) || {};
    current[attachment.documentType] = attachment;
    map.set(attachment.requestId, current);
    return map;
  }, new Map());
}
