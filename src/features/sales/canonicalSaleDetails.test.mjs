import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeSaleDetails, normalizeSaleReadiness } from './services/salesDetails.model.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../supabase/migrations/20260907140000_canonical_sale_details_read_model.sql');
const customerContactMigration = read('../../../supabase/migrations/20260919120000_sale_details_customer_contact.sql');
const page = read('./components/SaleDetails.jsx');
const service = read('./services/sales.service.js');
const header = read('./components/SaleHeader.jsx');
const actions = read('./components/SaleActions.jsx');
const payment = read('./components/SalePaymentSummary.jsx');
const fulfillment = read('./components/SaleFulfillmentSummary.jsx');
const items = read('./components/SaleItemsDetails.jsx');
const timeline = read('./components/SaleTimeline.jsx');
const readinessSource = read('./components/SaleReadiness.jsx');

function fixture(overrides = {}) {
  return {
    id: 'sale-1', sale_number: null, status: 'draft', commercial_status: 'draft',
    effective_sale_date: '2026-09-07', currency_code: 'EGP', total_amount: 50000, version: 2,
    branch: { id: 'branch-1', name: 'Main' }, customer: { id: 'customer-1', name: 'Customer', phone: '01000000000', address: 'Cairo' },
    created_by: { name: 'Seller' }, created_at: '2026-09-07T10:00:00Z',
    payment: { status: 'not_confirmed', total_amount: 50000, settled_amount: 0, outstanding_amount: 50000, currency_code: 'EGP' },
    fulfillment: { status: 'unreserved', required_quantity: 1, selected_quantity: 1, reserved_quantity: 0, delivered_quantity: 0, remaining_quantity: 1 },
    lines: [{ id: 'line-1', product: { id: 'product-1', name: 'Moto', sku: 'M-1', tracking: 'serial', product_type: 'goods', sale_price: 50000 }, quantity: 1, unit_price: 50000, line_total: 50000, inventory: { kind: 'serial', status: 'selected', selected_quantity: 1, reserved_quantity: 0, delivered_quantity: 0, remaining_quantity: 1, tracking_units: [{ id: 'unit-1', tracking_number: 'CH-1', chassis_number: 'CH-1', engine_number: 'EN-1', state: 'selected', attributes: [{ name: 'اللون', value: 'أسود' }] }] } }],
    events: [{ type: 'sale_created', version: 1, occurred_at: '2026-09-07T10:00:00Z', actor: { name: 'Seller' }, summary: {} }],
    ...overrides,
  };
}

