import { requireSupabase } from '@/core/lib/supabase';
import { invokePaperworkNotification } from '@/core/notifications/paperworkNotifications';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';
import { invalidateVaultPaperworkCache } from '@/features/paperwork/services/vaultPaperworkCache';
import * as Support from '@/features/paperwork/services/internal/paperworkDataSupport';

const { TENANT_FILES_BUCKET, SIGNED_URL_EXPIRES_IN, SALE_COLUMNS, PARTNER_COLUMNS, SALE_LINE_COLUMNS, SALE_PAYMENT_MOVE_COLUMNS, PAPERWORK_REQUEST_COLUMNS, PAPERWORK_DOCUMENT_COLUMNS, VAULT_PAPERWORK_SUMMARY_COLUMNS, PAPERWORK_DOCUMENT_MOVE_COLUMNS, PAPERWORK_REQUEST_EVENT_COLUMNS, TENANT_USER_COLUMNS, PAPERWORK_STAGE_LABELS, PAPERWORK_DOCUMENT_MOVE_DIRECTION_LABELS, PAPERWORK_DOCUMENT_SOURCE_LABELS, PAPERWORK_DOCUMENT_STATUS_LABELS, getPaperworkStageLabel, requireTenantId, requireSaleId, toNumber, getFileExtension, assertPaperworkImage, isStorageImage, normalizeStoragePath, listTenantStorageImages, normalizeCustomer, mergeAttributes, mergeTrackingIdentifiers, normalizeSaleLine, loadTrackingUnitAttributesMap, loadProductsMap, loadExpectedTrackingIdentifiersByCategoryId, loadLineAttributesMap, loadVariantAttributesMap, loadTrackingDetailsMap, normalizeSalePayment, normalizeSale, loadCustomersMap, loadSaleLinesMap, loadSalePaymentsMap, loadSaleAccountingMap, loadPaperworkDocumentInvoiceMap, loadPaperworkPartnersMap, loadPaperworkSaleLinesMap, loadPaperworkTrackingUnitsMap, loadPartnersByIdsMap, loadTenantUsersByIdsMap, loadPaperworkRequestEventsMap, loadPaperworkDocumentAttachmentsMap, loadPaperworkRequestOwnerAttachmentsMap, getMovePartyLabel, parseRetrospectiveMoveNotes, normalizePaperworkDocumentMove, normalizePaperworkDocument, normalizePaperworkRequest, formatPaperAttributesTextForService } = Support;

