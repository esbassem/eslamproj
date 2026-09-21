import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildDraftCommandPayload,
  draftLineTotal,
  normalizeDraftOptions,
  normalizeSaleDraft,
  validateDraftForm,
} from './services/salesDraft.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../supabase/migrations/20260907130000_canonical_sale_draft_workspace.sql');
const service = read('./services/sales.service.js');
const hook = read('./hooks/useSaleDraft.js');
const editor = read('./create/SaleDraftEditor.jsx');
const customerSelector = read('./create/SaleCustomerSelector.jsx');
const productSelector = read('./create/ProductSelector.jsx');
const trackingSelector = read('./create/TrackingUnitSelector.jsx');
const itemRow = read('./create/SaleItemRow.jsx');
const createPage = read('./pages/SaleCreatePage.jsx');
const detailsPage = read('./components/SaleDetails.jsx');
const detailsHook = read('./hooks/useSaleDetails.js');

test('draft workspace read contracts are paginated, scoped, and business-safe', () => {
  for (const name of ['get_sale_draft_options', 'search_sale_customers', 'search_sale_products', 'get_sale_quantity_availability', 'search_sale_tracking_units']) {
    assert.match(migration, new RegExp(`create or replace function public\\.${name}\\(`));
  }
  assert.match(migration, /has_permission\('sales\.access'/);
  assert.match(migration, /has_branch_access\(p_branch_id\)/);
  assert.match(migration, /has_stock_location_access\(p_location_id\)/);
  assert.match(migration, /limit v_page_size \+ 1/);
  assert.doesNotMatch(migration, /account_id['"]|journal_id['"]|receivable_line_id['"]/);
});

test('draft inventory intent is persisted without reserving or posting', () => {
  assert.match(migration, /create table if not exists public\.sale_draft_inventory_intents/);
  assert.match(migration, /Non-reserving stock selection intent/);
  assert.match(migration, /create or replace function public\.update_sale_draft\([\s\S]*p_inventory_intents jsonb/);
  assert.doesNotMatch(migration, /perform public\.reserve_inventory|perform public\.post_financial_sale|perform public\.confirm_sale/);
});

test('draft update keeps existing command behavior and adds full-payload idempotency', () => {
  assert.match(migration, /command_type = 'update_draft_with_intent'/);
  assert.match(migration, /request_fingerprint <> v_fingerprint/);
  assert.match(migration, /p_expected_version/);
  assert.match(migration, /SALES_VERSION_CONFLICT/);
  assert.match(migration, /v_result := public\.update_sale_draft\([\s\S]*v_internal_key/);
});

test('draft options normalization preserves authoritative defaults and scope choices', () => {
  const result = normalizeDraftOptions({
    default_branch_id: 'branch-1', default_stock_location_id: 'location-1',
    branches: [{ id: 'branch-1', name: 'Main', code: 'M' }],
    locations: [{ id: 'location-1', branch_id: 'branch-1', name: 'Stock', code: 'S', location_type: 'internal' }],
  });
  assert.equal(result.defaultBranchId, 'branch-1');
  assert.equal(result.locations[0].branchId, 'branch-1');
});

test('draft payload contains only business lines and non-reserving selection intent', () => {
  const payload = buildDraftCommandPayload({
    branchId: 'branch-1', customer: { id: 'customer-1' }, effectiveSaleDate: '2026-09-07',
    currencyCode: 'EGP', notes: '', locationId: 'location-1',
    lines: [
      { product: { id: 'serial-1', name: 'Moto', productType: 'goods', tracking: 'serial' }, description: 'Moto', quantity: '1', unitPrice: '50000', trackingUnit: { id: 'unit-1' } },
      { product: { id: 'quantity-1', name: 'Item', productType: 'goods', tracking: 'none' }, description: 'Item', quantity: '2', unitPrice: '100', trackingUnit: null },
      { product: { id: 'service-1', name: 'Service', productType: 'service', tracking: 'none' }, description: 'Service', quantity: '1', unitPrice: '50', trackingUnit: null },
    ],
  });
  assert.equal(payload.lines.length, 3);
  assert.equal(payload.inventoryIntents.length, 2);
  assert.equal(payload.inventoryIntents[0].tracking_unit_id, 'unit-1');
  assert.equal(payload.inventoryIntents[1].quantity, 2);
  assert.equal(draftLineTotal({ quantity: '2', unitPrice: '100.13' }), 200.26);
  assert.equal(validateDraftForm({ ...payload, customer: { id: 'customer-1' }, lines: [] }), 'أضف بند بيع واحدًا على الأقل.');
});

test('get_sale normalization restores a persisted editable draft', () => {
  const sale = normalizeSaleDraft({
    id: 'sale-1', status: 'draft', version: 2, branch: { id: 'branch-1', name: 'Main' },
    customer: { id: 'customer-1', name: 'Customer', phone: '0100' }, effective_sale_date: '2026-09-07',
    currency_code: 'EGP', draft_inventory_location_id: 'location-1',
    lines: [{ id: 'line-1', product: { id: 'product-1', name: 'Moto', tracking: 'serial', product_type: 'goods', sale_price: 50000 }, quantity: 1, unit_price: 50000, draft_inventory_intents: [{ tracking_unit_id: 'unit-1', tracking_number: 'CH-1', location_id: 'location-1', quantity: 1 }] }],
  });
  assert.equal(sale.lines[0].trackingUnit.id, 'unit-1');
  assert.equal(sale.draftInventoryLocationId, 'location-1');
});

test('service layer is the only Supabase boundary for the draft editor', () => {
  for (const rpc of ['create_sale', 'update_sale_draft', 'get_sale', 'get_sale_readiness', 'search_sale_customers', 'search_sale_products', 'search_sale_tracking_units']) {
    assert.match(service, new RegExp(`['"]${rpc}['"]`));
  }
  for (const source of [hook, detailsHook, editor, customerSelector, productSelector, trackingSelector, itemRow, createPage, detailsPage]) {
    assert.doesNotMatch(source, /requireSupabase|supabase\.from\(|client\.rpc\(/);
  }
});

test('create and edit draft workspace enforces existing permissions without performing confirmation', () => {
  assert.match(createPage, /can\('sales\.create'\)/);
  assert.match(createPage, /SALES_ROUTES\.details\(saleId\)/);
  assert.match(detailsPage, /can\('sales\.update_draft'\)/);
  assert.match(detailsPage, /useSaleDetails/);
  assert.match(detailsHook, /salesService\.getSaleDetails/);
  assert.match(editor, /canBackdate/);
  assert.match(hook, /submitLockRef/);
  assert.match(hook, /expectedVersion: draft\.version/);
  for (const source of [hook, editor, createPage]) {
    assert.doesNotMatch(source, /confirm_sale|reserve_inventory|post_financial_sale|SettlementDialog|collect.*payment/i);
  }
});

test('editor is mobile-first and exposes all operational states', () => {
  assert.match(editor, /sticky bottom-3/);
  assert.match(editor, /grid gap-4[\s\S]*md:grid-cols-2/);
  assert.match(editor, /status === 'loading'/);
  assert.match(editor, /status === 'error'/);
  assert.match(editor, /لا يوجد فرع نشط/);
  assert.match(customerSelector, /جاري البحث عن العملاء/);
  assert.match(productSelector, /جاري البحث عن المنتجات/);
  assert.match(trackingSelector, /لا توجد قطعة متاحة/);
  assert.match(itemRow, /لا يتم الحجز أثناء المسودة/);
});