test('1. Draft details keep commercial payment and fulfillment states independent', () => {
  const sale = normalizeSaleDetails(fixture());
  assert.equal(sale.commercialStatus, 'draft'); assert.equal(sale.payment.status, 'not_confirmed'); assert.equal(sale.fulfillment.status, 'unreserved');
});
test('2. Draft without a final number is labelled as a draft', () => { assert.match(header, /sale\.saleNumber \|\| 'مسودة'/); });
test('3. Edit action is permission-aware for sales.update_draft', () => { assert.match(page, /can\('sales\.update_draft'\)/); assert.match(actions, /canEditDraft/); });
test('4. Edit action is absent without permission', () => { assert.match(actions, /canEditDraft \?/); });
test('5. Confirmed details do not expose Draft editing', () => { assert.match(page, /editing \?/); assert.match(actions, /commercialStatus === 'draft'[\s\S]*تعديل المسودة/); });
test('6. Unpaid payment state is normalized', () => { assert.equal(normalizeSaleDetails(fixture({ status: 'confirmed', commercial_status: 'confirmed', payment: { status: 'unpaid', total_amount: 50000, settled_amount: 0, outstanding_amount: 50000 } })).payment.status, 'unpaid'); });
test('7. Partial payment amounts remain business-level', () => { const value = normalizeSaleDetails(fixture({ status: 'confirmed', payment: { status: 'partially_paid', total_amount: 50000, settled_amount: 20000, outstanding_amount: 30000 } })).payment; assert.deepEqual([value.status, value.settledAmount, value.outstandingAmount], ['partially_paid', 20000, 30000]); });
test('8. Paid state has no residual', () => { const value = normalizeSaleDetails(fixture({ status: 'confirmed', payment: { status: 'paid', total_amount: 50000, settled_amount: 50000, outstanding_amount: 0 } })).payment; assert.equal(value.status, 'paid'); assert.equal(value.outstandingAmount, 0); });
test('9. Reserved fulfillment is supported', () => { assert.equal(normalizeSaleDetails(fixture({ fulfillment: { status: 'reserved', required_quantity: 1, reserved_quantity: 1 } })).fulfillment.status, 'reserved'); });
test('10. Partial delivery is supported independently of commercial state', () => { const value = normalizeSaleDetails(fixture({ status: 'confirmed', fulfillment: { status: 'partially_delivered', required_quantity: 2, reserved_quantity: 1, delivered_quantity: 1, remaining_quantity: 1 } })); assert.equal(value.commercialStatus, 'confirmed'); assert.equal(value.fulfillment.status, 'partially_delivered'); });
test('11. Full delivery is supported', () => { assert.equal(normalizeSaleDetails(fixture({ fulfillment: { status: 'delivered', required_quantity: 1, delivered_quantity: 1 } })).fulfillment.status, 'delivered'); });
test('12. Serialized line exposes chassis engine attributes and state', () => { const unit = normalizeSaleDetails(fixture()).lines[0].inventory.trackingUnits[0]; assert.deepEqual([unit.chassisNumber, unit.engineNumber, unit.attributes[0].value, unit.state], ['CH-1', 'EN-1', 'أسود', 'selected']); assert.match(items, /شاسيه:/); });
test('13. Quantity line exposes ordered reserved and delivered quantities', () => { assert.match(items, /محجوز:/); assert.match(items, /مُسلّم:/); assert.match(items, /متبقٍ:/); });
test('14. Service line has no fake Inventory workflow', () => { assert.match(items, /خدمة — لا تتطلب مخزونًا/); });
test('15. Timeline consumes mapped sale events without raw payload rendering', () => { const sale = normalizeSaleDetails(fixture()); assert.equal(sale.events[0].type, 'sale_created'); assert.match(timeline, /sale_confirmed/); assert.doesNotMatch(timeline, /JSON\.stringify|payload/); });
test('16. Readiness reasons and warnings are business-friendly', () => { const value = normalizeSaleReadiness({ ready: false, blocking_reasons: ['SALE_LINES_REQUIRED'], warnings: ['INVENTORY_AVAILABILITY_CHECK_REQUIRED_AT_CONFIRMATION'] }); assert.equal(value.blockingReasons[0], 'SALE_LINES_REQUIRED'); assert.match(readinessSource, /أضف بند بيع واحدًا/); });
test('17. Not-found and unauthorized reads use the scoped backend and error state', () => { assert.match(migration, /v_base := public\.get_sale\(p_sale_id\)/); assert.match(page, /details\.status === 'error'/); assert.match(service, /SALE_NOT_FOUND/); assert.match(service, /SALES_VIEW_DENIED/); });
test('18. Details layout is mobile-safe without a forced wide table', () => { assert.match(page, /space-y-6/); assert.match(items, /sm:grid-cols-4/); assert.doesNotMatch(items, /<table|overflow-x-auto/); });
test('19. DTO output contains no accounting implementation identifiers', () => { assert.match(migration, /v_base - 'financial' - 'inventory'/); assert.doesNotMatch(page + header + payment + fulfillment + items + timeline, /account_id|journal_id|move_id|receivable_line_id|debit|credit/); assert.doesNotMatch(migration, /jsonb_build_object\(\s*'account_id'|jsonb_build_object\(\s*'journal_id'|jsonb_build_object\(\s*'move_id'|jsonb_build_object\(\s*'receivable_line_id'/); });
test('20. Details delegates Delivery and Settlement without direct RPC calls', () => { assert.match(actions, /CanonicalSaleDeliveryAction/); for (const source of [page, actions]) assert.doesNotMatch(source, /settle_obligation|deliver_sale|commit_inventory_delivery/i); });
test('21. Details omits the redundant fulfillment summary card', () => { assert.doesNotMatch(page, /SaleFulfillmentSummary|ملخص التنفيذ/); });
test('22. Compact details compose a dedicated paid card without changing the full-page composition', () => { assert.match(page, /compact \? \([\s\S]*<SalePaymentSummary sale=\{details\.sale\} compact \/>[\s\S]*\) : null/); });
test('23. Side-sheet density can flatten the sale header without changing its full-page card', () => { assert.match(page, /embedded=\{compact\}/); assert.match(header, /embedded \? 'py-3' : 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'/); });
test('24. Embedded details do not repeat the sale number or creator already shown in the surface header', () => { assert.match(header, /\{embedded \? \([\s\S]*sale\.customer\.name[\s\S]*\) : \([\s\S]*رقم البيع/); assert.match(header, /\) : \([\s\S]*أنشأه:/); });
test('25. Embedded details omit status badges while retaining the compact payment amounts', () => { const embeddedBranch = header.match(/\{embedded \? \(([\s\S]*?)\) : \(/)?.[1] || ''; assert.match(embeddedBranch, /حالة الدفع[\s\S]*المدفوع[\s\S]*المتبقي/); assert.doesNotMatch(embeddedBranch, /<SaleStatusBadge|الحالة التجارية|حالة التنفيذ/); });
test('26. Embedded details lead with a flat customer name phone and address summary', () => { const sale = normalizeSaleDetails(fixture()); assert.deepEqual([sale.customer.name, sale.customer.phone, sale.customer.address], ['Customer', '01000000000', 'Cairo']); assert.match(header, /<UserRound[\s\S]*sale\.customer\.name[\s\S]*sale\.customer\.phone[\s\S]*sale\.customer\.address/); });
test('27. Customer address extends the canonical scoped details read without another request after deployment', () => { assert.match(customerContactMigration, /v_details := public\.get_sale_details\(p_sale_id\)/); assert.match(customerContactMigration, /customer\.tenant_id = v_tenant_id/); assert.match(customerContactMigration, /'\{customer,address\}'/); assert.match(service, /p_include_customer_contact: true/); });
test('28. A missing contact-aware RPC overload falls back safely without masking business errors', () => { assert.match(service, /error\?\.code === 'PGRST202'/); assert.match(service, /isMissingSaleDetailsContactOverload\(response\.error\)[\s\S]*client\.rpc\('get_sale_details', \{ p_sale_id: saleId \}\)/); assert.match(service, /if \(response\.error\)[\s\S]*throw normalizeSalesError/); });
test('29. Embedded details omit the black total card while the full-page view retains it', () => { const embeddedBranch = header.match(/\{embedded \? \(([\s\S]*?)\) : \(/)?.[1] || ''; assert.doesNotMatch(embeddedBranch, /bg-slate-950|إجمالي البيع/); assert.match(header, /rounded-2xl bg-slate-950[\s\S]*إجمالي البيع/); });
test('30. Embedded customer identity follows a quiet, contained account layout', () => { assert.match(header, /h-14 w-14[\s\S]*rounded-full bg-slate-100 text-slate-500/); assert.match(header, /<UserRound className="h-7 w-7/); assert.match(header, /text-base[\s\S]*text-xs[\s\S]*text-slate-600/); assert.doesNotMatch(header, /customerInitials|bg-blue-600|text-blue-700/); });
test('31. Compact details restore invoice items beside the paid card', () => { assert.match(page, /grid items-stretch gap-4 md:grid-cols-2[\s\S]*<SaleItemsDetails[\s\S]*<SalePaymentSummary/); assert.match(items, /بنود الفاتورة[\s\S]*divide-y divide-slate-200/); assert.match(payment, /المدفوع[\s\S]*إجمالي ما تم دفعه/); });
test('32. Sale timeline is omitted from the details composition while event data remains normalized', () => { assert.doesNotMatch(page, /SaleTimeline/); assert.equal(normalizeSaleDetails(fixture()).events[0].type, 'sale_created'); });
test('33. Embedded branch and seller sit below the identity row while aligning with the customer name', () => { const embeddedBranch = header.match(/\{embedded \? \(([\s\S]*?)\) : \(/)?.[1] || ''; assert.match(embeddedBranch, /grid-cols-\[3\.5rem_minmax\(0,1fr\)\][\s\S]*sale\.customer\.address[\s\S]*<\/div>\s*<dl className="col-start-2 mt-3/); assert.match(embeddedBranch, /<dt[^>]*>الفرع<\/dt>\s*<dd[^>]*>[\s\S]*sale\.branch\.name[\s\S]*<dt[^>]*>البائع<\/dt>\s*<dd[^>]*>غير محدد<\/dd>/); assert.doesNotMatch(embeddedBranch, /<Building2|<CalendarDays|ps-3/); });
test('34. Embedded invoice summary uses a responsive 40/60 payment chart layout without divider lines', () => { const embeddedBranch = header.match(/\{embedded \? \(([\s\S]*?)\) : \(/)?.[1] || ''; assert.match(embeddedBranch, /md:grid-cols-\[minmax\(0,4fr\)_minmax\(0,6fr\)\]/); assert.match(embeddedBranch, /<circle[\s\S]*strokeDasharray[\s\S]*paidPercentage/); assert.match(embeddedBranch, /إجمالي الفاتورة[\s\S]*حالة الدفع[\s\S]*المدفوع[\s\S]*المتبقي/); assert.doesNotMatch(embeddedBranch, /border-slate-200\/80|md:border-s|md:border-t-0/); });
test('35. The circular remainder and its label are red only while a balance is outstanding', () => { assert.match(header, /hasOutstandingBalance = outstandingAmount > 0/); assert.match(header, /hasOutstandingBalance \? 'stroke-red-400' : 'stroke-slate-100'/); assert.match(header, /hasOutstandingBalance \? 'text-red-600' : 'text-slate-500'/); assert.match(header, /hasOutstandingBalance \? 'bg-red-500' : 'bg-slate-200'/); assert.match(header, /hasOutstandingBalance \? 'text-red-700' : 'text-slate-800'/); assert.doesNotMatch(header, /justify-between gap-3/); });
test('36. The paid portion of the circular chart is always green', () => { assert.match(header, /className="fill-none stroke-emerald-500 transition-\[stroke-dasharray\]/); assert.doesNotMatch(header, /paymentStrokeClass|stroke-amber-500/); });

test('read contract is one-sale, event-mapped, and never returns raw payload', () => {
  assert.match(migration, /create or replace function public\.get_sale_details\(p_sale_id uuid\)/);
  assert.match(migration, /from public\.sale_events event/);
  assert.match(migration, /'summary', case event\.event_type/);
  assert.doesNotMatch(migration, /'payload', event\.payload/);
  assert.match(service, /rpc\('get_sale_details'/);
});
