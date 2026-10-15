import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildBulkReceivingColumns,
  createBulkReceivingRow,
  fillBulkAttribute,
  pasteBulkReceivingGrid,
  summarizeBulkRows,
  validateBulkReceivingRows,
} from './bulkReceiving.model.js';

const identifiers = [
  { identifierTypeId: 'primary', name: 'هوية أولى', sequence: 1, isRequired: false },
  { identifierTypeId: 'secondary', name: 'هوية ثانية', sequence: 2, isRequired: true },
];
const attributes = [
  { id: 'condition', name: 'الحالة', inputMode: 'catalog', isRequired: true, values: [{ id: 'new', name: 'جديد' }, { id: 'used', name: 'مستعمل' }] },
  { id: 'color', name: 'اللون', inputMode: 'text', isRequired: false, values: [] },
];

function rows(count) {
  let id = 0;
  return Array.from({ length: count }, () => createBulkReceivingRow(() => `row-${++id}`));
}

test('dynamic columns follow category identity then attribute order', () => {
  assert.deepEqual(buildBulkReceivingColumns(identifiers, attributes).map((column) => column.key), [
    'identity:primary', 'identity:secondary', 'attribute:condition', 'attribute:color',
  ]);
});

test('one unit and fifty units validate independently', () => {
  const one = rows(1);
  one[0].identities = { primary: 'P-1', secondary: 'S-1' };
  one[0].attributes = { condition: 'new', color: 'أحمر' };
  assert.equal(validateBulkReceivingRows(one, identifiers, attributes, [])[0].complete, true);

  const fifty = rows(50).map((row, index) => ({
    ...row,
    identities: { primary: `P-${index}`, secondary: `S-${index}` },
    attributes: { condition: index % 2 ? 'used' : 'new', color: `لون ${index}` },
  }));
  const summary = summarizeBulkRows(validateBulkReceivingRows(fifty, identifiers, attributes, []));
  assert.deepEqual(summary, { total: 50, complete: 50, errors: 0, incompleteDocuments: 0 });
});

test('spreadsheet paste expands rows and resolves catalog names', () => {
  const columns = buildBulkReceivingColumns(identifiers, attributes);
  const result = pasteBulkReceivingGrid({
    rows: rows(1), columns, startRow: 0, startColumn: 0,
    text: 'P-1\tS-1\tجديد\tأحمر\nP-2\tS-2\tمستعمل\tأزرق',
    createId: (() => { let id = 1; return () => `row-${++id}`; })(),
  });
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0].attributes, { condition: 'new', color: 'أحمر' });
  assert.deepEqual(result.rows[1].attributes, { condition: 'used', color: 'أزرق' });
});

test('paste reports occupied cells and does not overwrite without confirmation', () => {
  const existing = rows(1);
  existing[0].identities.primary = 'KEEP';
  const columns = buildBulkReceivingColumns(identifiers, attributes);
  const guarded = pasteBulkReceivingGrid({ rows: existing, columns, startRow: 0, startColumn: 0, text: 'REPLACE' });
  assert.equal(guarded.rows[0].identities.primary, 'KEEP');
  assert.equal(guarded.conflicts.length, 1);
  const confirmed = pasteBulkReceivingGrid({ rows: existing, columns, startRow: 0, startColumn: 0, text: 'REPLACE', overwrite: true });
  assert.equal(confirmed.rows[0].identities.primary, 'REPLACE');
});

test('duplicates, required fields and invalid catalog values are row errors', () => {
  const input = rows(2).map((row) => ({ ...row, identities: { primary: 'DUP', secondary: 'SAME' }, attributes: { condition: 'unknown' } }));
  const validated = validateBulkReceivingRows(input, identifiers, attributes, []);
  assert.ok(validated.every((row) => row.errors.some((error) => error.includes('مكرر'))));
  assert.ok(validated.every((row) => row.errors.some((error) => error.includes('قيمة غير صالحة'))));
});

test('common values respect selection and existing data until overwrite is confirmed', () => {
  const input = rows(3);
  input[0].selected = true;
  input[1].selected = true;
  input[1].attributes.color = 'قديم';
  let result = fillBulkAttribute(input, 'color', 'جديد', true);
  assert.equal(result.rows[0].attributes.color, 'جديد');
  assert.equal(result.rows[1].attributes.color, 'قديم');
  assert.equal(result.rows[2].attributes.color, undefined);
  assert.deepEqual(result.conflicts, [1]);
  result = fillBulkAttribute(input, 'color', 'جديد', true, true);
  assert.equal(result.rows[1].attributes.color, 'جديد');
});

test('unit documents stay isolated and missing required photos are non-blocking', () => {
  const input = rows(2).map((row, index) => ({
    ...row, identities: { primary: `P-${index}`, secondary: `S-${index}` }, attributes: { condition: 'new' },
  }));
  input[0].documents.photo = { name: 'one.jpg' };
  const validated = validateBulkReceivingRows(input, identifiers, attributes, [{ documentType: 'photo', name: 'صورة', isRequired: true }]);
  assert.equal(validated[0].missingDocuments.length, 0);
  assert.equal(validated[1].missingDocuments.length, 1);
  assert.equal(validated[1].complete, true);
});

test('categories without identity definitions use the generic tracking value', () => {
  const input = rows(1);
  input[0].identities.__tracking_number = 'GENERIC-1';
  const validated = validateBulkReceivingRows(input, [], [], []);
  assert.equal(validated[0].trackingNumber, 'GENERIC-1');
  assert.equal(validated[0].complete, true);
});
