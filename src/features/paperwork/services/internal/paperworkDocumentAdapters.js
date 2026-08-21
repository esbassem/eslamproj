import { requireSupabase } from '@/core/lib/supabase';
import { invokePaperworkNotification } from '@/core/notifications/paperworkNotifications';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';
import { invalidateVaultPaperworkCache } from '@/features/paperwork/services/vaultPaperworkCache';
import * as Core from './paperworkDataCore';
import { mergeTrackingIdentifiers } from './paperworkSalesIntegration';

export function getMovePartyLabel({ userId, partnerId, location, usersMap, partnersMap }) {
  if (userId) {
    return usersMap?.get(userId)?.name || 'مستخدم غير محدد';
  }

  if (partnerId) {
    return partnersMap?.get(partnerId)?.name || 'جهة غير محددة';
  }

  return location || 'غير محدد';
}

export function parseRetrospectiveMoveNotes(value) {
  const text = value || '';
  const reason = text.match(/(?:^|\n)retrospective_reason=([^\n]*)/)?.[1]?.trim() || '';
  const notes = text.match(/(?:^|\n)retrospective_notes=([\s\S]*)/)?.[1]?.trim() || '';
  return { reason, notes };
}

export function normalizePaperworkDocumentMove(record, maps = {}) {
  const document = maps.documentsMap?.get(record.document_id) || null;
  const fallbackDirection = ['opening', 'receive', 'return', 'manual', 'manual_adjustment'].includes(record.move_type) ? 'in' : 'out';

  const retrospective = record.source_type === 'retrospective_delivery'
    ? parseRetrospectiveMoveNotes(record.notes)
    : { reason: '', notes: '' };

  return {
    id: record.id,
    tenantId: record.tenant_id,
    documentId: record.document_id,
    moveDirection: record.move_direction || fallbackDirection,
    sourceType: record.source_type || record.move_type || 'manual',
    fromUserId: record.from_user_id,
    fromPartnerId: record.from_partner_id,
    fromLocation: record.from_location || '',
    toUserId: record.to_user_id,
    toPartnerId: record.to_partner_id,
    toLocation: record.to_location || '',
    movedAt: record.moved_at,
    notes: record.notes || '',
    retrospectiveReason: retrospective.reason,
    retrospectiveNotes: retrospective.notes,
    createdBy: record.created_by,
    createdAt: record.created_at,
    documentTitle: document?.documentTitle || document?.displayTitle || 'مستند غير محدد',
    documentOwnerName: document?.documentOwnerName ?? document?.owner?.name ?? 'غير مسجل',
    ownerName: document?.documentOwnerName ?? document?.owner?.name ?? 'غير مسجل',
    documentType: document?.documentType || '',
    fromLabel: getMovePartyLabel({
      userId: record.from_user_id,
      partnerId: record.from_partner_id,
      location: record.from_location,
      usersMap: maps.usersMap,
      partnersMap: maps.partnersMap,
    }),
    toLabel: getMovePartyLabel({
      userId: record.to_user_id,
      partnerId: record.to_partner_id,
      location: record.to_location,
      usersMap: maps.usersMap,
      partnersMap: maps.partnersMap,
    }),
    createdByName: maps.usersMap?.get(record.created_by)?.name || '',
  };
}

export function normalizePaperworkDocument(record, maps = {}) {
  const trackingUnit = maps.trackingUnitsMap?.get(record.tracking_unit_id) || null;
  const product = maps.productMap?.get(trackingUnit?.product_product_id) || null;
  const trackingDetails = maps.trackingDetailsMap?.get(record.tracking_unit_id) || {};
  const moves = maps.movesMap?.get(record.id) || [];
  const jawabPhoto = maps.attachmentsMap?.get(record.id) || null;
  const latestMove = moves[0] || null;
  const owner = maps.partnersMap?.get(record.owner_partner_id) || null;
  const documentOwnerName = record.document_owner_name ?? 'غير مسجل';
  const title = record.document_title || record.manual_item_description || product?.displayName || trackingUnit?.tracking_number || 'ورقة بدون عنوان';
  const itemDescription = trackingUnit
    ? [product?.displayName, trackingUnit.tracking_number].filter(Boolean).join(' - ')
    : record.manual_item_description || '';

  return {
    id: record.id,
    tenantId: record.tenant_id,
    branchId: record.branch_id,
    documentType: record.document_type || 'document',
    documentTitle: record.document_title || '',
    documentOwnerName,
    ownerName: documentOwnerName,
    document_owner_name: documentOwnerName,
    displayTitle: title,
    trackingUnitId: record.tracking_unit_id,
    paperworkRequestId: record.paperwork_request_id,
    ownerPartnerId: record.owner_partner_id,
    manualItemDescription: record.manual_item_description || '',
    sourceType: record.source_type || 'manual',
    status: record.status || 'available',
    cancelledAt: record.cancelled_at || null,
    cancelledBy: record.cancelled_by || null,
    cancelledByName: maps.usersMap?.get(record.cancelled_by)?.name || '',
    cancellationReason: record.cancellation_reason || '',
    cancellationNotes: record.cancellation_notes || '',
    releaseAuthorizedAt: record.release_authorized_at || null,
    releaseAuthorizedBy: record.release_authorized_by || null,
    releaseAuthorizedByName: maps.usersMap?.get(record.release_authorized_by)?.name || '',
    releaseAuthorizedToPartnerId: record.release_authorized_to_partner_id || null,
    releaseAuthorizedToName: record.release_authorized_to_name || '',
    releaseAuthorizationNotes: record.release_authorization_notes || '',
    releaseAuthorizationConsumedAt: record.release_authorization_consumed_at || null,
    hasActiveReleaseAuthorization: Boolean(record.release_authorized_at && !record.release_authorization_consumed_at),
    notes: record.notes || '',
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    owner,
    trackingUnit: trackingUnit ? {
      id: trackingUnit.id,
      trackingNumber: trackingUnit.tracking_number || '',
      status: trackingUnit.status || '',
      productProductId: trackingUnit.product_product_id || null,
      dataStatus: trackingUnit.data_status || 'complete',
      incompleteReason: trackingUnit.incomplete_reason || null,
      isIncomplete: ['incomplete', 'needs_review'].includes(trackingUnit.data_status),
    } : null,
    productName: product?.displayName || product?.sku || '',
    itemDescription,
    trackingIdentifiers: mergeTrackingIdentifiers(product?.expectedTrackingIdentifiers || [], trackingDetails.trackingIdentifiers || []),
    jawabPhoto,
    moves,
    latestMove,
  };
}
