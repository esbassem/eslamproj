import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canShowReceivingAction,
  createReceivingInputSignature,
  filterAuthorizedReceivingLocations,
  findDuplicateReceivingSerials,
  getPrimaryTrackingIdentifier,
  getOrCreateReceivingAttempt,
  parseReceivingSerials,
  prepareReceivingAttempt,
  resolveReceivingDefaultLocation,
} from './receivingUi.model.js';

const api = readFileSync(new URL('./api/inventory.api.js', import.meta.url), 'utf8');
const addStock = readFileSync(new URL('./components/AddStockDialog.jsx', import.meta.url), 'utf8');
const bulkGrid = readFileSync(new URL('./components/BulkReceivingGrid.jsx', import.meta.url), 'utf8');
const receivingModel = readFileSync(new URL('./receivingUi.model.js', import.meta.url), 'utf8');
const stockList = readFileSync(new URL('./pages/StockListPage.jsx', import.meta.url), 'utf8');
const quickStock = readFileSync(new URL('../dashboard/components/QuickStockUnitSheet.jsx', import.meta.url), 'utf8');
const primaryIdentityMigration = readFileSync(
  new URL('../../../supabase/migrations/20261014120000_inventory_category_primary_tracking_identity.sql', import.meta.url),
  'utf8',
);
const canonicalReceivingMigration = readFileSync(
  new URL('../../../supabase/migrations/20261004120000_canonical_inventory_receiving.sql', import.meta.url),
  'utf8',
);

