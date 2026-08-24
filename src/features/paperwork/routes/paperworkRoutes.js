export const PAPERWORK_ROUTES = Object.freeze({
  root: '/apps/paperwork',
  requests: '/apps/paperwork/requests',
  legacyRequests: '/apps/paperwork/requests',
  requestDetails: (requestId) => `/apps/paperwork/requests/${requestId}`,
  processors: '/apps/paperwork/processors',
  processorDetails: (processorId) => `/apps/paperwork/processors/${processorId}`,
  documents: '/apps/paperwork/documents',
  documentDetails: (documentId) => `/apps/paperwork/documents/${documentId}`,
  vault: '/apps/paperwork/vault',
});

export function withPaperworkSearch(path, values = {}) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '' && value !== false) {
      params.set(key, String(value));
    }
  });
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export const PAPERWORK_TASK_ROUTES = Object.freeze({
  manualReceipt: () => withPaperworkSearch(PAPERWORK_ROUTES.root, { flow: 'manual-receipt' }),
  inventoryForManualReceipt: () => {
    const params = new URLSearchParams({
      paperworkFlow: 'manual-receipt',
      returnTo: withPaperworkSearch(PAPERWORK_ROUTES.root, { flow: 'manual-receipt' }),
    });
    return `/apps/inventory/unique-units?${params.toString()}`;
  },
});
