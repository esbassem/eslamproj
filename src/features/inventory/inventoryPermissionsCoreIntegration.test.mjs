import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL('../../../supabase/migrations/20261010120000_inventory_permissions_core_integration.sql', import.meta.url), 'utf8');
const accessService = readFileSync(new URL('../settings/sections/access-control/services/accessControl.service.js', import.meta.url), 'utf8');

test('adjust permission is restored without an automatic group grant', () => {
  assert.match(migration, /'inventory\.adjust'/);
  assert.match(migration, /module_code[\s\S]*'products'/);
  assert.match(migration, /permission_type[\s\S]*'action'/);
  assert.doesNotMatch(migration, /insert into public\.auth_group_permissions/i);
});

test('all stable inventory action codes are presented beneath the visible products app', () => {
  assert.match(migration, /where code like 'inventory\.%'/);
  assert.match(migration, /set module_code = 'products'/);
  assert.doesNotMatch(migration, /update public\.ir_modules|products\.access[^\s]/);
});

test('count submission revalidates tenant, permission, ownership and resource scope', () => {
  assert.match(migration, /inventory_runtime_access_allowed\(t\)/);
  assert.match(migration, /has_permission\('inventory\.count_submit', t\)/);
  assert.match(migration, /x\.tenant_id = t/);
  assert.match(migration, /if not found/);
  assert.match(migration, /has_branch_access\(c\.branch_id\)/);
  assert.match(migration, /has_stock_location_access\(c\.location_id\)/);
  assert.match(migration, /c\.state <> 'draft'/);
});

test('central management already edits role permissions, scopes and defaults', () => {
  assert.match(accessService, /set_tenant_group_permissions/);
  assert.match(accessService, /user_branch_access/);
  assert.match(accessService, /user_stock_location_access/);
  assert.match(accessService, /user_operational_defaults/);
});
