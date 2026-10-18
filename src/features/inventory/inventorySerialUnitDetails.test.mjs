import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../../../supabase/migrations/20261017160000_inventory_serial_unit_details.sql');
const page = read('./pages/SerialUnitDetailsPage.jsx');
const list = read('./pages/SerialUnitsPage.jsx');
const api = read('./api/inventory.api.js');
const registry = read('../../app/router/menuRegistry.js');
const resolver = read('../../app/router/menuRouteResolver.js');

test('detail RPC is tenant and location scoped and read-only', () => {
  assert.match(migration, /current_tenant_id\(\)/);
  assert.match(migration, /has_permission\('inventory\.read'/);
  assert.match(migration, /has_stock_location_access/);
  assert.match(migration, /has_branch_access/);
  assert.match(migration, /unit\.tenant_id = v_tenant_id/);
  assert.doesNotMatch(migration, /\b(insert|update|delete)\s+(into|public\.)/i);
});

test('detail RPC uses canonical state, attachments and real event history', () => {
  assert.match(migration, /inventory_tracking_unit_states/);
  assert.match(migration, /inventory_events/);
  assert.match(migration, /legacy_moves/);
  assert.match(migration, /not exists[\s\S]*inventory_events/);
  assert.match(migration, /event\.product_id = move\.product_product_id/);
  assert.match(migration, /event\.from_location_id is not distinct from move\.source_location_id/);
  assert.match(migration, /related_model = 'stock_tracking_units'/);
  assert.match(migration, /offset \(v_page - 1\) \* v_page_size limit v_page_size/);
});

test('serial list opens the standalone detail route and no longer renders a details drawer', () => {
  assert.match(list, /unique-units\/\$\{unit\.id\}/);
  assert.match(list, /returnTo=/);
  assert.doesNotMatch(list, /TrackingUnitDetails|<Sheet/);
  assert.match(registry, /unique-units\/:unitId/);
  assert.match(resolver, /pattern\.includes\('\/:/);
});

test('detail page loads only one unit and distinguishes access and missing states', () => {
  assert.match(api, /rpc\('get_inventory_serial_unit_details'/);
  assert.match(api, /createSignedUrl\(attachment\.file_path, 900\)/);
  assert.match(page, /trackingUnitId: unitId/);
  assert.match(page, /غير مصرح بعرض الوحدة/);
  assert.match(page, /الوحدة غير موجودة/);
  assert.match(page, /timelineTotal/);
});
