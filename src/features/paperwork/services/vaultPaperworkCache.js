const vaultCache = new Map();
const inFlightRequests = new Map();
const cacheGenerations = new Map();
const VAULT_CACHE_FRESHNESS_MS = 30_000;

function buildKey({ tenantId, userId, search = '', filter = 'in_custody', pageSize = 30 }) {
  return [tenantId, userId || 'anonymous', filter, String(search).trim().toLowerCase(), pageSize].join(':');
}

export function getVaultPaperworkCacheSnapshot(options) {
  return vaultCache.get(buildKey(options)) || null;
}

export function isVaultPaperworkCacheFresh(snapshot) {
  return Boolean(snapshot?.fetchedAt && Date.now() - snapshot.fetchedAt < VAULT_CACHE_FRESHNESS_MS);
}

export function loadVaultPaperworkFirstPage({ fetchPage, force = false, ...options }) {
  const key = buildKey(options);
  const cached = vaultCache.get(key);
  if (cached && !force) return Promise.resolve(cached);
  if (inFlightRequests.has(key)) return inFlightRequests.get(key);
  const generation = cacheGenerations.get(key) || 0;

  const request = fetchPage({ pageSize: options.pageSize || 30, cursor: null })
    .then((page) => {
      if ((cacheGenerations.get(key) || 0) !== generation) return { ...page, invalidated: true };
      const snapshot = { ...page, fetchedAt: Date.now() };
      vaultCache.set(key, snapshot);
      return snapshot;
    })
    .finally(() => {
      if (inFlightRequests.get(key) === request) inFlightRequests.delete(key);
      cacheGenerations.delete(key);
    });

  inFlightRequests.set(key, request);
  return request;
}

export function invalidateVaultPaperworkCache({ tenantId, userId } = {}) {
  const keys = new Set([...vaultCache.keys(), ...inFlightRequests.keys()]);
  for (const key of keys) {
    const [cachedTenantId, cachedUserId] = key.split(':');
    if ((!tenantId || cachedTenantId === tenantId) && (!userId || cachedUserId === userId)) {
      vaultCache.delete(key);
      cacheGenerations.set(key, (cacheGenerations.get(key) || 0) + 1);
    }
  }
}

export function updateVaultPaperworkCache({ tenantId, userId, update }) {
  if (typeof update !== 'function') return;
  for (const [key, snapshot] of vaultCache.entries()) {
    const [cachedTenantId, cachedUserId] = key.split(':');
    if (cachedTenantId !== tenantId || (userId && cachedUserId !== userId)) continue;
    vaultCache.set(key, { ...snapshot, documents: update(snapshot.documents || []) });
  }
}
