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
  const sources = `${workflow}\n${documents}`;
  assert.match(workflow, /receive_paperwork_request_from_processor_with_owner/);
  assert.doesNotMatch(sources, /\.from\(['"]paperwork_(?:requests|request_events|documents|document_moves)['"]\)[\s\S]{0,180}?\.(?:insert|update|delete|upsert)\(/);
});

test('dead Paperwork mutation exports stay removed', () => {
  const sources = read('src/features/paperwork/services/internal/paperworkWorkflow.service.js')
    + read('src/features/paperwork/services/internal/paperworkDocuments.service.js');
  for (const method of ['createPaperworkRequest', 'createVaultPaperworkRequest', 'createLegacyDeliveredPaperworkRequest', 'saveSaleLineTrackingIdentifiers', 'attachSaleLineTrackingUnit', 'updateTrackingUnitPaperworkProcessor', 'saveTrackingUnitLicense', 'createPaperworkDocument', 'deletePaperworkDocumentRollback', 'linkExistingPaperworkDocumentAttachment']) {
    assert.doesNotMatch(sources, new RegExp(`\\b${method}\\b`));
  }
});

test('Paperwork no longer has a Showroom frontend entry point', () => {
  const router = read('src/app/router/AppRouter.jsx');
  const registry = read('src/app/router/appRouteRegistry.js');
  assert.doesNotMatch(`${router}\n${registry}`, /features\/showroom|\/app\/showroom_point/);
});