test('both inventory entry surfaces use canonical Receiving and select a destination', () => {
  for (const source of [addStock, quickStock]) {
    assert.match(source, /inventoryService\.receiveInventory\(/);
    assert.match(source, /destinationLocationId/);
    assert.doesNotMatch(source, /inventoryService\.addStock\(/);
  }
});

test('the legacy stock creation boundary is closed and Jawab cannot create productless stock', () => {
  assert.match(api, /مسار إضافة المخزون القديم مغلق/);
  assert.doesNotMatch(quickStock, /setRegisterWithoutProduct\(true\)/);
  assert.match(quickStock, /يجب تحديد المنتج قبل الاستلام/);
});

test('documentation uploads are linked through the atomic Receiving request', () => {
  assert.match(addStock, /listCategoryInventoryDocuments/);
  assert.match(addStock, /prepareReceivingAttempt/);
  assert.match(receivingModel, /Promise\.allSettled/);
  assert.match(receivingModel, /identifiers:[\s\S]*attributes:[\s\S]*attachments:/);
  assert.match(addStock, /documentation\?\.status === 'INCOMPLETE'/);
  assert.match(bulkGrid, /لن تمنع الاستلام/);
  assert.doesNotMatch(addStock, /صورة رقم الشاسيه|صورة رقم الموتور/);
});

test('serialized attributes preserve catalog values and free text per unit', () => {
  assert.match(receivingModel, /unitAttributeSelections\[serial\]/);
  assert.match(receivingModel, /attribute_value_id: value/);
  assert.match(receivingModel, /value_text: value/);
  assert.match(receivingModel, /serialNumbers\.map\(async \(serial\)/);
  assert.doesNotMatch(addStock, /generateVariants|resolveVariant/);
});

test('receiving uses canonical permission and resource scope context', () => {
  assert.match(stockList, /can\('inventory\.receive'\)/);
  assert.match(stockList, /canReceive \?/);
  assert.match(addStock, /filterAuthorizedReceivingLocations/);
  assert.match(addStock, /resolveReceivingDefaultLocation/);
  assert.match(receivingModel, /canAccessBranch\?\.\(location\.branchId\)/);
  assert.match(receivingModel, /canAccessStockLocation\?\.\(location\.id\)/);
  assert.match(receivingModel, /location\.id === defaultStockLocationId/);
  assert.match(receivingModel, /location\.branchId === defaultBranchId/);
  assert.doesNotMatch(addStock, /locations\[0\]\?\.id/);
});

test('serial normalization matches the backend and detects case-insensitive duplicates', () => {
  const serials = parseReceivingSerials(' ch-001 \nCH-001\n Ch-002 ');
  assert.deepEqual(serials, ['CH-001', 'CH-001', 'CH-002']);
  assert.deepEqual(findDuplicateReceivingSerials(serials), ['CH-001']);
});

test('the category sequence selects one deterministic primary identity without name hardcoding', () => {
  const definitions = [
    { identifierTypeId: 'bbbb', name: 'Second by UUID', sequence: 1 },
    { identifierTypeId: 'aaaa', name: 'First by UUID', sequence: 1 },
    { identifierTypeId: 'cccc', name: 'Earlier input', sequence: 2 },
  ];
  assert.equal(getPrimaryTrackingIdentifier(definitions)?.identifierTypeId, 'aaaa');
  assert.equal(getPrimaryTrackingIdentifier([]), null);
  assert.doesNotMatch(receivingModel, /CHASSIS|IMEI|ENGINE/i);
});

test('changing category order affects newly prepared units without rewriting earlier payloads', async () => {
  const firstDefinition = { identifierTypeId: 'identity-a', sequence: 1 };
  const secondDefinition = { identifierTypeId: 'identity-b', sequence: 2 };
  assert.equal(getPrimaryTrackingIdentifier([firstDefinition, secondDefinition]), firstDefinition);
  const earlierPayload = { tracking_number: 'A-001', identifiers: [{ identifier_type_id: 'identity-a', value: 'A-001' }] };
  firstDefinition.sequence = 3;
  assert.equal(getPrimaryTrackingIdentifier([firstDefinition, secondDefinition]), secondDefinition);
  assert.deepEqual(earlierPayload, {
    tracking_number: 'A-001', identifiers: [{ identifier_type_id: 'identity-a', value: 'A-001' }],
  });
  assert.doesNotMatch(primaryIdentityMigration, /update\s+public\.stock_tracking_units|update\s+public\.stock_tracking_unit_identifiers/i);
});

test('the primary category identity becomes tracking_number once for every serialized unit', async () => {
  const primary = { identifierTypeId: 'primary', sequence: 1 };
  const secondary = { identifierTypeId: 'secondary', sequence: 2 };
  const attempt = await prepareReceivingAttempt({
    tenantId: 'tenant-1', productId: 'product-1', destination: { id: 'location-1', branchId: 'branch-1' },
    serialNumbers: ['PRIMARY-1', 'PRIMARY-2'], isSerial: true,
    trackingIdentifierDefinitions: [secondary, primary], primaryTrackingIdentifier: primary,
    trackingIdentifierValues: {
      'PRIMARY-1': { secondary: 'SECONDARY-1' },
      'PRIMARY-2': { secondary: 'SECONDARY-2' },
    },
    trackingIdentifierNotAvailable: {
      'PRIMARY-1': { primary: true },
      'PRIMARY-2': { primary: true },
    },
    submissionKey: 'primary-command',
    createId: (() => { let index = 0; return () => `unit-${++index}`; })(),
    uploadAttachment: async () => null,
  });
  const [first, second] = attempt.request.lines[0].units;
  assert.equal(first.tracking_number, 'PRIMARY-1');
  assert.deepEqual(first.identifiers, [
    { identifier_type_id: 'secondary', value: 'SECONDARY-1', is_not_available: false },
    { identifier_type_id: 'primary', value: 'PRIMARY-1', is_not_available: false },
  ]);
  assert.equal(second.tracking_number, 'PRIMARY-2');
  assert.equal(second.identifiers.find((item) => item.identifier_type_id === 'primary').value, 'PRIMARY-2');
});

test('a serial category without identifiers keeps the generic tracking number contract', async () => {
  const attempt = await prepareReceivingAttempt({
    tenantId: 'tenant-1', productId: 'product-1', destination: { id: 'location-1', branchId: 'branch-1' },
    serialNumbers: ['GENERIC-1'], isSerial: true, trackingIdentifierDefinitions: [],
    primaryTrackingIdentifier: null, submissionKey: 'generic-command', uploadAttachment: async () => null,
    createId: () => 'unit-1',
  });
  assert.equal(attempt.request.lines[0].units[0].tracking_number, 'GENERIC-1');
  assert.deepEqual(attempt.request.lines[0].units[0].identifiers, []);
  assert.match(bulkGrid, /رقم تتبع الوحدة/);
});

test('the backend independently enforces the configured primary identity', () => {
  assert.match(primaryIdentityMigration, /order by link\.sequence,link\.identifier_type_id/);
  assert.match(primaryIdentityMigration, /identifier_type\.is_active/);
  assert.match(primaryIdentityMigration, /INVENTORY_PRIMARY_TRACKING_IDENTITY_REQUIRED/);
  assert.match(primaryIdentityMigration, /INVENTORY_PRIMARY_TRACKING_IDENTITY_MISMATCH/);
  assert.match(primaryIdentityMigration, /p\.tenant_id=v_tenant_id/);
  assert.match(primaryIdentityMigration, /receive_inventory_without_primary_identity_guard/);
  assert.ok(
    primaryIdentityMigration.indexOf("request.command_type='receive'")
      < primaryIdentityMigration.indexOf('order by link.sequence,link.identifier_type_id'),
    'idempotent replay must be resolved before current category order is interpreted',
  );
  assert.doesNotMatch(primaryIdentityMigration, /update public\.stock_tracking_units|update public\.stock_tracking_unit_identifiers/);
});

test('receiving validates inherited attributes with the same nearest-category precedence as the frontend', () => {
  assert.match(primaryIdentityMigration, /with recursive category_hierarchy/);
  assert.match(primaryIdentityMigration, /row_number\(\) over\(partition by link\.attribute_id order by hierarchy\.depth/);
  assert.match(primaryIdentityMigration, /inventory_effective_category_attributes\(v_tenant_id,v_product\.category_id\) ca/);
  assert.match(primaryIdentityMigration, /inventory_effective_category_attributes\(v_tenant_id,v_product\.category_id\) req/);
  assert.match(primaryIdentityMigration, /ATTRIBUTE_ALLOWLIST_PATCH_FAILED/);
  assert.match(primaryIdentityMigration, /REQUIRED_ATTRIBUTE_PATCH_FAILED/);
  assert.match(canonicalReceivingMigration, /public\.product_category_attributes ca where ca\.tenant_id=v_tenant_id and ca\.category_id=v_product\.category_id and ca\.attribute_id=/);
  assert.match(canonicalReceivingMigration, /public\.product_category_attributes req where req\.tenant_id=v_tenant_id and req\.category_id=v_product\.category_id and req\.is_required/);
  assert.doesNotMatch(primaryIdentityMigration, /update\s+public\.stock_tracking_unit_attributes/i);
});

test('serialized receiving preserves different catalog and free-text attributes per unit', async () => {
  const attempt = await prepareReceivingAttempt({
    tenantId: 'tenant-1',
    productId: 'product-1',
    destination: { id: 'location-1', branchId: 'branch-1' },
    serialNumbers: ['SERIAL-1', 'SERIAL-2'],
    isSerial: true,
    attributes: [
      { id: 'color', inputMode: 'catalog', values: [{ id: 'red' }, { id: 'blue' }] },
      { id: 'note', inputMode: 'text', values: [] },
    ],
    unitAttributeSelections: {
      'SERIAL-1': { color: 'red', note: 'وحدة أولى' },
      'SERIAL-2': { color: 'blue', note: 'وحدة ثانية' },
    },
    submissionKey: 'command-1',
    createId: (() => { let index = 0; return () => `unit-${++index}`; })(),
    uploadAttachment: async () => null,
  });
  const [first, second] = attempt.request.lines[0].units;
  assert.deepEqual(first.attributes, [
    { attribute_id: 'color', attribute_value_id: 'red' },
    { attribute_id: 'note', value_text: 'وحدة أولى' },
  ]);
  assert.deepEqual(second.attributes, [
    { attribute_id: 'color', attribute_value_id: 'blue' },
    { attribute_id: 'note', value_text: 'وحدة ثانية' },
  ]);
});

test('photos remain associated with their serialized unit and one failed upload does not block receiving', async () => {
  const uploads = [];
  const attempt = await prepareReceivingAttempt({
    tenantId: 'tenant-1',
    productId: 'product-1',
    destination: { id: 'location-1', branchId: 'branch-1' },
    serialNumbers: ['SERIAL-1', 'SERIAL-2'],
    isSerial: true,
    documentDefinitions: [{ documentType: 'chassis_photo' }],
    unitDocumentFiles: {
      'SERIAL-1': { chassis_photo: { name: 'one.jpg' } },
      'SERIAL-2': { chassis_photo: { name: 'two.jpg' } },
    },
    submissionKey: 'command-1',
    createId: (() => { let index = 0; return () => `unit-${++index}`; })(),
    uploadAttachment: async (payload) => {
      uploads.push(payload);
      if (payload.file.name === 'two.jpg') throw new Error('upload failed');
      return { file_path: `${payload.trackingUnitId}/${payload.file.name}` };
    },
  });
  assert.deepEqual(uploads.map(({ trackingUnitId, file }) => [trackingUnitId, file.name]), [
    ['unit-1', 'one.jpg'],
    ['unit-2', 'two.jpg'],
  ]);
  assert.deepEqual(attempt.request.lines[0].units[0].attachments, [{ file_path: 'unit-1/one.jpg' }]);
  assert.deepEqual(attempt.request.lines[0].units[1].attachments, []);
  assert.equal(attempt.uploadFailureCount, 1);
});

test('an uncertain result retries the exact request without regenerating ids or uploading again', async () => {
  const input = {
    productId: 'product-1',
    quantity: 2,
    destination: { id: 'location-1', branchId: 'branch-1' },
    serialNumbers: ['SERIAL-1', 'SERIAL-2'],
    unitDocumentFiles: { 'SERIAL-1': { photo: { name: 'one.jpg', size: 10, lastModified: 5 } } },
  };
  const signature = createReceivingInputSignature(input);
  let preparations = 0;
  const first = await getOrCreateReceivingAttempt({
    currentAttempt: null,
    inputSignature: signature,
    prepare: async () => {
      preparations += 1;
      return { uploadFailureCount: 0, request: { idempotencyKey: 'inventory-receive:fixed', lines: [{ units: [{ tracking_unit_id: 'unit-fixed' }] }] } };
    },
  });
  const retry = await getOrCreateReceivingAttempt({
    currentAttempt: first,
    inputSignature: createReceivingInputSignature(input),
    prepare: async () => { preparations += 1; throw new Error('must not prepare again'); },
  });
  assert.equal(preparations, 1);
  assert.strictEqual(retry, first);
  assert.strictEqual(retry.request, first.request);
});

test('quantity receiving remains a single canonical line without unit attributes', async () => {
  const attempt = await prepareReceivingAttempt({
    tenantId: 'tenant-1', productId: 'quantity-product', quantity: '12.5', isSerial: false,
    destination: { id: 'location-1', branchId: 'branch-1' }, submissionKey: 'quantity-command',
  });
  assert.deepEqual(attempt.request.lines, [{ product_id: 'quantity-product', quantity: 12.5 }]);
  assert.doesNotMatch(addStock, /!isSerial && variantContext\?\.attributes/);
});

test('bulk UI requires confirmation before discarding entered rows and before final receive', () => {
  assert.match(addStock, /تغيير المنتج سيمسح الوحدات غير المحفوظة/);
  assert.match(addStock, /ReceivingReviewSheet/);
  assert.match(addStock, /if \(!confirmed\)/);
  assert.match(bulkGrid, /pasteBulkReceivingGrid/);
  assert.match(bulkGrid, /window\.confirm/);
});

test('bulk receiving uses the shared right-side drawer and unit cards instead of a wide table', () => {
  assert.match(addStock, /SheetContent side="right"/);
  assert.doesNotMatch(addStock, /handleSerialUnitCountChange/);
  assert.match(bulkGrid, /إضافة وحدة/);
  assert.match(bulkGrid, /الوحدة \{rowIndex \+ 1\}/);
  assert.match(bulkGrid, /أرقام التتبع/);
  assert.match(bulkGrid, /خصائص الوحدة/);
  assert.match(bulkGrid, /الصور والتوثيق/);
  assert.match(bulkGrid, /لصق جماعي/);
  assert.doesNotMatch(bulkGrid, /<table/);
});

test('permission and location helpers enforce readiness, scope, and valid defaults', () => {
  const locations = [
    { id: 'allowed', branchId: 'branch-1' },
    { id: 'wrong-branch', branchId: 'branch-2' },
    { id: 'wrong-location', branchId: 'branch-1' },
  ];
  const authorized = filterAuthorizedReceivingLocations(locations, {
    canAccessBranch: (id) => id === 'branch-1',
    canAccessStockLocation: (id) => id === 'allowed',
  });
  assert.deepEqual(authorized, [locations[0]]);
  assert.equal(resolveReceivingDefaultLocation(authorized, {
    defaultBranchId: 'branch-1', defaultStockLocationId: 'allowed',
  }), 'allowed');
  assert.equal(resolveReceivingDefaultLocation(authorized, {
    defaultBranchId: 'branch-2', defaultStockLocationId: 'allowed',
  }), 'allowed');
  assert.equal(resolveReceivingDefaultLocation([], {
    defaultBranchId: 'branch-1', defaultStockLocationId: 'allowed',
  }), '');
  assert.equal(resolveReceivingDefaultLocation([
    { id: 'first', branchId: 'branch-1' },
    { id: 'second', branchId: 'branch-1' },
  ], {}), '');
  assert.equal(resolveReceivingDefaultLocation([
    { id: 'first', branchId: 'branch-1' },
    { id: 'second', branchId: 'branch-1' },
  ], { defaultBranchId: 'branch-1', defaultStockLocationId: 'second' }), 'second');
  assert.equal(canShowReceivingAction({ authorizationReady: true, canReceive: true }), true);
  assert.equal(canShowReceivingAction({ authorizationReady: false, canReceive: true }), false);
  assert.equal(canShowReceivingAction({ authorizationReady: true, canReceive: false }), false);
});

test('receiving auto-selects only one available location and blocks an empty location list', () => {
  assert.match(addStock, /receivingLocations\.length === 0/);
  assert.match(addStock, /لا توجد مواقع مخزون متاحة للاستلام ضمن صلاحياتك/);
  assert.match(addStock, /current && authorizedLocations\.some\(\(location\) => location\.id === current\)/);
  assert.match(receivingModel, /if \(locations\.length === 1\) return locations\[0\]\.id/);
});

test('the existing transfer action remains connected', () => {
  assert.match(stockList, /TransferInventoryDialog/);
  assert.match(stockList, /setTransferItem/);
});
