import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  clearSaleSideSheetState,
  createSaleSideSheetLocation,
  createSaleSideSheetState,
  getSaleSideSheetId,
  SALE_SIDE_SHEET_HISTORY_KEY,
  setSaleSideSheetParam,
} from './routes/salesSideSheetNavigation.js';
import { createSaleDetailsSurfaceMetadata } from './components/saleDetailsSurfaceMetadata.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const details = read('./components/SaleDetails.jsx');
const detailsPage = read('./pages/SaleDetailsPage.jsx');
const sideSheet = read('./components/SaleDetailsSideSheet.jsx');
const overview = read('./pages/SalesOverviewPage.jsx');
const branch = read('./pages/SalesBranchPage.jsx');
const records = read('./components/SalesRecords.jsx');
const appRouter = read('../../app/router/AppRouter.jsx');
const detailsHook = read('./hooks/useSaleDetails.js');

test('SaleDetails is presentation-independent and receives saleId explicitly', () => {
  assert.match(details, /export function SaleDetails\(\{ saleId, onDetailsStateChange, compact = false \}\)/);
  assert.doesNotMatch(details, /useParams|useSearchParams|PlatformSideSheet|SaleDetailsSideSheet/);
  assert.match(detailsPage, /const \{ saleId = '' \} = useParams\(\)/);
  assert.match(detailsPage, /<SaleDetails saleId=\{saleId\} \/>/);
  assert.match(sideSheet, /<LazySaleDetails[\s\S]*saleId=\{saleId\}[\s\S]*onDetailsStateChange=\{handleDetailsStateChange\}/);
});

test('sale invoice surface header uses the canonical sale number, creation time, and creator', () => {
  const metadata = createSaleDetailsSurfaceMetadata({
    saleNumber: 'SAL-42',
    createdAt: '2026-09-19T10:30:00Z',
    createdBy: { name: 'أحمد' },
  });

  assert.equal(metadata.title, 'فاتورة بيع رقم SAL-42');
  assert.match(metadata.description, /^تاريخ الإنشاء: .+ · أنشأها: أحمد$/);
  assert.equal(
    createSaleDetailsSurfaceMetadata({ createdAt: 'invalid', createdBy: {} }).title,
    'فاتورة بيع — مسودة',
  );
  assert.equal(
    createSaleDetailsSurfaceMetadata({ createdAt: 'invalid', createdBy: {} }).description,
    'تاريخ الإنشاء: غير متاح · أنشأها: غير محدد',
  );
});

test('side-sheet details use compact density without changing the full-page details view', () => {
  assert.match(sideSheet, /density="compact"/);
  assert.match(sideSheet, /<LazySaleDetails[\s\S]*compact[\s\S]*onDetailsStateChange/);
  assert.match(details, /className=\{compact \? 'sale-details-compact' : undefined\}/);
  assert.match(detailsPage, /<SaleDetails saleId=\{saleId\} \/>/);
});

