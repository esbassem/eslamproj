import { requireSupabase } from '@/core/lib/supabase';
import { requireTenantId } from '@/features/paperwork/services/internal/paperworkDataSupport';
import { requestSummaryViewModel, documentSummaryViewModel } from '@/features/paperwork/adapters/paperworkViewModels';

const REQUEST_SUMMARY_COLUMNS = 'id,tenant_id,branch_id,tracking_unit_id,customer_id,document_owner_partner_id,document_owner_name,processor_partner_id,current_stage,stage_entered_at,status,updated_at';
const DOCUMENT_SUMMARY_COLUMNS = 'id,tenant_id,document_type,document_title,document_owner_name,tracking_unit_id,paperwork_request_id,owner_partner_id,manual_item_description,status,created_at,updated_at';

function escapeLike(value) {
  return String(value || '').trim().replace(/[%_]/g, '\\$&');
}

async function loadSummaryMaps(client, tenantId, rows, { documentRows = false } = {}) {
  const partnerIds = [...new Set(rows.flatMap((row) => documentRows
    ? [row.owner_partner_id]
    : [row.customer_id, row.document_owner_partner_id, row.processor_partner_id]).filter(Boolean))];
  const unitIds = [...new Set(rows.map((row) => row.tracking_unit_id).filter(Boolean))];
  const [partnersResult, unitsResult, identifiersResult] = await Promise.all([
    partnerIds.length ? client.from('partners').select('id,name').eq('tenant_id', tenantId).in('id', partnerIds) : Promise.resolve({ data: [], error: null }),
    unitIds.length ? client.from('stock_tracking_units').select('id,product_product_id,tracking_number').eq('tenant_id', tenantId).in('id', unitIds) : Promise.resolve({ data: [], error: null }),
    unitIds.length ? client.from('stock_tracking_unit_identifiers').select('tracking_unit_id,value,identifier_type_id').eq('tenant_id', tenantId).in('tracking_unit_id', unitIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (partnersResult.error) throw partnersResult.error;
  if (unitsResult.error) throw unitsResult.error;
  if (identifiersResult.error) throw identifiersResult.error;
  const units = unitsResult.data || [];
  const productIds = [...new Set(units.map((unit) => unit.product_product_id).filter(Boolean))];
  const productsResult = productIds.length
    ? await client.from('product_products').select('id,display_name,sku').eq('tenant_id', tenantId).in('id', productIds)
    : { data: [], error: null };
  if (productsResult.error) throw productsResult.error;
  const identifiers = (identifiersResult.data || []).reduce((map, item) => {
    const list = map.get(item.tracking_unit_id) || [];
    if (item.value) list.push(item.value);
    map.set(item.tracking_unit_id, list);
    return map;
  }, new Map());
  return {
    partners: new Map((partnersResult.data || []).map((row) => [row.id, row])),
    units: new Map(units.map((row) => [row.id, row])),
    products: new Map((productsResult.data || []).map((row) => [row.id, row])),
    identifiers,
  };
}

async function resolveSearchCandidates(client, tenantId, search) {
  const term = escapeLike(search);
  if (!term) return null;
  const pattern = `%${term}%`;
  const [partners, units, identifiers, products] = await Promise.all([
    client.from('partners').select('id').eq('tenant_id', tenantId).ilike('name', pattern).limit(100),
    client.from('stock_tracking_units').select('id,product_product_id').eq('tenant_id', tenantId).ilike('tracking_number', pattern).limit(100),
    client.from('stock_tracking_unit_identifiers').select('tracking_unit_id').eq('tenant_id', tenantId).ilike('value', pattern).limit(100),
    client.from('product_products').select('id').eq('tenant_id', tenantId).or(`display_name.ilike.${pattern},sku.ilike.${pattern}`).limit(100),
  ]);
  for (const result of [partners, units, identifiers, products]) if (result.error) throw result.error;
  const productIds = new Set((products.data || []).map((row) => row.id));
  const productUnits = productIds.size
    ? await client.from('stock_tracking_units').select('id').eq('tenant_id', tenantId).in('product_product_id', [...productIds]).limit(200)
    : { data: [], error: null };
  if (productUnits.error) throw productUnits.error;
  return {
    partnerIds: [...new Set((partners.data || []).map((row) => row.id))],
    unitIds: [...new Set([...(units.data || []), ...(identifiers.data || []), ...(productUnits.data || [])].map((row) => row.id || row.tracking_unit_id).filter(Boolean))],
    pattern,
  };
}

function applyRequestFilter(query, filter) {
  if (filter === 'action') return query.eq('status', 'open').in('current_stage', ['preparation', 'received_from_processor', 'pending_processor_cancellation']);
  if (filter === 'cancelled') return query.eq('status', 'cancelled');
  if (filter === 'delivered') return query.eq('current_stage', 'delivered');
  if (filter && filter !== 'all') return query.eq('current_stage', filter);
  return query;
}

export const paperworkReadService = {
  async getDocumentContext({ tenantId, requestId } = {}) {
    requireTenantId(tenantId);
    if (!requestId) return null;
    const client = requireSupabase();
    const request = await client.from('paperwork_requests').select('id,sale_id').eq('tenant_id', tenantId).eq('id', requestId).maybeSingle();
    if (request.error) throw request.error;
    if (!request.data) return null;
    const sale = request.data.sale_id ? await client.from('showroom_sales').select('id,sale_number,total_amount').eq('tenant_id', tenantId).eq('id', request.data.sale_id).maybeSingle() : { data: null, error: null };
    if (sale.error) throw sale.error;
    return { requestId: request.data.id, saleId: sale.data?.id || null, saleNumber: sale.data?.sale_number || '', totalAmount: sale.data?.total_amount || 0 };
  },
  async listRequestEvents({ tenantId, requestId } = {}) {
    requireTenantId(tenantId);
    if (!requestId) return [];
    const client = requireSupabase();
    const result = await client.from('paperwork_request_events').select('id,event_type,new_status,old_stage,new_stage,notes,created_by,created_at').eq('tenant_id', tenantId).eq('request_id', requestId).order('created_at', { ascending: false });
    if (result.error) throw result.error;
    const rows = result.data || [];
    const userIds = [...new Set(rows.map((row) => row.created_by).filter(Boolean))];
    const users = userIds.length ? await client.from('tenant_users').select('id,full_name,email').eq('tenant_id', tenantId).in('id', userIds) : { data: [], error: null };
    if (users.error) throw users.error;
    const names = new Map((users.data || []).map((user) => [user.id, user.full_name || user.email]));
    return rows.map((row) => ({ id: row.id, eventType: row.event_type, newStatus: row.new_status, oldStage: row.old_stage, newStage: row.new_stage, notes: row.notes || '', createdByName: names.get(row.created_by) || '', createdAt: row.created_at }));
  },
  async listVaultCandidates({ tenantId, trackingUnitId } = {}) {
    requireTenantId(tenantId);
    if (!trackingUnitId) return [];
    const client = requireSupabase();
    const result = await client.from('paperwork_documents').select(DOCUMENT_SUMMARY_COLUMNS).eq('tenant_id', tenantId).eq('tracking_unit_id', trackingUnitId).eq('status', 'in_custody').order('updated_at', { ascending: false }).limit(20);
    if (result.error) throw result.error;
    const rows = result.data || [];
    const maps = await loadSummaryMaps(client, tenantId, rows, { documentRows: true });
    return rows.map((row) => documentSummaryViewModel(row, maps));
  },
  async getHomeSummary({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const [action, processors, vault, review, activity] = await Promise.all([
      client.from('paperwork_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'open').in('current_stage', ['preparation', 'received_from_processor', 'pending_processor_cancellation']),
      client.from('paperwork_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'open').eq('current_stage', 'sent_to_processor'),
      client.from('paperwork_documents').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'in_custody'),
      client.from('paperwork_requests').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'open').or('blocked_reason.not.is.null,current_stage.eq.pending_processor_cancellation'),
      client.from('paperwork_request_events').select('id,request_id,event_type,new_stage,notes,created_at').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(6),
    ]);
    for (const result of [action, processors, vault, review, activity]) if (result.error) throw result.error;
    return { actionCount: action.count || 0, processorCount: processors.count || 0, vaultCount: vault.count || 0, reviewCount: review.count || 0, activity: activity.data || [] };
  },

  async listRequestSummaries({ tenantId, filter = 'all', search = '', page = 0, pageSize = 30, processorId = null } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const candidates = await resolveSearchCandidates(client, tenantId, search);
    let query = client.from('paperwork_requests').select(REQUEST_SUMMARY_COLUMNS, { count: 'exact' }).eq('tenant_id', tenantId);
    query = applyRequestFilter(query, filter);
    if (processorId) query = query.eq('processor_partner_id', processorId).eq('status', 'open').eq('current_stage', 'sent_to_processor');
    if (candidates) {
      const terms = [`document_owner_name.ilike.${candidates.pattern}`];
      if (candidates.partnerIds.length) terms.push(`customer_id.in.(${candidates.partnerIds.join(',')})`, `document_owner_partner_id.in.(${candidates.partnerIds.join(',')})`, `processor_partner_id.in.(${candidates.partnerIds.join(',')})`);
      if (candidates.unitIds.length) terms.push(`tracking_unit_id.in.(${candidates.unitIds.join(',')})`);
      query = query.or(terms.join(','));
    }
    const from = page * pageSize;
    const result = await query.order('updated_at', { ascending: false }).range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const rows = result.data || [];
    const maps = await loadSummaryMaps(client, tenantId, rows);
    return { items: rows.map((row) => requestSummaryViewModel(row, maps)), count: result.count || 0, page, pageSize };
  },

  async listProcessorSummaries({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const result = await client.from('paperwork_requests').select('processor_partner_id,stage_entered_at').eq('tenant_id', tenantId).eq('status', 'open').eq('current_stage', 'sent_to_processor').not('processor_partner_id', 'is', null);
    if (result.error) throw result.error;
    const rows = result.data || [];
    const partnerIds = [...new Set(rows.map((row) => row.processor_partner_id))];
    const partners = partnerIds.length ? await client.from('partners').select('id,name').eq('tenant_id', tenantId).in('id', partnerIds) : { data: [], error: null };
    if (partners.error) throw partners.error;
    const names = new Map((partners.data || []).map((row) => [row.id, row.name]));
    const groups = rows.reduce((map, row) => {
      const current = map.get(row.processor_partner_id) || { id: row.processor_partner_id, name: names.get(row.processor_partner_id) || 'جهة غير محددة', count: 0, oldestAt: null };
      current.count += 1;
      if (!current.oldestAt || row.stage_entered_at < current.oldestAt) current.oldestAt = row.stage_entered_at;
      map.set(row.processor_partner_id, current);
      return map;
    }, new Map());
    return [...groups.values()].sort((a, b) => b.count - a.count);
  },

  async listDocumentSummaries({ tenantId, filter = 'all', search = '', page = 0, pageSize = 30, custodyOnly = false, requestId = null } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const candidates = await resolveSearchCandidates(client, tenantId, search);
    let query = client.from('paperwork_documents').select(DOCUMENT_SUMMARY_COLUMNS, { count: 'exact' }).eq('tenant_id', tenantId);
    if (requestId) query = query.eq('paperwork_request_id', requestId);
    if (custodyOnly) query = query.eq('status', 'in_custody');
    else if (filter && filter !== 'all') query = query.eq('status', filter);
    if (candidates) {
      const terms = [`document_owner_name.ilike.${candidates.pattern}`, `document_title.ilike.${candidates.pattern}`, `manual_item_description.ilike.${candidates.pattern}`];
      if (candidates.partnerIds.length) terms.push(`owner_partner_id.in.(${candidates.partnerIds.join(',')})`);
      if (candidates.unitIds.length) terms.push(`tracking_unit_id.in.(${candidates.unitIds.join(',')})`);
      query = query.or(terms.join(','));
    }
    const from = page * pageSize;
    const result = await query.order('updated_at', { ascending: false }).range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const rows = result.data || [];
    const maps = await loadSummaryMaps(client, tenantId, rows, { documentRows: true });
    return { items: rows.map((row) => documentSummaryViewModel(row, maps)), count: result.count || 0, page, pageSize };
  },
};
