import { requireSupabase } from '@/core/lib/supabase';

const unitId = (line) => line.trackingUnitId || line.tracking_unit_id || line.trackingUnit?.id || null;

async function identifiers(client, tenantId, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await client.from('stock_tracking_unit_identifiers')
    .select('tracking_unit_id,value,is_not_available,product_tracking_identifier_types(name,code)')
    .eq('tenant_id', tenantId).in('tracking_unit_id', ids);
  if (error) throw error;
  return (data || []).reduce((map, row) => {
    const list = map.get(row.tracking_unit_id) || [];
    list.push({ code: row.product_tracking_identifier_types?.code || '', label: row.product_tracking_identifier_types?.name || '', value: row.is_not_available ? 'غير متاح' : row.value || '' });
    map.set(row.tracking_unit_id, list); return map;
  }, new Map());
}

export async function listSaleReturnContext({ tenantId, sale }) {
  const client = requireSupabase(); const lines = sale?.items?.length ? sale.items : sale?.lines || [];
  const lineIds = lines.map((line) => line.id);
  const [{ data: previous, error: previousError }, { data: requests, error: requestError }] = await Promise.all([
    lineIds.length ? client.from('showroom_sale_return_lines').select('original_sale_line_id,quantity,line_action,showroom_sale_return_operations!inner(status)').eq('tenant_id', tenantId).in('original_sale_line_id', lineIds) : { data: [] },
    lineIds.length ? client.from('paperwork_requests').select('id,sale_line_id,status,current_stage').eq('tenant_id', tenantId).in('sale_line_id', lineIds).neq('status', 'cancelled') : { data: [] },
  ]);
  if (previousError) throw previousError; if (requestError) throw requestError;
  const returned = new Map(); (previous || []).forEach((row) => { if (row.showroom_sale_return_operations?.status !== 'cancelled') returned.set(row.original_sale_line_id, (returned.get(row.original_sale_line_id) || 0) + Number(row.quantity)); });
  const requestMap = new Map((requests || []).map((row) => [row.sale_line_id, row]));
  const requestIds = (requests || []).map((row) => row.id); const trackingIds = lines.map(unitId).filter(Boolean);
  const [{ data: docs, error: docsError }, idsMap] = await Promise.all([
    requestIds.length || trackingIds.length ? client.from('paperwork_documents').select('paperwork_request_id,tracking_unit_id').eq('tenant_id', tenantId).or([requestIds.length ? `paperwork_request_id.in.(${requestIds.join(',')})` : '', trackingIds.length ? `tracking_unit_id.in.(${trackingIds.join(',')})` : ''].filter(Boolean).join(',')) : { data: [] },
    identifiers(client, tenantId, trackingIds),
  ]); if (docsError) throw docsError;
  return lines.map((line) => {
    const original = Number(line.quantity || 0); const returnedQuantity = returned.get(line.id) || 0; const request = requestMap.get(line.id); const trackingUnitId = unitId(line);
    const hasAnswer = (docs || []).some((doc) => doc.paperwork_request_id === request?.id || doc.tracking_unit_id === trackingUnitId) || request?.status === 'done' || ['received_from_processor', 'client_notified', 'delivered'].includes(request?.current_stage);
    const availableQuantity = Math.max(original - returnedQuantity, 0);
    return { ...line, trackingUnitId, identifiers: idsMap.get(trackingUnitId) || [], originalQuantity: original, returnedQuantity, availableQuantity, paperworkRequest: request || null, hasPaperworkAnswer: hasAnswer, blockedReason: hasAnswer ? 'لا يمكن إرجاع هذه القطعة لأن جواب الأوراق تم استخراجه أو استلامه بالفعل. يلزم إجراء استثنائي مستقل.' : availableQuantity <= 0 ? 'سبق إرجاع السطر بالكامل.' : '' };
  });
}

export async function listReplacementCandidates({ tenantId, excludedIds = [], search = '', limit = 50, offset = 0 }) {
  const client = requireSupabase(); let query = client.from('stock_tracking_units').select('id,product_product_id,product_template_id,tracking_number,status,data_status,created_at').eq('tenant_id', tenantId).eq('status', 'in_stock').eq('data_status', 'complete');
  if (excludedIds.length) query = query.not('id', 'in', `(${excludedIds.join(',')})`);
  if (search.trim()) query = query.ilike('tracking_number', `%${search.trim()}%`);
  const { data, error } = await query.order('created_at').order('id').range(offset, offset + limit - 1); if (error) throw error;
  const units = data || []; const productIds = [...new Set(units.map((row) => row.product_product_id))];
  const [{ data: products, error: productError }, idsMap] = await Promise.all([client.from('product_products').select('id,display_name,sale_price').eq('tenant_id', tenantId).in('id', productIds).eq('is_active', true), identifiers(client, tenantId, units.map((row) => row.id))]);
  if (productError) throw productError; const productMap = new Map((products || []).map((row) => [row.id, row]));
  return units.filter((row) => productMap.has(row.product_product_id)).map((row) => ({ ...row, product: productMap.get(row.product_product_id), identifiers: idsMap.get(row.id) || [] }));
}

export async function previewConfirmedSaleReturn({ tenantId, saleId, lines }) {
  const { data, error } = await requireSupabase().rpc('preview_confirmed_showroom_sale_return', { p_tenant_id: tenantId, p_sale_id: saleId, p_lines: lines });
  if (error) throw new Error(error.message || 'تعذر معاينة المرتجع أو الاستبدال.'); return data;
}

export async function createConfirmedSaleReturn({ tenantId, saleId, lines, reasonCode, reason, idempotencyKey }) {
  const { data, error } = await requireSupabase().rpc('create_confirmed_showroom_sale_return', { p_tenant_id: tenantId, p_sale_id: saleId, p_lines: lines, p_reason_code: reasonCode, p_reason: reason, p_idempotency_key: idempotencyKey });
  if (error) throw new Error(error.message || 'تعذر تنفيذ المرتجع أو الاستبدال.'); return data;
}

export async function listSaleReturnHistory({ tenantId, saleId }) {
  const { data, error } = await requireSupabase().from('showroom_sale_return_operations').select('*,showroom_sale_return_lines(*)').eq('tenant_id', tenantId).or(`original_sale_id.eq.${saleId},replacement_sale_id.eq.${saleId}`).order('created_at', { ascending: false });
  if (error) throw error; return data || [];
}
export const saleReturnService = { listSaleReturnContext, listReplacementCandidates, previewConfirmedSaleReturn, createConfirmedSaleReturn, listSaleReturnHistory };
