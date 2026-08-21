import { requireSupabase } from '@/core/lib/supabase';
import { invokePaperworkNotification } from '@/core/notifications/paperworkNotifications';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';
import { invalidateVaultPaperworkCache } from '@/features/paperwork/services/vaultPaperworkCache';
import * as Support from '@/features/paperwork/services/internal/paperworkDataSupport';

const { TENANT_FILES_BUCKET, SIGNED_URL_EXPIRES_IN, SALE_COLUMNS, PARTNER_COLUMNS, SALE_LINE_COLUMNS, SALE_PAYMENT_MOVE_COLUMNS, PAPERWORK_REQUEST_COLUMNS, PAPERWORK_DOCUMENT_COLUMNS, VAULT_PAPERWORK_SUMMARY_COLUMNS, PAPERWORK_DOCUMENT_MOVE_COLUMNS, PAPERWORK_REQUEST_EVENT_COLUMNS, TENANT_USER_COLUMNS, PAPERWORK_STAGE_LABELS, PAPERWORK_DOCUMENT_MOVE_DIRECTION_LABELS, PAPERWORK_DOCUMENT_SOURCE_LABELS, PAPERWORK_DOCUMENT_STATUS_LABELS, getPaperworkStageLabel, requireTenantId, requireSaleId, toNumber, getFileExtension, assertPaperworkImage, isStorageImage, normalizeStoragePath, listTenantStorageImages, normalizeCustomer, mergeAttributes, mergeTrackingIdentifiers, normalizeSaleLine, loadTrackingUnitAttributesMap, loadProductsMap, loadExpectedTrackingIdentifiersByCategoryId, loadLineAttributesMap, loadVariantAttributesMap, loadTrackingDetailsMap, normalizeSalePayment, normalizeSale, loadCustomersMap, loadSaleLinesMap, loadSalePaymentsMap, loadSaleAccountingMap, loadPaperworkDocumentInvoiceMap, loadPaperworkPartnersMap, loadPaperworkSaleLinesMap, loadPaperworkTrackingUnitsMap, loadPartnersByIdsMap, loadTenantUsersByIdsMap, loadPaperworkRequestEventsMap, loadPaperworkDocumentAttachmentsMap, loadPaperworkRequestOwnerAttachmentsMap, getMovePartyLabel, parseRetrospectiveMoveNotes, normalizePaperworkDocumentMove, normalizePaperworkDocument, normalizePaperworkRequest, formatPaperAttributesTextForService } = Support;

export const paperworkReportsService = {
  async getPaperworkReportCounts({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();

    const loadActiveSaleLineIds = async () => {
      const rows = [];
      const pageSize = 1000;

      for (let from = 0; ; from += pageSize) {
        const { data, error } = await client
          .from('showroom_sale_lines')
          .select('id, showroom_sales!inner(status)')
          .eq('tenant_id', tenantId)
          .neq('showroom_sales.status', 'cancelled')
          .range(from, from + pageSize - 1);

        if (error) throw error;

        const page = data || [];
        rows.push(...page);
        if (page.length < pageSize) break;
      }

      return new Set(rows.map((row) => row.id));
    };

    const [
      activeSaleLineIds,
      requestsResult,
      requestsCountResult,
      vaultDocumentsResult,
      sentPendingReceiptResult,
    ] = await Promise.all([
      loadActiveSaleLineIds(),
      client
        .from('paperwork_requests')
        .select('id, sale_line_id, status, current_stage, notes')
        .eq('tenant_id', tenantId)
        .not('sale_line_id', 'is', null),
      client
        .from('paperwork_requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId),
      client
        .from('paperwork_documents')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'in_custody'),
      client
        .from('paperwork_requests')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId)
        .eq('status', 'open')
        .eq('current_stage', 'sent_to_processor'),
    ]);

    if (requestsResult.error) {
      throw requestsResult.error;
    }

    if (requestsCountResult.error) {
      throw requestsCountResult.error;
    }

    if (vaultDocumentsResult.error) {
      throw vaultDocumentsResult.error;
    }

    if (sentPendingReceiptResult.error) throw sentPendingReceiptResult.error;

    const requests = requestsResult.data || [];
    const requestedSaleLineIds = new Set();

    requests.forEach((request) => {
      if (!request?.sale_line_id) {
        return;
      }

      if (!activeSaleLineIds.has(request.sale_line_id)) {
        return;
      }

      requestedSaleLineIds.add(request.sale_line_id);

    });

    return {
      missing: Math.max(activeSaleLineIds.size - requestedSaleLineIds.size, 0),
      totalRequests: requestsCountResult.count || 0,
      vault: vaultDocumentsResult.count || 0,
      sentPendingReceipt: sentPendingReceiptResult.count || 0,
    };
  },

  async listSales({ tenantId, status, limit = 150, includeAttachments = true } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();

    let query = client
      .from('showroom_sales')
      .select(SALE_COLUMNS)
      .eq('tenant_id', tenantId);

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }

    const { data, error } = await query
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    const sales = data || [];
    const [customerMap, linesMap, paymentsMap, accountingMap] = await Promise.all([
      loadCustomersMap(client, tenantId, sales),
      loadSaleLinesMap(client, tenantId, sales, { includeAttachments }),
      loadSalePaymentsMap(client, tenantId, sales),
      loadSaleAccountingMap(client, tenantId, sales),
    ]);

    return sales.map((sale) => normalizeSale(sale, customerMap, linesMap, paymentsMap, accountingMap));
  }
};
