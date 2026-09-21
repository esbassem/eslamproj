import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeSalesOverview,
  SALES_OVERVIEW_PERIODS,
} from './services/salesOverview.model.js';
import { normalizeSalesBranchReports } from './services/salesBranchReports.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../supabase/migrations/20260907150000_canonical_sales_overview_read_model.sql');
const branchMigration = read('../../../supabase/migrations/20260911060000_sales_branch_reports.sql');
const monthlyBranchMigration = read('../../../supabase/migrations/20260913120000_sales_monthly_branch_reports.sql');
const branchBreakdownMigration = read('../../../supabase/migrations/20260913130000_sales_monthly_branch_report_breakdown.sql');
const branchOutstandingMigration = read('../../../supabase/migrations/20260916120000_sales_branch_all_time_outstanding.sql');
const salesListOutstandingMigration = read('../../../supabase/migrations/20260916130000_sales_list_outstanding_filter.sql');
const historicalOutstandingMigration = read('../../../supabase/migrations/20260916140000_align_historical_sales_outstanding_reads.sql');
const page = read('./pages/SalesOverviewPage.jsx');
const hook = read('./hooks/useSalesOverview.js');
const branchHook = read('./hooks/useSalesBranchReports.js');
const service = read('./services/sales.service.js');

test('1. overview uses one central canonical read contract', () => {
  assert.match(migration, /create or replace function public\.get_sales_overview\(/);
  assert.match(service, /rpc\('get_sales_overview'/);
  assert.doesNotMatch(page, /requireSupabase|client\.rpc\(|supabase\.from\(/);
  assert.match(branchMigration, /create or replace function public\.get_sales_branch_reports\(\)/);
  assert.match(monthlyBranchMigration, /create or replace function public\.get_sales_monthly_branch_reports\(p_month date default null\)/);
  assert.match(service, /rpc\('get_sales_monthly_branch_reports'/);
});

test('2. contract fails closed on membership and sales access/view permissions', () => {
  assert.match(migration, /current_tenant_id\(\)/);
  assert.match(migration, /current_tenant_user_id\(\)/);
  assert.match(migration, /has_permission\('sales\.access', v_tenant_id\)/);
  assert.match(migration, /has_permission\('sales\.view', v_tenant_id\)/);
});

test('3. contract applies accessible branch scope and rejects an invalid explicit branch', () => {
  assert.match(migration, /public\.has_branch_access\(branch\.id\)/);
  assert.match(migration, /SALES_OVERVIEW_BRANCH_SCOPE_DENIED/);
  assert.match(migration, /p_branch_id is null or sale\.branch_id = p_branch_id/);
});

test('4. overview backend keeps valid periods while the branch landing uses the current calendar month', () => {
  assert.deepEqual(SALES_OVERVIEW_PERIODS.map((period) => period.value), ['today', 'last_7_days', 'this_month']);
  assert.match(migration, /SALES_OVERVIEW_PERIOD_INVALID/);
  assert.match(monthlyBranchMigration, /date_trunc\('month', coalesce\(p_month, current_date\)\)/);
  assert.match(page, /useMemo\(\(\) => monthValue\(new Date\(\)\), \[\]\)/);
  assert.doesNotMatch(page, /availableMonths|setSelectedMonth|sales-report-month/);
  assert.doesNotMatch(page, /SALES_OVERVIEW_PERIODS|setPeriod/);
});

test('5. value and count KPIs include confirmed period rows only', () => {
  assert.match(migration, /from period_rows row_data\s+where row_data\.status = 'confirmed'/);
  assert.match(migration, /'confirmed_sales_count'/);
  assert.match(migration, /'confirmed_sales_value_by_currency'/);
});

test('6. all-sales value preserves server currency groups while consolidating accessible branches', () => {
  assert.match(monthlyBranchMigration, /group by sale\.branch_id, sale\.currency_code/);
  assert.match(page, /CurrencyValues/);
  assert.match(page, /report\.salesValueByCurrency/);
});

test('7. outstanding comes from canonical financial posting residuals', () => {
  assert.match(migration, /public\.financial_sale_postings posting/);
  assert.match(migration, /public\.account_move_lines receivable/);
  assert.match(migration, /receivable\.amount_residual/);
  assert.match(migration, /posting\.source_app = 'sales_core'/);
});

test('8. overview has no legacy payment or showroom dependency', () => {
  for (const source of [migration, page, hook, service]) {
    assert.doesNotMatch(source, /old_cashbox|legacy_payment|features\/showroom|showroom_sales/);
  }
});

test('9. pending delivery is derived from canonical required and delivered quantities', () => {
  assert.match(migration, /public\.sale_delivery_lines delivery/);
  assert.match(migration, /required_quantity > row_data\.delivered_quantity/);
  assert.match(migration, /'partially_delivered'/);
});

test('10. service-only sales are explicitly not required for fulfillment', () => {
  assert.match(migration, /required_quantity, 0\) <= 0 then 'not_required'/);
  assert.match(migration, /filter \(where line\.product_type = 'goods'\)/);
});

test('11. every operational queue preview is bounded to five rows', () => {
  assert.equal((migration.match(/limit 5/g) || []).length, 3);
  assert.match(migration, /'drafts_preview'/);
  assert.match(migration, /'outstanding_preview'/);
  assert.match(migration, /'pending_delivery_preview'/);
});

test('12. recent sales are bounded to seven and use the selected period', () => {
  assert.match(migration, /'recent_sales'/);
  assert.match(migration, /from period_rows row_data[\s\S]*limit 7/);
});

test('13. returned DTO does not expose accounting or raw inventory identifiers', () => {
  for (const forbidden of ["'account_id'", "'journal_id'", "'move_id'", "'receivable_line_id'", "'inventory_reservation_id'", "'event_payload'"]) {
    assert.doesNotMatch(migration, new RegExp(forbidden));
  }
});

test('14. overview page loads through its dedicated hook', () => {
  assert.match(page, /useSalesBranchReports\(\{ tenantId: tenant\?\.id, month: selectedMonth \}\)/);
  assert.match(branchHook, /salesService\.getSalesBranchReports/);
  assert.match(branchHook, /\[month, tenantId\]/);
});

test('15. New Sale action is permission based', () => {
  assert.match(page, /can\('sales\.create'\)/);
  assert.match(page, /to=\{SALES_ROUTES\.create\}/);
  assert.doesNotMatch(page, /role\s*===|tenantUser\?\.role/);
});

test('16. redesigned page renders the Sales heading search and branch reports', () => {
  for (const label of ['المبيعات', 'البحث في جميع المبيعات', 'الفروع']) assert.match(page, new RegExp(label));
  assert.match(page, /reports\.map\(\(report\) =>/);
  assert.match(page, /المبالغ المستحقة/);
  assert.match(page, /sumCurrencyValues/);
  assert.match(page, /paymentStatus: 'outstanding'/);
  assert.match(page, /status: 'confirmed'/);
  assert.match(page, /sale\.productSummary/);
  assert.match(page, /useSalesList/);
  assert.match(page, /pageSize: 100/);
  assert.doesNotMatch(page, /SalesRecordsPreview|OVERVIEW_SALES_PAGE_SIZE/);
});

test('16b. the report header renders a two-column branch matrix with count and revenue', () => {
  for (const label of ['الشهر الحالي', 'عدد الفواتير', 'إجمالي الإيراد']) {
    assert.match(page, new RegExp(label));
  }
  assert.doesNotMatch(page, /تقرير إضافي/);
  assert.match(page, /showCurrency=\{false\}/);
  assert.match(page, /grid-cols-2/);
  assert.match(page, /report\.confirmedSalesCount/);
  assert.match(page, /report\.branch\.name/);
  assert.doesNotMatch(page, /outstandingByCurrency|إجمالي البواقي|>البواقي</);
  assert.doesNotMatch(page, /recharts|chart\.js|victory|d3/);
});

test('17. branch landing omits the retired operational queues and embedded workflows', () => {
  assert.doesNotMatch(page, /draftsPreview|outstandingPreview|pendingDeliveryPreview/);
  assert.doesNotMatch(page, /SettlementDialog|SaleDeliveryDialog|deliverSale|collectPayment/);
});

test('18. search filters the outstanding invoice list and branches use their canonical route', () => {
  assert.match(page, /filters: \{ search,/);
  assert.doesNotMatch(page, /SALES_ROUTES\.list|navigate\(/);
  assert.match(page, /to=\{SALES_ROUTES\.branch\(report\.branch\.id\)\}/);
});

test('19. accessible branches are rendered as route links without client-side filter state', () => {
  assert.match(page, /reports\.map\(\(report\) =>/);
  assert.match(page, /key=\{report\.branch\.id\}/);
  assert.match(page, /SALES_ROUTES\.branch\(report\.branch\.id\)/);
  assert.doesNotMatch(page, /aria-pressed|activeBranchId|setSelectedBranchId/);
  assert.doesNotMatch(page, /multipleBranches/);
  assert.doesNotMatch(page, /shadow-\[|before:absolute/);
});

test('19b. page shell renders independently while only the report region shows loading placeholders', () => {
  assert.match(page, /function OverviewLoading/);
  assert.match(page, /query\.status === 'loading' \? <OverviewLoading/);
  assert.match(page, /Array\.from\(\{ length: 1 \}/);
});

test('20. branch and period changes refresh the single overview request', () => {
  assert.match(service, /p_period: period/);
  assert.match(service, /p_branch_id: branchId \|\| null/);
  assert.match(hook, /\[branchId, period, tenantId\]/);
});

test('21. salesperson performance remains server-aggregated but is not rendered in the summary', () => {
  assert.match(branchBreakdownMigration, /sale\.branch_id = branch\.id and sale\.created_by = person\.created_by/);
  assert.match(branchBreakdownMigration, /'salespeople'/);
  assert.doesNotMatch(page, /report\.salespeople|entry\.confirmedSalesCount/);
});

test('22. redesigned page has one compact empty state for an empty branch scope', () => {
  assert.match(page, /لا توجد فروع متاحة ضمن نطاق عملك/);
  assert.doesNotMatch(page, /لا توجد مبيعات مؤكدة|لا توجد مسودات|لا توجد أرصدة|لا توجد عمليات تسليم/);
});

test('23. loading backend errors and missing branch scope are business friendly', () => {
  assert.match(page, /query\.status === 'loading'/);
  assert.match(page, /query\.status === 'error'/);
  assert.match(page, /لا توجد فروع متاحة ضمن نطاق عملك/);
  assert.match(service, /ليس لديك صلاحية لعرض نظرة المبيعات/);
});

test('24. layout is mobile-first and avoids charts or horizontal tables', () => {
  assert.match(page, /grid gap-3 sm:grid-cols-2 lg:grid-cols-3/);
  assert.match(page, /flex flex-wrap items-center gap-2\.5/);
  assert.doesNotMatch(page, /chart|canvas|overflow-x-auto|<table/);
});

test('25. normalizer produces a safe camelCase multi-currency overview model', () => {
  const overview = normalizeSalesOverview({
    period: { code: 'today', date_from: '2026-09-07', date_to: '2026-09-07' },
    scope: { branches: [{ id: 'branch-1', name: 'Main' }] },
    kpis: {
      confirmed_sales_count: '2',
      confirmed_sales_value_by_currency: [{ currency_code: 'egp', amount: '50000' }],
      outstanding_by_currency: [{ currency_code: 'EGP', amount: '30000' }],
      pending_delivery_count: '1',
    },
    drafts_preview: [{ id: 'draft-1', total_amount: '1000' }],
    salesperson_breakdown: [{
      salesperson: { id: 'user-1', name: 'User' }, confirmed_sales_count: 2,
      sales_value_by_currency: [{ currency_code: 'EGP', amount: 50000 }],
    }],
  });
  assert.deepEqual(
    [overview.period.code, overview.kpis.confirmedSalesCount, overview.kpis.confirmedSalesValueByCurrency[0].amount,
      overview.kpis.outstandingByCurrency[0].amount, overview.kpis.pendingDeliveryCount],
    ['today', 2, 50000, 30000, 1],
  );
  assert.equal(overview.draftsPreview[0].totalAmount, 1000);
  assert.equal(overview.salespersonBreakdown[0].salesperson.name, 'User');
});

test('26. branch reports are access-scoped and aggregate all cards in one request', () => {
  assert.match(branchMigration, /current_tenant_id\(\)/);
  assert.match(branchMigration, /current_tenant_user_id\(\)/);
  assert.match(branchMigration, /has_permission\('sales\.access', v_tenant_id\)/);
  assert.match(branchMigration, /has_permission\('sales\.view', v_tenant_id\)/);
  assert.match(branchMigration, /public\.has_branch_access\(branch\.id\)/);
  assert.doesNotMatch(branchHook, /Promise\.all|reports\.map|branches\.map/);
});

test('27. branch report normalizer preserves per-branch multi-currency metrics', () => {
  const [report] = normalizeSalesBranchReports([{
    branch: { id: 'branch-1', name: 'Main' },
    confirmed_sales_count: '3',
    sales_value_by_currency: [{ currency_code: 'egp', amount: '70000' }],
    outstanding_by_currency: [{ currency_code: 'usd', amount: '120' }],
    all_time_outstanding_by_currency: [{ currency_code: 'egp', amount: '9000' }],
    pending_delivery_count: '2',
    salespeople: [{
      salesperson: { id: 'user-1', name: 'User' },
      confirmed_sales_count: '2',
      sales_value_by_currency: [{ currency_code: 'egp', amount: '50000' }],
    }],
  }]);
  assert.equal(report.branch.id, 'branch-1');
  assert.equal(report.confirmedSalesCount, 3);
  assert.deepEqual(report.salesValueByCurrency[0], { currencyCode: 'EGP', amount: 70000 });
  assert.deepEqual(report.outstandingByCurrency[0], { currencyCode: 'USD', amount: 120 });
  assert.deepEqual(report.allTimeOutstandingByCurrency[0], { currencyCode: 'EGP', amount: 9000 });
  assert.equal(report.pendingDeliveryCount, 2);
  assert.equal(report.salespeople[0].salesperson.name, 'User');
  assert.equal(report.salespeople[0].confirmedSalesCount, 2);
  assert.deepEqual(report.salespeople[0].salesValueByCurrency[0], { currencyCode: 'EGP', amount: 50000 });
});

test('28. branch lifetime outstanding is separate from the selected monthly sales period', () => {
  assert.match(branchOutstandingMigration, /confirmed_sales as materialized/);
  assert.match(branchOutstandingMigration, /monthly_sales as materialized/);
  assert.match(branchOutstandingMigration, /'all_time_outstanding_by_currency'/);
  assert.match(branchOutstandingMigration, /from confirmed_sales sale where sale\.branch_id = branch\.id/);
});

test('29. outstanding invoice preview is enforced by the canonical server filter', () => {
  assert.match(salesListOutstandingMigration, /v_payment_status = ''outstanding''/);
  assert.match(salesListOutstandingMigration, /row_data\.status = ''confirmed''/);
  assert.match(salesListOutstandingMigration, /row_data\.outstanding_amount > 0/);
  assert.match(page, /paymentStatus: 'outstanding'/);
  assert.match(page, /dateFrom: '', dateTo: ''/);
});

test('30. historical invoice residuals use the same financial evidence in lists and branch totals', () => {
  assert.match(historicalOutstandingMigration, /sale_historical_sources historical_source/);
  assert.match(historicalOutstandingMigration, /account_partial_reconcile reconcile/);
  assert.match(historicalOutstandingMigration, /historical_finance\.paid_amount/);
  assert.match(historicalOutstandingMigration, /greatest\(sale\.total_amount - coalesce\(historical_finance\.paid_amount, 0\), 0\)/);
  assert.match(historicalOutstandingMigration, /v_list_definition/);
  assert.match(historicalOutstandingMigration, /v_report_definition/);
});
