import { requireSupabase } from '@/core/lib/supabase';
import { getSaleReceiptContext } from '@/features/finance/sales/financialSalesContext.service';

const SALE_COLUMNS = `
  id, tenant_id, branch_id, customer_id, sale_number, effective_sale_date,
  status, total_amount, notes, is_historical, created_by, created_at, updated_at
`;

function requireTenantId(tenantId) {
  if (!tenantId) throw new Error('تعذر تحديد المنشأة الحالية.');
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
  const { data, error } = await client.from('partners')
    .select('id, name, phone1, phone2, address, national_id')
    .eq('tenant_id', tenantId).in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.id, normalizeCustomer(row)]));
}

async function loadReceiptContexts(tenantId, sales) {
  const rows = await Promise.all(sales.map(async (sale) => {
    try {
      return [sale.id, await getSaleReceiptContext({ tenantId, saleId: sale.id })];
    } catch {
      return [sale.id, null];
    }
  }));
  return new Map(rows);
}

function normalizeSale(record, customers, receipts) {
  const receipt = receipts.get(record.id);
  const totalAmount = Number(record.total_amount || 0);
  const remainingAmount = receipt ? Number(receipt.residual || 0) : totalAmount;
  return {
    id: record.id,
    tenantId: record.tenant_id,
    branchId: record.branch_id,
    customerId: record.customer_id,
    saleNumber: record.sale_number,
    saleDate: record.effective_sale_date,
    status: record.status || 'draft',
    totalAmount,
    paidAmount: receipt ? Number(receipt.allocated_total || 0) : 0,
    remainingAmount,
    notes: record.notes || '',
    historical: record.is_historical === true,
    accountMoveId: null,
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    customer: customers.get(record.customer_id) || null,
  };
}

async function loadSales({ tenantId, saleId = null, status = 'all', limit = 150 } = {}) {
  requireTenantId(tenantId);
  const client = requireSupabase();
  let query = client.from('sales').select(SALE_COLUMNS).eq('tenant_id', tenantId);
  if (saleId) query = query.eq('id', saleId);
  if (status && status !== 'all') query = query.eq('status', status);
  query = query.order('effective_sale_date', { ascending: false }).order('created_at', { ascending: false });
  if (!saleId) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw error;
  const sales = data || [];
  const [customers, receipts] = await Promise.all([
    loadCustomers(client, tenantId, sales),
    loadReceiptContexts(tenantId, sales),
  ]);
  return sales.map((sale) => normalizeSale(sale, customers, receipts));
}

export const motoCustomerCareService = {
  listSales: (options = {}) => loadSales(options),
  async getSaleDetails({ tenantId, saleId } = {}) {
    if (!saleId) throw new Error('تعذر تحديد عملية البيع.');
    const rows = await loadSales({ tenantId, saleId });
    if (!rows[0]) throw new Error('عملية البيع غير موجودة.');
    return rows[0];
  },
};