test('sale summary leads the surface and the compact invoice cards follow it', () => {
  assert.match(details, /<div className="space-y-6">\s*<SaleHeader sale=\{details\.sale\} embedded=\{compact\} \/>\s*\{compact \? \([\s\S]*<SaleItemsDetails[\s\S]*<SalePaymentSummary[\s\S]*\{!details\.sale\.isHistorical \? <SaleActions/);
});

test('invoice notices sit beside the title without consuming another header row', () => {
  assert.match(details, /notice: actionNotice/);
  assert.match(sideSheet, /headerNotice=\{activeHeader\.notice \? \(/);
  assert.match(sideSheet, /فاتورة تاريخية للعرض فقط — الإجراءات التشغيلية غير متاحة/);
  assert.match(sideSheet, /min-w-0 basis-72/);
  assert.match(sideSheet, /className="truncate">\{activeHeader\.notice\}/);
  assert.doesNotMatch(sideSheet, /className=\{`mt-1/);
  assert.doesNotMatch(details, /border-sky-200 bg-sky-50/);
  assert.doesNotMatch(details, /mb-5 rounded-xl border border-amber-200/);
});

test('sale query operations preserve every unrelated search parameter', () => {
  const opened = setSaleSideSheetParam('?search=moto&page=3&status=confirmed', 'sale A');
  assert.equal(opened, '?search=moto&page=3&status=confirmed&sale=sale+A');
  assert.equal(getSaleSideSheetId(opened), 'sale A');
  assert.equal(setSaleSideSheetParam(opened, 'sale-B'), '?search=moto&page=3&status=confirmed&sale=sale-B');
  assert.equal(setSaleSideSheetParam(opened, ''), '?search=moto&page=3&status=confirmed');
});

test('side-sheet locations preserve overview and branch route context', () => {
  const overviewLocation = createSaleSideSheetLocation({ pathname: '/app/sales', search: '?page=2', hash: '' }, 'sale-1');
  const branchLocation = createSaleSideSheetLocation({ pathname: '/app/sales/branches/branch-7', search: '?month=2026-09', hash: '#list' }, 'sale-2');
  assert.deepEqual(overviewLocation, { pathname: '/app/sales', search: '?page=2&sale=sale-1', hash: '' });
  assert.deepEqual(branchLocation, { pathname: '/app/sales/branches/branch-7', search: '?month=2026-09&sale=sale-2', hash: '#list' });
});

test('history marker distinguishes list navigation from a direct URL entry', () => {
  const state = createSaleSideSheetState({ retained: true });
  assert.equal(state[SALE_SIDE_SHEET_HISTORY_KEY], true);
  assert.deepEqual(clearSaleSideSheetState(state), { retained: true });
  assert.equal(clearSaleSideSheetState(null), null);
});

test('adapter opens from URL, lazy-loads details, and closes safely', () => {
  assert.match(sideSheet, /getSaleSideSheetId\(location\.search\)/);
  assert.match(sideSheet, /open=\{Boolean\(saleId\)\}/);
  assert.match(sideSheet, /loadSaleDetailsModule[\s\S]*import\('\.\/SaleDetails'\)/);
  assert.match(sideSheet, /lazy\(loadSaleDetailsModule\)/);
  assert.match(sideSheet, /<Suspense fallback=\{<SaleDetailsModuleFallback \/>\}>/);
  assert.match(sideSheet, /placement="end"/);
  assert.match(sideSheet, /size="xl"/);
  assert.match(sideSheet, /if \(openedFromList\)[\s\S]*navigate\(-1\)/);
  assert.match(sideSheet, /replace: true/);
  assert.match(sideSheet, /setSaleSideSheetParam\(location\.search, ''\)/);
  assert.match(sideSheet, /<LazySaleDetails[\s\S]*key=\{saleId\}/);
  assert.doesNotMatch(sideSheet, /max-w-|w-\[/);
});

test('the surface shell commits before feature mounting without an arbitrary delay', () => {
  assert.match(sideSheet, /void loadSaleDetailsModule\(\)/);
  assert.match(sideSheet, /requestAnimationFrame\(\(\) => \{[\s\S]*requestAnimationFrame\(\(\) => setMountedSaleId\(saleId\)\)/);
  assert.match(sideSheet, /saleId && mountedSaleId === saleId/);
  assert.doesNotMatch(sideSheet, /setTimeout|animate-pulse/);
});

test('invalid or failed detail reads remain visible and retryable inside the surface', () => {
  assert.match(detailsHook, /salesService\.getSaleDetails/);
  assert.match(detailsHook, /status: 'error'/);
  assert.match(details, /details\.status === 'error'/);
  assert.match(details, /onClick=\{details\.reload\}/);
  assert.match(sideSheet, /onOpenChange=\{\(nextOpen\)/);
});

test('active Sales lists use URL links and keep the sheet mounted behind the portal', () => {
  for (const source of [overview, branch]) {
    assert.match(source, /createSaleSideSheetLocation\(location, sale\.id\)/);
    assert.match(source, /createSaleSideSheetState\(location\.state\)/);
    assert.match(source, /<SaleDetailsSideSheet \/>/);
  }
  assert.match(records, /createSaleSideSheetLocation\(location, sale\.id\)/);
});

test('canonical full-page details route remains available', () => {
  assert.match(appRouter, /path=":saleId" element=\{<SaleDetailsPage \/>\}/);
  assert.match(detailsPage, /<SalesPageShell/);
  assert.match(detailsPage, /<SaleDetails saleId=\{saleId\} \/>/);
});
