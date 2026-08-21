import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Paperwork writes use atomic RPC commands without direct business-table writes', () => {
  const workflow = read('src/features/paperwork/services/internal/paperworkWorkflow.service.js');
  const documents = read('src/features/paperwork/services/internal/paperworkDocuments.service.js');
  const showroom = read('src/features/showroom/services/showroom.service.js');
  const sources = `${workflow}\n${documents}\n${showroom}`;
  assert.match(workflow, /receive_paperwork_request_from_processor_with_owner/);
  assert.match(showroom, /confirm_sale_paperwork_request_with_processor/);
  assert.doesNotMatch(sources, /\.from\(['"]paperwork_(?:requests|request_events|documents|document_moves)['"]\)[\s\S]{0,180}?\.(?:insert|update|delete|upsert)\(/);
});

test('dead Paperwork mutation exports stay removed', () => {
  const sources = read('src/features/paperwork/services/internal/paperworkWorkflow.service.js')
    + read('src/features/paperwork/services/internal/paperworkDocuments.service.js');
  for (const method of ['createPaperworkRequest', 'createVaultPaperworkRequest', 'createLegacyDeliveredPaperworkRequest', 'saveSaleLineTrackingIdentifiers', 'attachSaleLineTrackingUnit', 'updateTrackingUnitPaperworkProcessor', 'saveTrackingUnitLicense', 'createPaperworkDocument', 'deletePaperworkDocumentRollback', 'linkExistingPaperworkDocumentAttachment']) {
    assert.doesNotMatch(sources, new RegExp(`\\b${method}\\b`));
  }
});

test('Showroom Paperwork entry points are gated by paperwork.access', () => {
  const page = read('src/features/showroom/pages/ShowroomSellPage.jsx');
  const details = read('src/features/showroom/components/ShowroomSaleViewSheet.jsx');
  assert.match(page, /can\(PAPERWORK_PERMISSIONS\.ACCESS\)/);
  assert.match(page, /can\(PAPERWORK_PERMISSIONS\.SEND\)/);
  assert.match(page, /canAccessPaperwork && paperworkPromptSale/);
  assert.match(page, /onPaperworkRequestOpen=\{canAccessPaperwork/);
  assert.match(details, /: onPaperworkRequestOpen \? \(/);
});
