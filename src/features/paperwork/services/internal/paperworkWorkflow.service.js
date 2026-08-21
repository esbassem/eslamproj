import { requireSupabase } from '@/core/lib/supabase';
import { invalidateVaultPaperworkCache } from '@/features/paperwork/services/vaultPaperworkCache';
import * as Support from '@/features/paperwork/services/internal/paperworkDataSupport';

const { TENANT_FILES_BUCKET, SIGNED_URL_EXPIRES_IN, SALE_COLUMNS, PARTNER_COLUMNS, SALE_LINE_COLUMNS, SALE_PAYMENT_MOVE_COLUMNS, PAPERWORK_REQUEST_COLUMNS, PAPERWORK_DOCUMENT_COLUMNS, VAULT_PAPERWORK_SUMMARY_COLUMNS, PAPERWORK_DOCUMENT_MOVE_COLUMNS, PAPERWORK_REQUEST_EVENT_COLUMNS, TENANT_USER_COLUMNS, PAPERWORK_STAGE_LABELS, PAPERWORK_DOCUMENT_MOVE_DIRECTION_LABELS, PAPERWORK_DOCUMENT_SOURCE_LABELS, PAPERWORK_DOCUMENT_STATUS_LABELS, getPaperworkStageLabel, requireTenantId, requireSaleId, toNumber, getFileExtension, assertPaperworkImage, isStorageImage, normalizeStoragePath, listTenantStorageImages, normalizeCustomer, mergeAttributes, mergeTrackingIdentifiers, normalizeSaleLine, loadTrackingUnitAttributesMap, loadProductsMap, loadExpectedTrackingIdentifiersByCategoryId, loadLineAttributesMap, loadVariantAttributesMap, loadTrackingDetailsMap, normalizeSalePayment, normalizeSale, loadCustomersMap, loadSaleLinesMap, loadSalePaymentsMap, loadSaleAccountingMap, loadPaperworkDocumentInvoiceMap, loadPaperworkPartnersMap, loadPaperworkSaleLinesMap, loadPaperworkTrackingUnitsMap, loadPartnersByIdsMap, loadTenantUsersByIdsMap, loadPaperworkRequestEventsMap, loadPaperworkDocumentAttachmentsMap, loadPaperworkRequestOwnerAttachmentsMap, getMovePartyLabel, parseRetrospectiveMoveNotes, normalizePaperworkDocumentMove, normalizePaperworkDocument, normalizePaperworkRequest, formatPaperAttributesTextForService } = Support;

