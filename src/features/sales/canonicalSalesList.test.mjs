import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeSaleListItem,
  normalizeSalesListResponse,
} from './services/sales.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../supabase/migrations/20260907120000_register_canonical_sales_and_list_contract.sql');
const page = read('./pages/SalesOverviewPage.jsx');
const records = read('./components/SalesRecords.jsx');
const hook = read('./hooks/useSalesList.js');
const service = read('./services/sales.service.js');
const appService = read('../../services/apps.service.js');
const dashboard = read('../dashboard/pages/DashboardPage.jsx');

test('Sales module metadata is canonical, duplicate-safe, and preserves tenant installation state', () => {
  assert.match(migration, /'sales',[\s\S]*'المبيعات',[\s\S]*'\/app\/sales'/);
  assert.match(migration, /on conflict \(technical_name\) do update/);
  assert.match(migration, /application = excluded\.application/);
  assert.match(migration, /installable = excluded\.installable/);
  assert.doesNotMatch(migration, /insert into public\.tenant_modules|update public\.tenant_modules|delete from public\.tenant_modules/);
});

test('App Store and Dashboard remain catalog-driven with no Sales hard-code', () => {
  assert.match(appService, /from\('ir_modules'\)[\s\S]*eq\('application', true\)/);
  assert.match(appService, /from\('tenant_modules'\)[\s\S]*eq\('state', 'installed'\)/);
  assert.match(dashboard, /getApplicationModulesWithTenantState\(tenant\.id\)/);
  assert.doesNotMatch(dashboard, /code:\s*['"]sales['"]/);
});

test('list_sales is server-paginated and supports only the required business filters', () => {
  assert.match(migration, /create or replace function public\.list_sales\(/);
  assert.match(migration, /limit v_page_size[\s\S]*offset \(v_page - 1\) \* v_page_size/);
  for (const filter of ['p_search', 'p_status', 'p_branch_id', 'p_date_from', 'p_date_to', 'p_payment_status', 'p_fulfillment_status']) {
    assert.match(migration, new RegExp(filter));
  }
  assert.doesNotMatch(migration, /account_id['"]|journal_id['"]|receivable_line_id['"]/);
});

test('list_sales enforces membership permission and branch scope in the database', () => {
  assert.match(migration, /current_tenant_id\(\)/);
  assert.match(migration, /current_tenant_user_id\(\)/);
  assert.match(migration, /has_permission\('sales\.access', v_tenant_id\)/);
  assert.match(migration, /has_permission\('sales\.view', v_tenant_id\)/);
  assert.match(migration, /public\.has_branch_access\(sale\.branch_id\)/);
  assert.match(migration, /SALES_BRANCH_SCOPE_DENIED/);
  assert.doesNotMatch(migration, /role\s*=|role\s+in/);
});

test('payment and fulfillment summaries derive from canonical links without exposing internals', () => {
  assert.match(migration, /sale_confirmation_links confirmation/);
  assert.match(migration, /financial_sale_postings posting/);
  assert.match(migration, /account_move_lines receivable/);
  assert.match(migration, /inventory_reservations reservation/);
  assert.match(migration, /'settled_amount'/);
  assert.match(migration, /'outstanding_amount'/);
  for (const value of ['unpaid', 'partially_paid', 'paid', 'unreserved', 'reserved', 'partially_delivered', 'delivered', 'not_required']) {
    assert.match(migration, new RegExp(`'${value}'`));
  }
});

test('Sales list service is the only RPC boundary and normalizes the DTO', () => {
  assert.match(service, /client\.rpc\('list_sales'/);
  assert.match(service, /normalizeSalesListResponse\(data\)/);
  assert.doesNotMatch(page, /requireSupabase|client\.rpc\(|supabase\.from\(/);
  assert.doesNotMatch(hook, /requireSupabase|client\.rpc\(|supabase\.from\(/);

  const item = normalizeSaleListItem({
    id: 'sale-1', sale_number: 'SAL-2026-000001', effective_sale_date: '2026-09-07',
    customer: { id: 'customer-1', name: 'Customer' }, branch: { id: 'branch-1', name: 'Branch' },
    created_by: { id: 'user-1', name: 'User' }, status: 'confirmed', total_amount: '50000',
    currency_code: 'egp', payment: { status: 'partially_paid', settled_amount: '20000', outstanding_amount: '30000' },
    fulfillment: { status: 'reserved' }, version: 2,
  });
  assert.deepEqual([item.totalAmount, item.payment.settledAmount, item.payment.outstandingAmount], [50000, 20000, 30000]);
  assert.equal(item.currencyCode, 'EGP');
  assert.equal(item.fulfillment.status, 'reserved');
});

test('response normalization preserves pagination and accessible branch options', () => {
  const result = normalizeSalesListResponse({
    items: [], page: 2, page_size: 25, total_count: 31, page_count: 2,
    filter_options: { branches: [{ id: 'branch-1', name: 'Main' }] },
  });
  assert.deepEqual(
    [result.page, result.pageSize, result.totalCount, result.pageCount, result.filterOptions.branches.length],
    [2, 25, 31, 2, 1],
  );
});

test('Sales overview requests the complete outstanding-invoice list with product and residual details', () => {
  assert.match(page, /can\('sales\.create'\)/);
  assert.match(page, /useSalesList/);
  assert.match(page, /pageSize: 100/);
  assert.match(page, /المبالغ المستحقة/);
  assert.match(page, /paymentStatus: 'outstanding'/);
  assert.match(page, /status: 'confirmed'/);
  assert.doesNotMatch(page, /sale\.branch\.name/);
  assert.match(page, /sale\.customer\.name/);
  assert.match(page, /sale\.productSummary/);
  assert.match(page, /sale\.effectiveSaleDate/);
  assert.match(page, /sale\.totalAmount/);
  assert.match(page, /sale\.payment\.outstandingAmount/);
  assert.doesNotMatch(page, /SAMPLE_SALESPEOPLE|مبيعات السيلز/);
  assert.doesNotMatch(page, /SalesRecordsPreview/);
  assert.match(records, /createSaleSideSheetLocation\(location, sale\.id\)/);
});
