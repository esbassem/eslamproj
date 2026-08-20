import assert from 'node:assert/strict';
import test from 'node:test';
import { createSingleEntryRequestCache } from '../authorization.cache.js';
import {
  beginAuthorizationLoad,
  completeAuthorizationLoad,
  INITIAL_AUTHORIZATION_STATE,
} from '../authorization.state.js';
import {
  EMPTY_RESOURCE_SCOPE,
  createResourceScopeSnapshot,
  normalizeResourceScope,
} from './scope.service.js';

test('scope predicates only allow ids returned for the active tenant', () => {
  const snapshot = createResourceScopeSnapshot({
    tenant_id: 'tenant-a',
    allowed_branch_ids: ['branch-a'],
    allowed_pos_ids: ['pos-a'],
    allowed_stock_location_ids: ['stock-a'],
    allowed_account_ids: ['account-a'],
  });

  assert.equal(snapshot.canAccessBranch('branch-a'), true);
  assert.equal(snapshot.canAccessBranch('branch-b'), false);
  assert.equal(snapshot.canAccessPos('pos-a'), true);
  assert.equal(snapshot.canAccessPos('pos-b'), false);
  assert.equal(snapshot.canAccessStockLocation('stock-a'), true);
  assert.equal(snapshot.canAccessStockLocation('stock-b'), false);
  assert.equal(snapshot.canAccessAccount('account-a'), true);
  assert.equal(snapshot.canAccessAccount('account-b'), false);
});

test('normalization deduplicates scope and retains defaults', () => {
  const scope = normalizeResourceScope({
    tenant_id: 'tenant-a',
    tenant_user_id: 'user-a',
    allowed_branch_ids: ['branch-a', 'branch-a'],
    default_branch_id: 'branch-a',
  });

  assert.deepEqual(scope.allowedBranchIds, ['branch-a']);
  assert.equal(scope.defaultBranchId, 'branch-a');
});

test('begin loading clears previous tenant scope before the next request', () => {
  const loading = beginAuthorizationLoad(true);
  assert.equal(loading.status, 'loading');
  assert.deepEqual(loading.permissionCodes, []);
  assert.equal(loading.resourceScope, EMPTY_RESOURCE_SCOPE);

  const idle = beginAuthorizationLoad(false);
  assert.equal(idle.status, INITIAL_AUTHORIZATION_STATE.status);
  assert.equal(idle.resourceScope, EMPTY_RESOURCE_SCOPE);
});

test('completed load exposes permissions and scope together', () => {
  const completed = completeAuthorizationLoad(['crm.access', 'crm.access'], { tenant_id: 'tenant-a' });
  assert.equal(completed.status, 'ready');
  assert.deepEqual(completed.permissionCodes, ['crm.access']);
  assert.equal(completed.resourceScope.tenant_id, 'tenant-a');
});

test('single-entry cache deduplicates same-user requests and isolates user keys', async () => {
  const cache = createSingleEntryRequestCache();
  let requests = 0;
  const loader = async () => ({ request: ++requests });

  const [first, duplicate] = await Promise.all([
    cache.load('tenant-a:user-a', loader),
    cache.load('tenant-a:user-a', loader),
  ]);
  assert.equal(requests, 1);
  assert.equal(first.request, duplicate.request);

  const otherUser = await cache.load('tenant-a:user-b', loader);
  assert.equal(requests, 2);
  assert.equal(otherUser.request, 2);

  await cache.load('tenant-a:user-b', loader, { force: true });
  assert.equal(requests, 3);
});
