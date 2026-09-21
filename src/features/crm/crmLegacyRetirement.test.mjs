import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const router = read('../../app/router/AppRouter.jsx');
const registry = read('../../app/router/appRouteRegistry.js');
const lazyRoutes = read('../../app/router/lazyRoutes.jsx');
const navigation = read('../../core/navigation/platformNavigation.js');
const migration = read('../../../supabase/migrations/20260910120000_retire_legacy_crm_showroom_integration.sql');

test('legacy CRM has no production route, loader, registry, or platform navigation', () => {
  for (const source of [router, registry, lazyRoutes, navigation]) {
    assert.doesNotMatch(source, /features\/crm|\/apps\/crm|appCode=["']crm["']|appCode:\s*["']crm["']/);
  }
});

test('retirement preserves CRM rows and removes only empty Showroom integrations', () => {
  assert.match(migration, /CRM_SHOWROOM_LINKED_DATA_REQUIRES_REVIEW/);
  assert.match(migration, /drop constraint if exists crm_leads_sale_fk/);
  assert.match(migration, /drop constraint if exists showroom_sales_crm_lead_fk/);
  assert.match(migration, /drop function if exists public\.crm_mark_lead_sold/);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.crm_|drop\s+table\s+public\.crm_/i);
});
