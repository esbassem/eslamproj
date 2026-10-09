import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../products/pages/InventoryCountsPage.jsx', import.meta.url), 'utf8');
const api = readFileSync(new URL('./api/inventory.api.js', import.meta.url), 'utf8');

test('saved draft observations are restored before editing is enabled', () => {
  assert.match(page, /function hydrateDraft/);
  assert.match(page, /observations\.filter\(\(item\) => item\.type === 'serial'\)/);
  assert.match(page, /setQuantities\(restored\.quantities\)/);
  assert.match(page, /disabled=\{busy \|\| !draftLoaded/);
});

test('location selection uses only valid canonical operational defaults', () => {
  assert.match(page, /resourceScope\?\.defaultBranchId/);
  assert.match(page, /resourceScope\?\.defaultStockLocationId/);
  assert.match(page, /canAccessBranch\(item\.branchId\)/);
  assert.match(page, /canAccessStockLocation\(item\.id\)/);
  assert.match(page, /item\.id === defaultStockLocationId/);
  assert.match(page, /item\.branchId === defaultBranchId/);
  assert.doesNotMatch(page, /nextLocations\.length === 1/);
  assert.match(page, /اختر الفرع والموقع صراحةً/);
});

test('guided identity entry supports all canonical identifiers and blocks duplicates', () => {
  for (const property of ['chassisNumber', 'engineNumber', 'trackingNumber']) assert.match(page, new RegExp(`${property}: query`));
  assert.match(api, /stock_tracking_unit_identifiers/);
  assert.match(api, /ilike\('tracking_number'/);
  assert.match(page, /تم تسجيل هذه الوحدة بالفعل في نفس الجرد/);
  assert.match(page, /هوية غير معروفة/);
  assert.match(page, /أكثر من تطابق/);
  assert.match(page, /تسجيل مع تعارض/);
});

test('adjustment review is permission-aware and every variance needs an explicit decision and reason', () => {
  assert.match(page, /can\('inventory\.adjust'\)/);
  assert.match(page, /اختر القرار/);
  assert.match(page, /سبب القرار — مطلوب/);
  assert.match(page, /decisionsComplete/);
  assert.doesNotMatch(page, /variance_type === 'identity_review' \? 'ignore' : 'adjust'/);
});

test('unknown identity blocks posting and final posting requires confirmation', () => {
  assert.match(page, /unresolvedIdentities\.length/);
  assert.match(page, /لا يمكن الترحيل وفي الجرد هوية غير معروفة/);
  assert.match(page, /ConfirmationSummary/);
  assert.match(page, /تأكيد وترحيل التعديلات/);
  assert.match(page, /adjustment_id/);
  assert.match(page, /\/apps\/inventory\/stock/);
});
