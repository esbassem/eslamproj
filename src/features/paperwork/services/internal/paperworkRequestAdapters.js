import { requireSupabase } from '@/core/lib/supabase';
import { invokePaperworkNotification } from '@/core/notifications/paperworkNotifications';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';
import { invalidateVaultPaperworkCache } from '@/features/paperwork/services/vaultPaperworkCache';
import * as Core from './paperworkDataCore';
import { mergeTrackingIdentifiers } from './paperworkSalesIntegration';

const { getPaperworkStageLabel, formatPaperAttributesTextForService } = Core;

export function normalizePaperworkRequest(record, maps = {}) {
  const saleLine = maps.saleLinesMap?.get(record.sale_line_id) || null;
  const trackingUnit = maps.trackingUnitsMap?.get(record.tracking_unit_id) || null;
  const productProductId = trackingUnit?.product_product_id || saleLine?.product_product_id || null;
  const product = maps.productMap?.get(productProductId) || null;
  const trackingDetails = maps.trackingDetailsMap?.get(record.tracking_unit_id) || {};
  const productName = saleLine?.description || product?.displayName || product?.sku || 'طلب أوراق';
  const events = maps.eventsMap?.get(record.id) || [];
  const replacementCancellationEvent = events.find((event) => ['processor_cancellation_required_by_sale_return', 'processor_cancellation_required_by_sale_replacement'].includes(event.eventType)) || null;
  let replacementContext = null;
  if (replacementCancellationEvent?.notes) {
    try {
      replacementContext = JSON.parse(replacementCancellationEvent.notes);
    } catch {
      replacementContext = null;
    }
  }
  const deliveryEvent = events.find((event) => event.eventType === 'done' || event.newStatus === 'done') || null;
  const trackingUnitDetails = trackingDetails.trackingUnit || (trackingUnit ? {
    id: trackingUnit.id,
    trackingNumber: trackingUnit.tracking_number || '',
    status: trackingUnit.status || '',
  } : null);

  return {
    id: record.id,
    tenantId: record.tenant_id,
    branchId: record.branch_id,
    requestSource: record.request_source || 'manual',
    requestType: record.request_type || 'new_document',
    saleId: record.sale_id,
    saleLineId: record.sale_line_id,
    trackingUnitId: record.tracking_unit_id,
    customerId: record.customer_id,
    documentOwnerPartnerId: record.document_owner_partner_id,
    documentOwnerName: record.document_owner_name || '',
    documentOwnerNationalId: record.document_owner_national_id || '',
    documentOwnerStatus: record.document_owner_status || '',
    documentOwnerNote: record.document_owner_note || '',
    processorPartnerId: record.processor_partner_id,
    trackingPhotosIgnored: Boolean(record.tracking_photos_ignored),
    trackingPhotosIgnoreReason: record.tracking_photos_ignore_reason || '',
    currentStage: record.current_stage || '',
    stageEnteredAt: record.stage_entered_at,
    customerNotifiedAt: record.customer_notified_at,
    customerNotifiedBy: record.customer_notified_by,
    customerNotifiedByName: maps.usersMap?.get(record.customer_notified_by)?.name || '',
    customerNotificationChannel: record.customer_notification_channel || '',
    customerNotificationNotes: record.customer_notification_notes || '',
    assignedTo: record.assigned_to,
    status: record.status || 'open',
    priority: record.priority || 'normal',
    blockedReason: record.blocked_reason || '',
    deferredReason: record.deferred_reason || '',
    cancelReason: record.cancel_reason || '',
    saleReturnOperationId: record.sale_return_operation_id || null,
    replacedPaperworkRequestId: record.replaced_paperwork_request_id || null,
    processorCancellationBlockingRequestId: record.processor_cancellation_blocking_request_id || null,
    processorCancellationRequestedAt: record.processor_cancellation_requested_at || null,
    processorCancellationConfirmedAt: record.processor_cancellation_confirmed_at || null,
    processorCancellationConfirmedBy: record.processor_cancellation_confirmed_by || null,
    processorCancellationConfirmationNotes: record.processor_cancellation_confirmation_notes || '',
    replacementContext,
    notes: record.notes || '',
    createdBy: record.created_by,
    createdByName: maps.usersMap?.get(record.created_by)?.name || '',
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    closedAt: record.closed_at,
    events,
    deliveryEvent,
    deliveryEventCreatedBy: deliveryEvent?.createdBy || null,
    deliveryEventCreatedByName: deliveryEvent?.createdByName || '',
    deliveryEventCreatedAt: deliveryEvent?.createdAt || null,
    deliveryEventNotes: deliveryEvent?.notes || '',
    customer: maps.partnersMap?.get(record.customer_id) || null,
    documentOwner: maps.partnersMap?.get(record.document_owner_partner_id) || null,
    processor: maps.partnersMap?.get(record.processor_partner_id) || null,
    stage: record.current_stage ? {
      code: record.current_stage,
      name: getPaperworkStageLabel(record.current_stage),
    } : null,
    productProductId,
    productName,
    attributes: maps.trackingUnitAttributesMap?.get(record.tracking_unit_id) || [],
    attributesText: formatPaperAttributesTextForService(maps.trackingUnitAttributesMap?.get(record.tracking_unit_id) || []),
    trackingUnit: trackingUnitDetails,
    trackingIdentifiers: mergeTrackingIdentifiers(product?.expectedTrackingIdentifiers || [], trackingDetails.trackingIdentifiers || []),
    license: trackingDetails.license || null,
    attachments: trackingDetails.attachments || {},
    ownerAttachments: maps.ownerAttachmentsMap?.get(record.id) || {},
  };
}
