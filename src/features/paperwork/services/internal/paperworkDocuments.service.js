import { requireSupabase } from '@/core/lib/supabase';
import { invokePaperworkNotification } from '@/core/notifications/paperworkNotifications';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';
import { invalidateVaultPaperworkCache } from '@/features/paperwork/services/vaultPaperworkCache';
import * as Support from '@/features/paperwork/services/internal/paperworkDataSupport';

const { TENANT_FILES_BUCKET, SIGNED_URL_EXPIRES_IN, SALE_COLUMNS, PARTNER_COLUMNS, SALE_LINE_COLUMNS, SALE_PAYMENT_MOVE_COLUMNS, PAPERWORK_REQUEST_COLUMNS, PAPERWORK_DOCUMENT_COLUMNS, VAULT_PAPERWORK_SUMMARY_COLUMNS, PAPERWORK_DOCUMENT_MOVE_COLUMNS, PAPERWORK_REQUEST_EVENT_COLUMNS, TENANT_USER_COLUMNS, PAPERWORK_STAGE_LABELS, PAPERWORK_DOCUMENT_MOVE_DIRECTION_LABELS, PAPERWORK_DOCUMENT_SOURCE_LABELS, PAPERWORK_DOCUMENT_STATUS_LABELS, getPaperworkStageLabel, requireTenantId, requireSaleId, toNumber, getFileExtension, assertPaperworkImage, isStorageImage, normalizeStoragePath, listTenantStorageImages, normalizeCustomer, mergeAttributes, mergeTrackingIdentifiers, normalizeSaleLine, loadTrackingUnitAttributesMap, loadProductsMap, loadExpectedTrackingIdentifiersByCategoryId, loadLineAttributesMap, loadVariantAttributesMap, loadTrackingDetailsMap, normalizeSalePayment, normalizeSale, loadCustomersMap, loadSaleLinesMap, loadSalePaymentsMap, loadSaleAccountingMap, loadPaperworkDocumentInvoiceMap, loadPaperworkPartnersMap, loadPaperworkSaleLinesMap, loadPaperworkTrackingUnitsMap, loadPartnersByIdsMap, loadTenantUsersByIdsMap, loadPaperworkRequestEventsMap, loadPaperworkDocumentAttachmentsMap, loadPaperworkRequestOwnerAttachmentsMap, getMovePartyLabel, parseRetrospectiveMoveNotes, normalizePaperworkDocumentMove, normalizePaperworkDocument, normalizePaperworkRequest, formatPaperAttributesTextForService } = Support;