export const paperworkRequestsService = {
  async listPaperworkRequests({ tenantId, limit = 150, requestId = null, includeDetails = true } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    let requests = [];
    const buildRequestQuery = () => {
      let query = client
        .from('paperwork_requests')
        .select(PAPERWORK_REQUEST_COLUMNS)
        .eq('tenant_id', tenantId);
      if (requestId) query = query.eq('id', requestId);
      return query;
    };

    if (limit == null) {
      const pageSize = 500;
      let pageStart = 0;

      while (true) {
        const { data, error } = await buildRequestQuery()
          .order('created_at', { ascending: false })
          .range(pageStart, pageStart + pageSize - 1);

        if (error) throw error;

        const page = data || [];
        requests.push(...page);
        if (page.length < pageSize) break;
        pageStart += pageSize;
      }
    } else {
      const { data, error } = await buildRequestQuery()
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      requests = data || [];
    }
    const [partnersMap, saleLinesMap, trackingUnitsMap, eventsMap, ownerAttachmentsMap, usersMap] = await Promise.all([
      loadPaperworkPartnersMap(client, tenantId, requests),
      loadPaperworkSaleLinesMap(client, tenantId, requests),
      loadPaperworkTrackingUnitsMap(client, tenantId, requests),
      includeDetails
        ? loadPaperworkRequestEventsMap(client, tenantId, requests)
        : loadPaperworkRequestEventsMap(client, tenantId, requests.filter((request) => request.current_stage === 'pending_processor_cancellation')),
      includeDetails ? loadPaperworkRequestOwnerAttachmentsMap(client, tenantId, requests.map((request) => request.id)) : Promise.resolve(new Map()),
      includeDetails
        ? loadTenantUsersByIdsMap(
          client,
          tenantId,
          requests.flatMap((request) => [
            request.created_by,
          ]).filter(Boolean),
        )
        : Promise.resolve(new Map()),
    ]);

    const contextLines = requests.map((request) => {
      const saleLine = saleLinesMap.get(request.sale_line_id) || null;
      const trackingUnit = trackingUnitsMap.get(request.tracking_unit_id) || null;

      return {
        id: saleLine?.id || request.id,
        product_product_id: trackingUnit?.product_product_id || saleLine?.product_product_id || null,
        tracking_unit_id: request.tracking_unit_id,
      };
    });

    const [productMap, trackingDetailsMap, trackingUnitAttributesMap] = await Promise.all([
      loadProductsMap(client, tenantId, contextLines),
      loadTrackingDetailsMap(client, tenantId, contextLines),
      loadTrackingUnitAttributesMap(client, tenantId, contextLines),
    ]);

    return requests.map((request) => normalizePaperworkRequest(request, {
      partnersMap,
      saleLinesMap,
      trackingUnitsMap,
      productMap,
      trackingDetailsMap,
      trackingUnitAttributesMap,
      eventsMap,
      ownerAttachmentsMap,
      usersMap,
    }));
  },

  async getPaperworkRequestDetails({ tenantId, requestId } = {}) {
    requireTenantId(tenantId);
    if (!requestId) throw new Error('تعذر تحديد طلب الأوراق.');
    const requests = await this.listPaperworkRequests({
      tenantId,
      requestId,
      limit: 1,
      includeDetails: false,
    });
    if (!requests[0]) throw new Error('طلب الأوراق غير موجود.');
    return requests[0];
  },

  async findOpenPaperworkRequestsForTrackingUnit({ tenantId, trackingUnitId } = {}) {
    requireTenantId(tenantId);
    if (!trackingUnitId) return [];

    const client = requireSupabase();
    const { data, error } = await client
      .from('paperwork_requests')
      .select(`
        id,
        branch_id,
        request_source,
        request_type,
        sale_id,
        tracking_unit_id,
        customer_id,
        document_owner_partner_id,
        document_owner_name,
        processor_partner_id,
        assigned_to,
        current_stage,
        status,
        created_at
      `)
      .eq('tenant_id', tenantId)
      .eq('tracking_unit_id', trackingUnitId)
      .eq('status', 'open')
      .in('current_stage', [
        'preparation',
        'sent_to_processor',
        'received_from_processor',
      ])
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      throw error;
    }

    const requests = data || [];
    const partnerIds = requests.flatMap((request) => [
      request.customer_id,
      request.document_owner_partner_id,
      request.processor_partner_id,
    ]).filter(Boolean);
    const saleIds = Array.from(new Set(requests.map((request) => request.sale_id).filter(Boolean)));
    const branchIds = Array.from(new Set(requests.map((request) => request.branch_id).filter(Boolean)));
    const assignedUserIds = requests.map((request) => request.assigned_to).filter(Boolean);

    const [partnersMap, usersMap, salesResult, branchesResult] = await Promise.all([
      loadPartnersByIdsMap(client, tenantId, partnerIds),
      loadTenantUsersByIdsMap(client, tenantId, assignedUserIds),
      saleIds.length
        ? client
          .from('showroom_sales')
          .select('id, sale_number')
          .eq('tenant_id', tenantId)
          .in('id', saleIds)
        : Promise.resolve({ data: [], error: null }),
      branchIds.length
        ? client
          .from('branches')
          .select('id, name')
          .eq('tenant_id', tenantId)
          .in('id', branchIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (salesResult.error) throw salesResult.error;
    if (branchesResult.error) throw branchesResult.error;

    const salesMap = new Map((salesResult.data || []).map((sale) => [sale.id, sale]));
    const branchesMap = new Map((branchesResult.data || []).map((branch) => [branch.id, branch]));

    return requests.map((request) => ({
      id: request.id,
      shortNumber: request.id.slice(0, 8).toUpperCase(),
      requestSource: request.request_source || 'manual',
      requestType: request.request_type || 'new_document',
      saleId: request.sale_id || null,
      saleNumber: salesMap.get(request.sale_id)?.sale_number || '',
      trackingUnitId: request.tracking_unit_id,
      currentStage: request.current_stage,
      stageName: getPaperworkStageLabel(request.current_stage),
      status: request.status,
      customerName: partnersMap.get(request.customer_id)?.name || '',
      ownerName: request.document_owner_name
        || partnersMap.get(request.document_owner_partner_id)?.name
        || '',
      documentOwnerName: request.document_owner_name || '',
      documentOwnerPartnerId: request.document_owner_partner_id || null,
      processorName: partnersMap.get(request.processor_partner_id)?.name || '',
      assignedToName: usersMap.get(request.assigned_to)?.name || '',
      branchName: branchesMap.get(request.branch_id)?.name || '',
      createdAt: request.created_at,
    }));
  }
};
