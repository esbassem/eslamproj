import { requireSupabase } from '@/core/lib/supabase';

const SALE_COLUMNS = `
  id, tenant_id, branch_id, customer_id, sale_date, status, total_amount,
  notes, account_move_id, created_by, created_at, updated_at, showroom_config_id
`;

function requireTenantId(tenantId) {
  if (!tenantId) throw new Error('تعذر تحديد المنشأة الحالية.');
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCustomer(record) {
  if (!record) return null;
  return {
    id: record.id,
    name: record.name || '',
    phone: record.phone1 || record.phone2 || '',
    phone1: record.phone1 || '',
    phone2: record.phone2 || '',
    address: record.address || '',
    nationalId: record.national_id || '',
  };
}

async function loadCustomers(client, tenantId, sales) {
  const ids = [...new Set(sales.map((sale) => sale.customer_id).filter(Boolean))];
  if (!ids.length) return new Map();
  const { data, error } = await client
    .from('partners')
    .select('id, name, phone1, phone2, address, national_id')
    .eq('tenant_id', tenantId)
    .in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, normalizeCustomer(row)]));
}

async function loadAccountingBalances(client, tenantId, sales) {
  if (!sales.length) return new Map();
  const saleIds = sales.map((sale) => sale.id);
  const moveIds = [...new Set(sales.map((sale) => sale.account_move_id).filter(Boolean))];
  const [byIdResult, byRefResult, accountsResult] = await Promise.all([
    moveIds.length
      ? client.from('account_moves').select('id, ref').eq('tenant_id', tenantId)
        .eq('move_type', 'sale').eq('state', 'posted').in('id', moveIds)
      : Promise.resolve({ data: [], error: null }),
    client.from('account_moves').select('id, ref').eq('tenant_id', tenantId)
      .eq('move_type', 'sale').eq('state', 'posted')
      .in('ref', saleIds.map((saleId) => `showroom_sale:${saleId}`)),
    client.from('account_accounts').select('id').eq('tenant_id', tenantId).eq('code', '114001'),
  ]);
  const failed = [byIdResult, byRefResult, accountsResult].find((result) => result.error);
  if (failed?.error) throw failed.error;

  const moves = [...(byIdResult.data || []), ...(byRefResult.data || [])];
  const movesById = new Map(moves.map((move) => [move.id, move]));
  const movesByRef = new Map(moves.filter((move) => move.ref).map((move) => [move.ref, move]));
  const moveBySale = new Map(sales.map((sale) => [
    sale.id,
    movesById.get(sale.account_move_id) || movesByRef.get(`showroom_sale:${sale.id}`) || null,
  ]));
  const linkedMoveIds = [...new Set([...moveBySale.values()].map((move) => move?.id).filter(Boolean))];
  const accountIds = (accountsResult.data || []).map((account) => account.id);
  if (!linkedMoveIds.length || !accountIds.length) return new Map();

  const { data: lines, error: linesError } = await client
    .from('account_move_lines')
    .select('id, move_id, debit')
    .eq('tenant_id', tenantId)
    .in('move_id', linkedMoveIds)
    .in('account_id', accountIds)
    .gt('debit', 0);
  if (linesError) throw linesError;
  const lineIds = (lines || []).map((line) => line.id);
  const reconciliationsResult = lineIds.length
    ? await client.from('account_partial_reconcile').select('debit_move_id, amount')
      .eq('tenant_id', tenantId).in('debit_move_id', lineIds)
    : { data: [], error: null };
  if (reconciliationsResult.error) throw reconciliationsResult.error;

  const paidByLine = new Map();
  (reconciliationsResult.data || []).forEach((row) => {
    paidByLine.set(row.debit_move_id, toNumber(paidByLine.get(row.debit_move_id)) + toNumber(row.amount));
  });
  const totalsByMove = new Map();
  (lines || []).forEach((line) => {
    const current = totalsByMove.get(line.move_id) || { original: 0, paid: 0 };
    current.original += toNumber(line.debit);
    current.paid += toNumber(paidByLine.get(line.id));
    totalsByMove.set(line.move_id, current);
  });
  return new Map(sales.map((sale) => {
    const totals = totalsByMove.get(moveBySale.get(sale.id)?.id);
    if (!totals) return [sale.id, null];
    const paidAmount = Math.round(totals.paid * 100) / 100;
    return [sale.id, {
      paidAmount,
      remainingAmount: Math.max(Math.round((totals.original - paidAmount) * 100) / 100, 0),
    }];
  }));
}

function normalizeSale(record, customers, balances) {
  const totalAmount = toNumber(record.total_amount);
  const balance = balances.get(record.id);
  return {
    id: record.id,
    tenantId: record.tenant_id,
    branchId: record.branch_id,
    customerId: record.customer_id,
    saleDate: record.sale_date,
    status: record.status || 'pending',
    totalAmount,
    paidAmount: balance?.paidAmount || 0,
    remainingAmount: balance?.remainingAmount ?? totalAmount,
    notes: record.notes || '',
    accountMoveId: record.account_move_id,
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    showroomConfigId: record.showroom_config_id,
    customer: customers.get(record.customer_id) || null,
  };
}

async function loadSales({ tenantId, saleId = null, status = 'all', limit = 150 } = {}) {
  requireTenantId(tenantId);
  const client = requireSupabase();
  let query = client.from('showroom_sales').select(SALE_COLUMNS).eq('tenant_id', tenantId);
  if (saleId) query = query.eq('id', saleId);
  if (status && status !== 'all') query = query.eq('status', status);
  query = query.order('sale_date', { ascending: false }).order('created_at', { ascending: false });
  if (!saleId) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  const sales = data || [];
  const [customers, balances] = await Promise.all([
    loadCustomers(client, tenantId, sales),
    loadAccountingBalances(client, tenantId, sales),
  ]);
  return sales.map((sale) => normalizeSale(sale, customers, balances));
}

export const motoCustomerCareService = {
  listSales(options = {}) {
    return loadSales(options);
  },

  async getSaleDetails({ tenantId, saleId } = {}) {
    if (!saleId) throw new Error('تعذر تحديد عملية البيع.');
    const rows = await loadSales({ tenantId, saleId });
    if (!rows[0]) throw new Error('عملية البيع غير موجودة.');
    return rows[0];
  },
};