export const paperworkDocumentsService = {
  async listVaultPaperworkSummary({ tenantId, pageSize = 30, cursor = null } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const safePageSize = Math.min(Math.max(Number(pageSize) || 30, 1), 100);
    let query = client
      .from('paperwork_documents')
      .select(VAULT_PAPERWORK_SUMMARY_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('status', 'in_custody')
      .order('updated_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(safePageSize + 1);

    if (cursor?.updatedAt && cursor?.id) {
      query = query.or(`updated_at.lt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`);
    }

    const { data, error } = await query;
    if (error) throw error;

    const rows = data || [];
    const hasMore = rows.length > safePageSize;
    const documents = rows.slice(0, safePageSize);
    const trackingUnitIds = [...new Set(documents.map((document) => document.tracking_unit_id).filter(Boolean))];
    const ownerPartnerIds = [...new Set(documents.map((document) => document.owner_partner_id).filter(Boolean))];

    const [{ data: trackingUnits, error: trackingUnitsError }, partnersMap] = await Promise.all([
      trackingUnitIds.length
        ? client
          .from('stock_tracking_units')
          .select('id, product_product_id, tracking_number, status, data_status, incomplete_reason')
          .eq('tenant_id', tenantId)
          .in('id', trackingUnitIds)
        : Promise.resolve({ data: [], error: null }),
      loadPartnersByIdsMap(client, tenantId, ownerPartnerIds),
    ]);
    if (trackingUnitsError) throw trackingUnitsError;

    const trackingUnitsMap = new Map((trackingUnits || []).map((unit) => [unit.id, unit]));
    const productIds = [...new Set((trackingUnits || []).map((unit) => unit.product_product_id).filter(Boolean))];
    const [{ data: products, error: productsError }, { data: identifierRows, error: identifiersError }] = await Promise.all([
      productIds.length
        ? client
          .from('product_products')
          .select('id, display_name, sku')
          .eq('tenant_id', tenantId)
          .in('id', productIds)
        : Promise.resolve({ data: [], error: null }),
      trackingUnitIds.length
        ? client
          .from('stock_tracking_unit_identifiers')
          .select('id, tracking_unit_id, identifier_type_id, value, is_not_available')
          .eq('tenant_id', tenantId)
          .in('tracking_unit_id', trackingUnitIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (productsError) throw productsError;
    if (identifiersError) throw identifiersError;

    const identifierTypeIds = [...new Set((identifierRows || []).map((row) => row.identifier_type_id).filter(Boolean))];
    const { data: identifierTypes, error: identifierTypesError } = identifierTypeIds.length
      ? await client
        .from('product_tracking_identifier_types')
        .select('id, name, code')
        .eq('tenant_id', tenantId)
        .in('id', identifierTypeIds)
      : { data: [], error: null };
    if (identifierTypesError) throw identifierTypesError;

    const productsMap = new Map((products || []).map((product) => [product.id, product]));
    const identifierTypesMap = new Map((identifierTypes || []).map((type) => [type.id, type]));
    const identifiersMap = (identifierRows || []).reduce((map, row) => {
      const type = identifierTypesMap.get(row.identifier_type_id);
      const current = map.get(row.tracking_unit_id) || [];
      current.push({
        id: row.id,
        identifierTypeId: row.identifier_type_id,
        label: type?.name || 'رقم تتبع',
        code: type?.code || '',
        value: row.value || '',
        isNotAvailable: Boolean(row.is_not_available),
      });
      map.set(row.tracking_unit_id, current);
      return map;
    }, new Map());

    const normalizedDocuments = documents.map((document) => {
      const trackingUnit = trackingUnitsMap.get(document.tracking_unit_id) || null;
      const product = productsMap.get(trackingUnit?.product_product_id) || null;
      const documentOwnerName = document.document_owner_name ?? 'غير مسجل';
      return {
        id: document.id,
        tenantId: document.tenant_id,
        documentType: document.document_type || 'document',
        documentTitle: document.document_title || '',
        documentOwnerName,
        ownerName: documentOwnerName,
        displayTitle: document.document_title || document.manual_item_description || product?.display_name || trackingUnit?.tracking_number || 'ورقة بدون عنوان',
        trackingUnitId: document.tracking_unit_id,
        paperworkRequestId: document.paperwork_request_id,
        ownerPartnerId: document.owner_partner_id,
        manualItemDescription: document.manual_item_description || '',
        sourceType: document.source_type || 'manual',
        status: document.status,
        releaseAuthorizedAt: document.release_authorized_at || null,
        releaseAuthorizedToName: document.release_authorized_to_name || '',
        releaseAuthorizationConsumedAt: document.release_authorization_consumed_at || null,
        hasActiveReleaseAuthorization: Boolean(document.release_authorized_at && !document.release_authorization_consumed_at),
        createdAt: document.created_at,
        updatedAt: document.updated_at,
        owner: partnersMap.get(document.owner_partner_id) || null,
        trackingUnit: trackingUnit ? {
          id: trackingUnit.id,
          trackingNumber: trackingUnit.tracking_number || '',
          status: trackingUnit.status || '',
          productProductId: trackingUnit.product_product_id || null,
          dataStatus: trackingUnit.data_status || 'complete',
          incompleteReason: trackingUnit.incomplete_reason || null,
          isIncomplete: ['incomplete', 'needs_review'].includes(trackingUnit.data_status),
        } : null,
        productName: product?.display_name || product?.sku || '',
        itemDescription: trackingUnit
          ? [product?.display_name, trackingUnit.tracking_number].filter(Boolean).join(' - ')
          : document.manual_item_description || '',
        trackingIdentifiers: identifiersMap.get(document.tracking_unit_id) || [],
      };
    });
    const lastDocument = normalizedDocuments.at(-1);

    return {
      documents: normalizedDocuments,
      hasMore,
      cursor: hasMore && lastDocument ? { updatedAt: lastDocument.updatedAt, id: lastDocument.id } : null,
    };
  },

  async listPaperworkDocuments({ tenantId, limit = 250, status = null } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    let documents = [];

    if (limit == null) {
      const pageSize = 500;
      let pageStart = 0;

      while (true) {
        let query = client
          .from('paperwork_documents')
          .select(PAPERWORK_DOCUMENT_COLUMNS)
          .eq('tenant_id', tenantId)
          .order('updated_at', { ascending: false })
          .order('created_at', { ascending: false })
          .range(pageStart, pageStart + pageSize - 1);
        if (status) query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;
        const page = data || [];
        documents.push(...page);
        if (page.length < pageSize) break;
        pageStart += pageSize;
      }
    } else {
      let query = client
        .from('paperwork_documents')
        .select(PAPERWORK_DOCUMENT_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(limit);
      if (status) query = query.eq('status', status);

      const { data, error } = await query;
      if (error) throw error;
      documents = data || [];
    }
    const trackingUnitIds = Array.from(new Set(documents.map((document) => document.tracking_unit_id).filter(Boolean)));
    const ownerPartnerIds = documents.map((document) => document.owner_partner_id).filter(Boolean);

    const documentIds = documents.map((document) => document.id).filter(Boolean);
    const [trackingUnitsMap, partnersMap, attachmentsMap] = await Promise.all([
      trackingUnitIds.length
        ? loadPaperworkTrackingUnitsMap(client, tenantId, documents)
        : Promise.resolve(new Map()),
      loadPartnersByIdsMap(client, tenantId, ownerPartnerIds),
      loadPaperworkDocumentAttachmentsMap(client, tenantId, documentIds),
    ]);

    const contextLines = documents.map((document) => {
      const trackingUnit = trackingUnitsMap.get(document.tracking_unit_id) || null;
      return {
        id: document.id,
        product_product_id: trackingUnit?.product_product_id || null,
        tracking_unit_id: document.tracking_unit_id,
      };
    });

    const [productMap, trackingDetailsMap] = await Promise.all([
      loadProductsMap(client, tenantId, contextLines),
      loadTrackingDetailsMap(client, tenantId, contextLines),
    ]);
    const baseDocuments = documents.map((document) => normalizePaperworkDocument(document, {
      trackingUnitsMap,
      partnersMap,
      productMap,
      trackingDetailsMap,
      attachmentsMap,
    }));
    const documentsMap = new Map(baseDocuments.map((document) => [document.id, document]));

    const { data: moveRows, error: movesError } = documentIds.length
      ? await client
        .from('paperwork_document_moves')
        .select(PAPERWORK_DOCUMENT_MOVE_COLUMNS)
        .eq('tenant_id', tenantId)
        .in('document_id', documentIds)
        .order('moved_at', { ascending: false })
        .order('created_at', { ascending: false })
      : { data: [], error: null };

    if (movesError) {
      throw movesError;
    }

    const moves = moveRows || [];
    const movePartnerIds = moves.flatMap((move) => [move.from_partner_id, move.to_partner_id]).filter(Boolean);
    const moveUserIds = moves.flatMap((move) => [move.from_user_id, move.to_user_id, move.created_by]).filter(Boolean);
    const [movePartnersMap, usersMap] = await Promise.all([
      loadPartnersByIdsMap(client, tenantId, movePartnerIds),
      loadTenantUsersByIdsMap(client, tenantId, moveUserIds),
    ]);
    const allPartnersMap = new Map([...partnersMap, ...movePartnersMap]);
    const normalizedMoves = moves.map((move) => normalizePaperworkDocumentMove(move, {
      documentsMap,
      partnersMap: allPartnersMap,
      usersMap,
    }));
    const movesMap = normalizedMoves.reduce((map, move) => {
      const current = map.get(move.documentId) || [];
      current.push(move);
      map.set(move.documentId, current);
      return map;
    }, new Map());

    return {
      documents: documents.map((document) => normalizePaperworkDocument(document, {
        trackingUnitsMap,
        partnersMap,
        productMap,
        trackingDetailsMap,
        movesMap,
        attachmentsMap,
      })),
      moves: normalizedMoves,
    };
  },

  async listPaperworkDocumentInvoiceBalances({ tenantId, documents = [] } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    return loadPaperworkDocumentInvoiceMap(client, tenantId, documents);
  },

  async getPaperworkDocumentDetails({ tenantId, documentId } = {}) {
    requireTenantId(tenantId);
    if (!documentId) throw new Error('تعذر تحديد المستند.');

    const client = requireSupabase();
    const [documentResult, movesResult, attachmentsResult] = await Promise.all([
      client
        .from('paperwork_documents')
        .select(PAPERWORK_DOCUMENT_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('id', documentId)
        .single(),
      client
        .from('paperwork_document_moves')
        .select(PAPERWORK_DOCUMENT_MOVE_COLUMNS)
        .eq('tenant_id', tenantId)
        .eq('document_id', documentId)
        .order('moved_at', { ascending: false })
        .order('created_at', { ascending: false }),
      client
        .from('ir_attachments')
        .select('id, related_id, document_type, bucket_name, file_path, original_file_name, mime_type, created_at')
        .eq('tenant_id', tenantId)
        .eq('related_model', 'paperwork_documents')
        .eq('related_id', documentId)
        .eq('is_active', true)
        .order('created_at', { ascending: false }),
    ]);

    if (documentResult.error) throw documentResult.error;
    if (movesResult.error) throw movesResult.error;
    if (attachmentsResult.error) throw attachmentsResult.error;

    const record = documentResult.data;
    const moveRows = movesResult.data || [];
    const partnerIds = [
      record.owner_partner_id,
      ...moveRows.flatMap((move) => [move.from_partner_id, move.to_partner_id]),
    ].filter(Boolean);
    const userIds = [
      record.cancelled_by,
      record.release_authorized_by,
      ...moveRows.flatMap((move) => [move.from_user_id, move.to_user_id, move.created_by]),
    ].filter(Boolean);

    const [trackingUnitsMap, partnersMap, usersMap, attachments] = await Promise.all([
      record.tracking_unit_id
        ? loadPaperworkTrackingUnitsMap(client, tenantId, [record])
        : Promise.resolve(new Map()),
      loadPartnersByIdsMap(client, tenantId, partnerIds),
      loadTenantUsersByIdsMap(client, tenantId, userIds),
      Promise.all((attachmentsResult.data || []).map(async (attachment) => {
        const bucket = attachment.bucket_name || TENANT_FILES_BUCKET;
        const { data: signedData } = await client.storage
          .from(bucket)
          .createSignedUrl(attachment.file_path, SIGNED_URL_EXPIRES_IN);
        return {
          id: attachment.id,
          documentId: attachment.related_id,
          documentType: attachment.document_type || '',
          bucket,
          path: attachment.file_path || '',
          name: attachment.original_file_name || '',
          mimeType: attachment.mime_type || '',
          createdAt: attachment.created_at || null,
          signedUrl: signedData?.signedUrl || '',
        };
      })),
    ]);

    const trackingUnit = trackingUnitsMap.get(record.tracking_unit_id) || null;
    const contextLines = [{
      id: record.id,
      product_product_id: trackingUnit?.product_product_id || null,
      tracking_unit_id: record.tracking_unit_id,
    }];
    const [productMap, trackingDetailsMap] = await Promise.all([
      loadProductsMap(client, tenantId, contextLines),
      loadTrackingDetailsMap(client, tenantId, contextLines),
    ]);
    const baseDocument = normalizePaperworkDocument(record, {
      trackingUnitsMap,
      partnersMap,
      usersMap,
      productMap,
      trackingDetailsMap,
    });
    const documentsMap = new Map([[record.id, baseDocument]]);
    const moves = moveRows.map((move) => normalizePaperworkDocumentMove(move, {
      documentsMap,
      partnersMap,
      usersMap,
    }));
    const latestMove = moves[0] || null;

    return {
      ...baseDocument,
      attachments,
      jawabPhoto: attachments.find((attachment) => attachment.documentType === 'jawab_photo') || attachments[0] || null,
      moves,
      latestMove,
      currentLocation: latestMove?.toLocation || latestMove?.toLabel || '',
      currentCustodianName: latestMove?.toUserId ? latestMove.toLabel : '',
    };
  },

  async setPaperworkDocumentOwnerPartner({ tenantId, documentId, partnerId } = {}) {
    requireTenantId(tenantId);
    if (!documentId) throw new Error('تعذر تحديد المستند.');
    if (!partnerId) throw new Error('اختر الـPartner أولًا.');

    const client = requireSupabase();
    const { error } = await client.rpc('set_paperwork_document_owner_partner', {
      p_tenant_id: tenantId,
      p_document_id: documentId,
      p_partner_id: partnerId,
    });
    if (error) throw error;

    invalidateVaultPaperworkCache({ tenantId });
    return this.getPaperworkDocumentDetails({ tenantId, documentId });
  },

  async cancelPaperworkDocument({ tenantId, documentId, reason, notes = null } = {}) {
    requireTenantId(tenantId);
    if (!documentId) throw new Error('تعذر تحديد المستند.');

    const client = requireSupabase();
    const { error } = await client.rpc('cancel_paperwork_document', {
      p_tenant_id: tenantId,
      p_document_id: documentId,
      p_reason: reason,
      p_notes: notes || null,
    });

    if (error) throw error;
    invalidateVaultPaperworkCache({ tenantId });
    return this.getPaperworkDocumentDetails({ tenantId, documentId });
  },

  async recordPreviousPaperworkDocumentDelivery({ tenantId, documentId, deliveredAt, reason, notes = null } = {}) {
    requireTenantId(tenantId);
    if (!documentId) throw new Error('تعذر تحديد المستند.');
    if (!deliveredAt) throw new Error('تاريخ ووقت التسليم إلزامي.');

    const client = requireSupabase();
    const { error } = await client.rpc('record_previous_paperwork_document_delivery', {
      p_tenant_id: tenantId,
      p_document_id: documentId,
      p_delivered_at: deliveredAt,
      p_reason: reason,
      p_notes: notes || null,
    });

    if (error) throw error;
    invalidateVaultPaperworkCache({ tenantId });
    return this.getPaperworkDocumentDetails({ tenantId, documentId });
  },

  async authorizePaperworkDocumentRelease({ tenantId, documentId, recipientType, recipientName = null, notes } = {}) {
    requireTenantId(tenantId);
    if (!documentId) throw new Error('تعذر تحديد المستند.');

    const client = requireSupabase();
    const { error } = await client.rpc('authorize_paperwork_document_release', {
      p_tenant_id: tenantId,
      p_document_id: documentId,
      p_recipient_type: recipientType,
      p_recipient_name: recipientName || null,
      p_notes: notes,
    });

    if (error) throw error;
    invalidateVaultPaperworkCache({ tenantId });
    return this.getPaperworkDocumentDetails({ tenantId, documentId });
  },

  async listPaperworkMoveTargets({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();

    const [partnersResult, usersResult] = await Promise.all([
      client
        .from('partners')
        .select(PARTNER_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true })
        .limit(200),
      client
        .from('tenant_users')
        .select(TENANT_USER_COLUMNS)
        .eq('tenant_id', tenantId)
        .order('full_name', { ascending: true })
        .limit(100),
    ]);

    if (partnersResult.error) {
      throw partnersResult.error;
    }

    if (usersResult.error) {
      throw usersResult.error;
    }

    return {
      partners: (partnersResult.data || []).map(normalizeCustomer),
      users: (usersResult.data || []).map((user) => ({
        id: user.id,
        name: user.full_name || user.email || 'مستخدم غير محدد',
        email: user.email || '',
      })),
    };
  },

  async listTrackingUnitIdentifiers({ tenantId, trackingUnitId } = {}) {
    requireTenantId(tenantId);

    if (!trackingUnitId) {
      return [];
    }

    const client = requireSupabase();
    const { data: rows, error } = await client
      .from('stock_tracking_unit_identifiers')
      .select('id, tracking_unit_id, identifier_type_id, value, is_not_available')
      .eq('tenant_id', tenantId)
      .eq('tracking_unit_id', trackingUnitId);

    if (error) {
      throw error;
    }

    const identifierTypeIds = Array.from(new Set((rows || []).map((row) => row.identifier_type_id).filter(Boolean)));
    const { data: types, error: typesError } = identifierTypeIds.length
      ? await client
        .from('product_tracking_identifier_types')
        .select('id, name, code')
        .eq('tenant_id', tenantId)
        .in('id', identifierTypeIds)
      : { data: [], error: null };

    if (typesError) {
      throw typesError;
    }

    const typesById = new Map((types || []).map((type) => [type.id, type]));

    return (rows || []).map((row) => {
      const type = typesById.get(row.identifier_type_id);

      return {
        id: row.id,
        trackingUnitId: row.tracking_unit_id,
        identifierTypeId: row.identifier_type_id,
        label: type?.name || 'تعريف',
        code: type?.code || '',
        value: row.value || '',
        isNotAvailable: row.is_not_available ?? false,
      };
    });
  },

  async createManualPaperworkReceipt({
    tenantId,
    trackingUnitId,
    paperworkRequestId = null,
    documentTitle,
    documentOwnerName,
    ownerPartnerId = null,
    initialLocation = '',
    notes = '',
  } = {}) {
    requireTenantId(tenantId);
    if (!trackingUnitId) {
      throw new Error('اختر القطعة المسجلة المرتبطة بالجواب.');
    }
    const safeTitle = normalizeOptionalText(documentTitle);
    const safeOwnerName = normalizeOptionalText(documentOwnerName);
    if (!safeTitle) {
      throw new Error('عنوان المستند مطلوب.');
    }
    if (!safeOwnerName) {
      throw new Error('اسم صاحب الجواب مطلوب.');
    }

    const client = requireSupabase();
    const { data, error } = await client.rpc('create_manual_paperwork_receipt', {
      p_tenant_id: tenantId,
      p_tracking_unit_id: trackingUnitId,
      p_paperwork_request_id: paperworkRequestId || null,
      p_document_title: safeTitle,
      p_document_owner_name: safeOwnerName,
      p_owner_partner_id: ownerPartnerId || null,
      p_initial_location: String(initialLocation || '').trim() || null,
      p_notes: String(notes || '').trim() || null,
    });

    if (error) {
      throw new Error(error.message || 'تعذر تسجيل الجواب.');
    }

    invalidateVaultPaperworkCache({ tenantId });
    return data?.document_id || null;
  },

  async savePaperworkDocumentAttachment({ tenantId, documentId, documentType = 'jawab_photo', file, userId } = {}) {
    const client = requireSupabase();
    requireTenantId(tenantId);
    if (!documentId) throw new Error('تعذر تحديد الجواب.');
    if (!file) return null;

    assertPaperworkImage(file);

    const { data: document, error: documentError } = await client
      .from('paperwork_documents')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', documentId)
      .maybeSingle();

    if (documentError) {
      throw documentError;
    }

    if (!document) {
      throw new Error('الجواب غير موجود.');
    }

    const createdBy = userId || await resolveCurrentTenantUserId(client, { tenantId });
    const extension = getFileExtension(file);
    const path = `${tenantId}/paperwork-documents/${documentId}/${documentType}-${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await client.storage.from(TENANT_FILES_BUCKET).upload(path, file, {
      cacheControl: '3600',
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

    if (uploadError) {
      throw new Error(uploadError.message || 'تعذر رفع صورة الجواب.');
    }

    const { error: attachmentError } = await client.from('ir_attachments').insert({
      tenant_id: tenantId,
      bucket_name: TENANT_FILES_BUCKET,
      file_path: path,
      document_type: documentType,
      related_model: 'paperwork_documents',
      related_id: documentId,
      original_file_name: file.name || null,
      mime_type: file.type || null,
      file_size: file.size || null,
      created_by: createdBy,
    });

    if (attachmentError) {
      await client.storage.from(TENANT_FILES_BUCKET).remove([path]);
      throw new Error(attachmentError.message || 'تم رفع الصورة لكن تعذر ربطها بالجواب.');
    }

    return { path, bucket: TENANT_FILES_BUCKET, documentType };
  },

  async listTenantImageFiles({ tenantId, limit = 120 } = {}) {
    const client = requireSupabase();
    requireTenantId(tenantId);

    const files = await listTenantStorageImages(client, tenantId, tenantId, [], 0, limit);

    return Promise.all(files.map(async (file) => {
      const { data: signedData } = await client.storage.from(file.bucket).createSignedUrl(file.path, SIGNED_URL_EXPIRES_IN);
      return {
        ...file,
        signedUrl: signedData?.signedUrl || '',
      };
    }));
  }
};