export const paperworkWorkflowService = {
  async getSaleDetails({ tenantId, saleId } = {}) {
    requireTenantId(tenantId);
    requireSaleId(saleId);
    const client = requireSupabase();

    const { data, error } = await client
      .from('showroom_sales')
      .select(SALE_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', saleId)
      .single();

    if (error) {
      throw error;
    }

    const [customerMap, linesMap, paymentsMap, accountingMap] = await Promise.all([
      loadCustomersMap(client, tenantId, data),
      loadSaleLinesMap(client, tenantId, data),
      loadSalePaymentsMap(client, tenantId, data),
      loadSaleAccountingMap(client, tenantId, data),
    ]);
    return normalizeSale(data, customerMap, linesMap, paymentsMap, accountingMap);
  },

  async sendPaperworkRequestToProcessor({ tenantId, requestId, notes = '' } = {}) {
    requireTenantId(tenantId);
    if (!requestId) {
      throw new Error('تعذر تحديد طلب الأوراق.');
    }

    const client = requireSupabase();
    const { data, error } = await client.rpc('send_paperwork_request_to_processor', {
      p_tenant_id: tenantId,
      p_request_id: requestId,
      p_notes: String(notes || '').trim() || null,
    });
    if (error) throw error;

    return {
      requestId: data?.request_id || requestId,
      currentStage: data?.current_stage || 'sent_to_processor',
      updatedAt: data?.updated_at || new Date().toISOString(),
    };
  },

  async confirmProcessorPaperworkCancellation({ tenantId, requestId, notes = '' } = {}) {
    requireTenantId(tenantId);
    if (!requestId) throw new Error('تعذر تحديد طلب الأوراق.');
    const client = requireSupabase();
    const { data, error } = await client.rpc('confirm_processor_paperwork_cancellation', {
      p_tenant_id: tenantId,
      p_request_id: requestId,
      p_notes: String(notes || '').trim() || null,
    });
    if (error) throw error;
    return {
      requestId: data?.request_id || requestId,
      status: data?.status || 'cancelled',
      currentStage: data?.current_stage || 'cancelled',
      confirmedAt: data?.confirmed_at || null,
      confirmedBy: data?.confirmed_by || null,
    };
  },

  async receivePaperworkRequestsFromProcessor({
    tenantId,
    requestIds = [],
    ownerNamesByRequestId = {},
    imagesByRequestId = {},
  } = {}) {
    requireTenantId(tenantId);
    const ids = [...new Set((Array.isArray(requestIds) ? requestIds : []).filter(Boolean))];

    if (!ids.length) {
      throw new Error('حدد طلبًا واحدًا على الأقل.');
    }

    const client = requireSupabase();
    const results = await Promise.allSettled(ids.map(async (requestId) => {
      const ownerName = String(ownerNamesByRequestId[requestId] || '').trim() || null;
      const { data, error } = await client.rpc('receive_paperwork_request_from_processor_with_owner', {
        p_tenant_id: tenantId,
        p_request_id: requestId,
        p_document_owner_name: ownerName,
      });

      if (error) throw error;
      return {
        requestId: data?.request_id || requestId,
        documentId: data?.document_id || null,
        saleId: data?.sale_id || null,
        oldStage: data?.old_stage || '',
        currentStage: data?.current_stage || 'received_from_processor',
        updatedAt: data?.updated_at || null,
      };
    }));

    const succeeded = [];
    const failed = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        succeeded.push(result.value);
      } else {
        failed.push({
          requestId: ids[index],
          message: result.reason?.message || 'تعذر استلام الطلب.',
        });
      }
    });

    const imageResults = await Promise.allSettled(succeeded.map(async (item) => {
      const file = imagesByRequestId[item.requestId] || null;
      if (!file) return null;

      await this.savePaperworkDocumentAttachment({
        tenantId,
        documentId: item.documentId,
        documentType: 'jawab_photo',
        file,
      });

      return item.requestId;
    }));
    const imageFailed = [];

    imageResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        imageFailed.push({
          requestId: succeeded[index].requestId,
          message: result.reason?.message || 'تم استلام الجواب لكن تعذر رفع صورته.',
        });
      }
    });

    if (succeeded.length) invalidateVaultPaperworkCache({ tenantId });
    return { succeeded, failed, imageFailed };
  },

  async getPaperworkDeliveryBalance({ tenantId, saleId } = {}) {
    requireTenantId(tenantId);

    if (!saleId) {
      return { totalAmount: 0, paidAmount: 0, remainingAmount: 0 };
    }

    const client = requireSupabase();
    const { data, error } = await client
      .from('showroom_sales')
      .select('id, total_amount, account_move_id')
      .eq('tenant_id', tenantId)
      .eq('id', saleId)
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('الفاتورة المرتبطة بطلب الأوراق غير موجودة.');

    const totalAmount = toNumber(data.total_amount);
    const [linkedMoveResult, referencedMoveResult, receivableAccountResult] = await Promise.all([
      data.account_move_id
        ? client.from('account_moves').select('id').eq('tenant_id', tenantId)
          .eq('id', data.account_move_id).eq('move_type', 'sale').eq('state', 'posted').maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      client.from('account_moves').select('id').eq('tenant_id', tenantId)
        .eq('ref', `showroom_sale:${saleId}`).eq('move_type', 'sale').eq('state', 'posted')
        .order('created_at', { ascending: true }).limit(1).maybeSingle(),
      client.from('account_accounts').select('id').eq('tenant_id', tenantId)
        .eq('code', '114001').eq('active', true),
    ]);
    const failedLookup = [linkedMoveResult, referencedMoveResult, receivableAccountResult]
      .find((result) => result.error);
    if (failedLookup?.error) throw failedLookup.error;

    const saleMoveId = linkedMoveResult.data?.id || referencedMoveResult.data?.id || null;
    const receivableAccountIds = (receivableAccountResult.data || []).map((account) => account.id);
    let paidAmount = 0;
    if (saleMoveId && receivableAccountIds.length) {
      const { data: invoiceLines, error: invoiceLinesError } = await client
        .from('account_move_lines').select('id').eq('tenant_id', tenantId)
        .eq('move_id', saleMoveId).in('account_id', receivableAccountIds).gt('debit', 0);
      if (invoiceLinesError) throw invoiceLinesError;
      const invoiceLineIds = (invoiceLines || []).map((line) => line.id);
      if (invoiceLineIds.length) {
        const { data: reconciliations, error: reconciliationsError } = await client
          .from('account_partial_reconcile').select('amount').eq('tenant_id', tenantId)
          .in('debit_move_id', invoiceLineIds);
        if (reconciliationsError) throw reconciliationsError;
        paidAmount = (reconciliations || []).reduce((sum, row) => sum + toNumber(row.amount), 0);
      }
    }
    paidAmount = Math.round(paidAmount * 100) / 100;
    const remainingAmount = Math.max(Math.round((totalAmount - paidAmount) * 100) / 100, 0);

    return { totalAmount, paidAmount, remainingAmount };
  },

  async deliverPaperworkToCustomer({ tenantId, requestId, receiptImage } = {}) {
    requireTenantId(tenantId);
    if (!requestId) throw new Error('تعذر تحديد طلب الأوراق.');

    const client = requireSupabase();
    const { data, error } = await client.rpc('deliver_paperwork_to_customer', {
      p_tenant_id: tenantId,
      p_request_id: requestId,
    });
    if (error) throw error;

    let imageUploadError = '';
    if (receiptImage && data?.document_id) {
      try {
        await this.savePaperworkDocumentAttachment({
          tenantId,
          documentId: data.document_id,
          documentType: 'delivery_receipt_photo',
          file: receiptImage,
        });
      } catch (nextError) {
        imageUploadError = nextError?.message || 'تم التسليم لكن تعذر رفع صورة الاستلام.';
      }
    }

    invalidateVaultPaperworkCache({ tenantId });
    return {
      requestId: data?.request_id || requestId,
      documentId: data?.document_id || null,
      currentStage: data?.current_stage || 'delivered',
      status: data?.status || 'done',
      updatedAt: data?.updated_at || new Date().toISOString(),
      imageUploadError,
    };
  },

  // نقطة التنفيذ المركزية للإجراءات الاستثنائية المعتمدة.
  async executePaperworkExceptionalAction({ actionId, ...payload } = {}) {
    if (!actionId) throw new Error('تعذر تحديد الإجراء الاستثنائي.');

    const handlers = {
      previous_customer_delivery: () => this.recordPreviousCustomerDelivery(payload),
      link_existing_vault_document: () => this.linkExistingVaultDocumentToRequest(payload),
      cancel: () => this.cancelPaperworkRequest(payload),
      reopen_cancelled: () => this.reopenCancelledPaperworkRequest(payload),
    };

    const handler = handlers[actionId];
    if (!handler) throw new Error('هذا الإجراء الاستثنائي لم يتم تنفيذه بعد.');
    return handler();
  },

  async listVaultDocumentsForPaperworkRequest({ tenantId, requestId, trackingUnitId } = {}) {
    requireTenantId(tenantId);
    if (!requestId || !trackingUnitId) return [];

    const client = requireSupabase();
    const { documents } = await this.listPaperworkDocuments({ tenantId, limit: null, status: 'in_custody' });
    return documents.filter((document) => document.trackingUnitId === trackingUnitId);
  },

  async linkExistingVaultDocumentToRequest({ tenantId, requestId, documentId, notes = '' } = {}) {
    requireTenantId(tenantId);
    if (!requestId) throw new Error('تعذر تحديد طلب الأوراق.');
    if (!documentId) throw new Error('اختر الورقة الموجودة بالخزنة أولًا.');

    const client = requireSupabase();
    const { data, error } = await client.rpc('link_existing_vault_document_to_request', {
      p_tenant_id: tenantId,
      p_request_id: requestId,
      p_document_id: documentId,
      p_notes: String(notes || '').trim() || null,
    });
    if (error) throw error;

    invalidateVaultPaperworkCache({ tenantId });
    return {
      requestId: data?.request_id || requestId,
      documentId: data?.document_id || documentId,
      currentStage: data?.current_stage || 'received_from_processor',
      oldStage: data?.old_stage || null,
      status: data?.status || 'open',
      closedAt: null,
      updatedAt: data?.updated_at || new Date().toISOString(),
      event: data?.event_id ? {
        id: data.event_id,
        eventType: 'stage_changed',
        oldStage: data?.old_stage || null,
        newStage: data?.current_stage || 'received_from_processor',
        newStatus: data?.status || 'open',
        notes: String(notes || '').trim() || 'تم ربط ورقة موجودة سابقًا بالخزنة بطلب الأوراق.',
        createdAt: data?.updated_at || new Date().toISOString(),
      } : null,
    };
  },

  async recordPreviousCustomerDelivery({ tenantId, requestId, reason, notes = '' } = {}) {
    requireTenantId(tenantId);
    if (!requestId) throw new Error('تعذر تحديد طلب الأوراق.');
    if (!reason) throw new Error('سبب التسجيل المتأخر إلزامي.');

    const client = requireSupabase();
    const { data, error } = await client.rpc('record_previous_customer_paperwork_delivery', {
      p_tenant_id: tenantId,
      p_request_id: requestId,
      p_reason: reason,
      p_notes: String(notes || '').trim() || null,
    });

    if (error) throw error;

    invalidateVaultPaperworkCache({ tenantId });
    return {
      requestId: data?.request_id || requestId,
      documentId: data?.document_id || null,
      documentMoveId: data?.document_move_id || null,
      currentStage: data?.current_stage || 'delivered',
      oldStage: data?.old_stage || null,
      status: data?.status || 'done',
      deliveredAt: data?.delivered_at || data?.updated_at || null,
      closedAt: data?.closed_at || null,
      updatedAt: data?.updated_at || new Date().toISOString(),
      reason: data?.reason || reason,
      notes: data?.notes || String(notes || '').trim(),
      event: data?.event_id ? {
        id: data.event_id,
        eventType: 'done',
        oldStage: data?.old_stage || null,
        newStage: data?.current_stage || 'delivered',
        newStatus: data?.status || 'done',
        notes: String(notes || '').trim() || 'تم تسجيل أن العميل استلم الأوراق سابقًا.',
        createdAt: data?.updated_at || new Date().toISOString(),
      } : null,
    };
  },

  async cancelPaperworkRequest({
    tenantId,
    requestId,
    reason,
    notes = '',
    processorCancellationConfirmed = false,
  } = {}) {
    requireTenantId(tenantId);
    if (!requestId) throw new Error('تعذر تحديد طلب الأوراق.');
    if (!reason) throw new Error('سبب الإلغاء إلزامي.');
    if (!processorCancellationConfirmed) {
      throw new Error('يجب تأكيد أن الأوراق لم تُنجز لدى جهة الإصدار.');
    }

    const client = requireSupabase();
    const { data, error } = await client.rpc('cancel_paperwork_request', {
      p_tenant_id: tenantId,
      p_request_id: requestId,
      p_reason: reason,
      p_notes: String(notes || '').trim() || null,
      p_processor_cancellation_confirmed: true,
    });
    if (error) throw error;

    return {
      requestId: data?.request_id || requestId,
      oldStage: data?.old_stage || null,
      currentStage: data?.current_stage || 'cancelled',
      status: data?.status || 'cancelled',
      closedAt: data?.closed_at || null,
      updatedAt: data?.updated_at || new Date().toISOString(),
      reason: data?.reason || reason,
      notes: data?.notes || String(notes || '').trim(),
      event: data?.event_id ? {
        id: data.event_id,
        eventType: 'cancelled',
        oldStage: data?.old_stage || null,
        newStage: 'cancelled',
        newStatus: 'cancelled',
        notes: String(notes || '').trim() || 'تم إلغاء طلب الأوراق.',
        createdAt: data?.updated_at || new Date().toISOString(),
      } : null,
    };
  },

  async reopenCancelledPaperworkRequest({ tenantId, requestId, notes = '' } = {}) {
    requireTenantId(tenantId);
    if (!requestId) throw new Error('تعذر تحديد طلب الأوراق.');

    const client = requireSupabase();
    const { data, error } = await client.rpc('reopen_cancelled_paperwork_request', {
      p_tenant_id: tenantId,
      p_request_id: requestId,
      p_notes: String(notes || '').trim() || null,
    });
    if (error) throw error;

    return {
      requestId: data?.request_id || requestId,
      oldStage: data?.old_stage || 'cancelled',
      currentStage: data?.current_stage || 'preparation',
      status: data?.status || 'open',
      closedAt: null,
      updatedAt: data?.updated_at || new Date().toISOString(),
      notes: data?.notes || String(notes || '').trim(),
      event: data?.event_id ? {
        id: data.event_id,
        eventType: 'reopened',
        oldStage: data?.old_stage || 'cancelled',
        newStage: data?.current_stage || 'preparation',
        newStatus: 'open',
        notes: String(notes || '').trim() || 'تم التراجع عن إلغاء طلب الأوراق وإعادة فتحه.',
        createdAt: data?.updated_at || new Date().toISOString(),
      } : null,
    };
  },

  async executePaperworkExceptionalActionBulk({ actionId, ...payload } = {}) {
    if (!actionId) throw new Error('تعذر تحديد الإجراء الاستثنائي.');

    const handlers = {
      previous_customer_delivery: () => this.recordPreviousCustomerDeliveryBulk(payload),
    };

    const handler = handlers[actionId];
    if (!handler) throw new Error('هذا الإجراء الاستثنائي غير متاح للتنفيذ المجمع.');
    return handler();
  },

  async recordPreviousCustomerDeliveryBulk({ tenantId, requestIds = [], reason, notes = '' } = {}) {
    requireTenantId(tenantId);
    const uniqueRequestIds = [...new Set((Array.isArray(requestIds) ? requestIds : []).filter(Boolean))];
    if (!uniqueRequestIds.length) throw new Error('حدد طلبًا واحدًا على الأقل.');
    if (!reason) throw new Error('سبب التسجيل المتأخر إلزامي.');

    const client = requireSupabase();
    const { data, error } = await client.rpc('record_previous_customer_paperwork_delivery_bulk', {
      p_tenant_id: tenantId,
      p_request_ids: uniqueRequestIds,
      p_reason: reason,
      p_notes: String(notes || '').trim() || null,
    });

    if (error) throw error;
    invalidateVaultPaperworkCache({ tenantId });
    return {
      count: Number(data?.count || uniqueRequestIds.length),
      requestIds: data?.request_ids || uniqueRequestIds,
      results: Array.isArray(data?.results) ? data.results : [],
    };
  }
};
