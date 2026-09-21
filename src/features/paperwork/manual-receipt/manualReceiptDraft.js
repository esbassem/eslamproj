const DRAFT_VERSION = 1;
const DRAFT_PREFIX = 'paperwork:manual-receipt-draft:';

function getStorage(storage) {
  if (storage) return storage;
  return typeof sessionStorage === 'undefined' ? null : sessionStorage;
}

function key({ tenantId, userId }) {
  return `${DRAFT_PREFIX}${tenantId || 'tenant'}:${userId || 'user'}`;
}

function trackingUnitSnapshot(unit) {
  if (!unit?.id) return null;
  return {
    id: unit.id,
    trackingNumber: unit.trackingNumber || unit.tracking_number || '',
    productName: unit.productName || unit.displayName || unit.product?.name || '',
    displayName: unit.displayName || unit.productName || unit.product?.name || '',
    dataStatus: unit.dataStatus || unit.data_status || '',
  };
}

export function readManualReceiptDraft(identity, storage) {
  try {
    const raw = getStorage(storage)?.getItem(key(identity));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.version === DRAFT_VERSION ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeManualReceiptDraft(identity, draft, storage) {
  const target = getStorage(storage);
  if (!target) return;
  target.setItem(key(identity), JSON.stringify({
    version: DRAFT_VERSION,
    savedAt: Date.now(),
    data: {
      step: Number(draft.step) || 0,
      chassis: draft.chassis || '',
      engine: draft.engine || '',
      unit: trackingUnitSnapshot(draft.unit),
      title: draft.title || 'جواب',
      ownerName: draft.ownerName || '',
      notes: draft.notes || '',
      requestId: draft.requestId || '',
      linkChoice: draft.linkChoice || 'auto',
      unlinkReason: draft.unlinkReason || '',
      attachment: draft.photo ? {
        name: draft.photo.name || '',
        type: draft.photo.type || '',
        size: Number(draft.photo.size) || 0,
        needsReselection: true,
      } : draft.attachment || null,
    },
  }));
}

export function clearManualReceiptDraft(identity, storage) {
  getStorage(storage)?.removeItem(key(identity));
}

export function hasManualReceiptDraft(identity, storage) {
  return Boolean(readManualReceiptDraft(identity, storage));
}
