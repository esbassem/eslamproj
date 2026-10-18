export function normalizeReceivingSerial(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function parseReceivingSerials(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map(normalizeReceivingSerial)
    .filter(Boolean);
}

export function findDuplicateReceivingSerials(serials = []) {
  const seen = new Set();
  const duplicates = new Set();
  for (const serial of serials.map(normalizeReceivingSerial).filter(Boolean)) {
    if (seen.has(serial)) duplicates.add(serial);
    seen.add(serial);
  }
  return [...duplicates];
}

export function getPrimaryTrackingIdentifier(definitions = []) {
  return [...definitions].sort((left, right) => {
    const sequenceDifference = (left.sequence ?? 0) - (right.sequence ?? 0);
    if (sequenceDifference !== 0) return sequenceDifference;
    return String(left.identifierTypeId ?? '').localeCompare(String(right.identifierTypeId ?? ''));
  })[0] ?? null;
}

export function filterAuthorizedReceivingLocations(
  locations = [],
  { canAccessBranch, canAccessStockLocation } = {},
) {
  return locations.filter((location) => (
    canAccessBranch?.(location.branchId) && canAccessStockLocation?.(location.id)
  ));
}

export function resolveReceivingDefaultLocation(
  locations = [],
  { defaultBranchId = '', defaultStockLocationId = '' } = {},
) {
  if (locations.length === 1) return locations[0].id;
  return locations.find((location) => (
    location.id === defaultStockLocationId
    && (!defaultBranchId || location.branchId === defaultBranchId)
  ))?.id ?? '';
}

export function canShowReceivingAction({ authorizationReady, canReceive } = {}) {
  return Boolean(authorizationReady && canReceive);
}

function fileIdentity(file) {
  if (!file) return null;
  return [file.name ?? '', file.type ?? '', file.size ?? 0, file.lastModified ?? 0];
}

export function createReceivingInputSignature(input = {}) {
  const documentFiles = Object.fromEntries((input.serialNumbers ?? []).map((serial) => [
    serial,
    Object.fromEntries(Object.entries(input.unitDocumentFiles?.[serial] ?? {}).map(([type, file]) => [type, fileIdentity(file)])),
  ]));
  return JSON.stringify({
    productId: input.productId,
    quantity: input.quantity,
    destination: input.destination,
    serialNumbers: input.serialNumbers,
    trackingIdentifierValues: input.trackingIdentifierValues,
    trackingIdentifierNotAvailable: input.trackingIdentifierNotAvailable,
    primaryTrackingIdentifierId: input.primaryTrackingIdentifier?.identifierTypeId ?? null,
    unitAttributeSelections: input.unitAttributeSelections,
    documentFiles,
  });
}

export async function prepareReceivingAttempt({
  tenantId,
  productId,
  quantity,
  destination,
  serialNumbers,
  isSerial,
  trackingIdentifierDefinitions = [],
  primaryTrackingIdentifier = null,
  trackingIdentifierValues = {},
  trackingIdentifierNotAvailable = {},
  attributes = [],
  unitAttributeSelections = {},
  documentDefinitions = [],
  unitDocumentFiles = {},
  submissionKey,
  createId = () => crypto.randomUUID(),
  uploadAttachment,
} = {}) {
  let uploadFailureCount = 0;
  const units = isSerial ? await Promise.all(serialNumbers.map(async (serial) => {
    const trackingUnitId = createId();
    const uploadResults = await Promise.allSettled(documentDefinitions.map(async (definition) => {
      const file = unitDocumentFiles[serial]?.[definition.documentType];
      if (!file) return null;
      return uploadAttachment({
        tenantId,
        trackingUnitId,
        documentType: definition.documentType,
        file,
      });
    }));
    uploadFailureCount += uploadResults.filter((result) => result.status === 'rejected').length;
    const unitAttributes = attributes.map((attribute) => {
      const value = String(unitAttributeSelections[serial]?.[attribute.id] ?? '').trim();
      if (!value) return null;
      const usesCatalog = attribute.inputMode ? attribute.inputMode === 'catalog' : (attribute.values ?? []).length > 0;
      return usesCatalog
        ? { attribute_id: attribute.id, attribute_value_id: value }
        : { attribute_id: attribute.id, value_text: value };
    }).filter(Boolean);
    return {
      tracking_unit_id: trackingUnitId,
      tracking_number: serial,
      identifiers: trackingIdentifierDefinitions.map((definition) => ({
        identifier_type_id: definition.identifierTypeId,
        value: definition.identifierTypeId === primaryTrackingIdentifier?.identifierTypeId
          ? serial
          : trackingIdentifierValues[serial]?.[definition.identifierTypeId] ?? '',
        is_not_available: definition.identifierTypeId === primaryTrackingIdentifier?.identifierTypeId
          ? false
          : Boolean(trackingIdentifierNotAvailable[serial]?.[definition.identifierTypeId]),
      })),
      attributes: unitAttributes,
      attachments: uploadResults
        .filter((result) => result.status === 'fulfilled' && result.value)
        .map((result) => result.value),
    };
  })) : undefined;
  const line = {
    product_id: productId,
    quantity: isSerial ? units.length : Number(quantity),
    ...(isSerial ? { units } : {}),
  };
  return {
    uploadFailureCount,
    request: {
      branchId: destination.branchId,
      destinationLocationId: destination.id,
      sourceType: 'manual_inventory_receipt',
      sourceId: submissionKey,
      lines: [line],
      idempotencyKey: `inventory-receive:${submissionKey}`,
    },
  };
}

export async function getOrCreateReceivingAttempt({ currentAttempt, inputSignature, prepare }) {
  if (currentAttempt?.inputSignature === inputSignature) return currentAttempt;
  return { inputSignature, ...await prepare() };
}
