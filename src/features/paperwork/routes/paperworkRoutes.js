export const PAPERWORK_ROUTES = Object.freeze({
  root: '/apps/paperwork',
  requests: '/apps/paperwork/requests',
  requestDetails: (requestId) => `/apps/paperwork/requests/${requestId}`,
  processors: '/apps/paperwork/processors',
  processorDetails: (processorId) => `/apps/paperwork/processors/${processorId}`,
  documents: '/apps/paperwork/documents',
  documentDetails: (documentId) => `/apps/paperwork/documents/${documentId}`,
  vault: '/apps/paperwork/vault',
});
