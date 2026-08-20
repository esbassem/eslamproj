export const EMPTY_RESOURCE_SCOPE = Object.freeze({
  tenantId: null,
  tenantUserId: null,
  allowedBranchIds: Object.freeze([]),
  allowedPosIds: Object.freeze([]),
  allowedStockLocationIds: Object.freeze([]),
  allowedAccountIds: Object.freeze([]),
  defaultBranchId: null,
  defaultPosId: null,
  defaultStockLocationId: null,
});

function uniqueIds(values) {
  return Array.from(new Set((values ?? []).filter(Boolean)));
}

export function normalizeResourceScope(record) {
  if (!record) return EMPTY_RESOURCE_SCOPE;

  return Object.freeze({
    tenantId: record.tenant_id ?? record.tenantId ?? null,
    tenantUserId: record.tenant_user_id ?? record.tenantUserId ?? null,
    allowedBranchIds: Object.freeze(uniqueIds(record.allowed_branch_ids ?? record.allowedBranchIds)),
    allowedPosIds: Object.freeze(uniqueIds(record.allowed_pos_ids ?? record.allowedPosIds)),
    allowedStockLocationIds: Object.freeze(uniqueIds(record.allowed_stock_location_ids ?? record.allowedStockLocationIds)),
    allowedAccountIds: Object.freeze(uniqueIds(record.allowed_account_ids ?? record.allowedAccountIds)),
    defaultBranchId: record.default_branch_id ?? record.defaultBranchId ?? null,
    defaultPosId: record.default_pos_id ?? record.defaultPosId ?? null,
    defaultStockLocationId: record.default_stock_location_id ?? record.defaultStockLocationId ?? null,
  });
}

export function createResourceScopeSnapshot(resourceScope = EMPTY_RESOURCE_SCOPE) {
  const normalizedScope = normalizeResourceScope(resourceScope);
  const branchIds = new Set(normalizedScope.allowedBranchIds);
  const posIds = new Set(normalizedScope.allowedPosIds);
  const stockLocationIds = new Set(normalizedScope.allowedStockLocationIds);
  const accountIds = new Set(normalizedScope.allowedAccountIds);

  return Object.freeze({
    resourceScope: normalizedScope,
    canAccessBranch: (branchId) => Boolean(branchId) && branchIds.has(branchId),
    canAccessPos: (posId) => Boolean(posId) && posIds.has(posId),
    canAccessStockLocation: (stockLocationId) => Boolean(stockLocationId) && stockLocationIds.has(stockLocationId),
    canAccessAccount: (accountId) => Boolean(accountId) && accountIds.has(accountId),
  });
}
