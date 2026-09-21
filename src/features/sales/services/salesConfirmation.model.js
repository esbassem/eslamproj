const text = (value) => typeof value === 'string' ? value.trim() : '';
const quantity = (value) => Math.round(Number(value) * 10000) / 10000;

function stockLocationId(sale) {
  return text(sale?.fulfillment?.location?.id) || text(sale?.draftInventoryLocationId);
}

export function buildSaleConfirmationPayload(sale = {}) {
  const source = sale ?? {};
  const locationId = stockLocationId(source);
  const inventorySelections = [];

  for (const line of source.lines ?? []) {
    if (line.inventory?.kind === 'service') continue;
    if (line.inventory?.kind === 'serial') {
      for (const unit of line.inventory.trackingUnits ?? []) {
        inventorySelections.push({
          sale_line_id: line.id,
          tracking_unit_id: unit.id,
          location_id: locationId,
          quantity: 1,
        });
      }
      continue;
    }
    inventorySelections.push({
      sale_line_id: line.id,
      tracking_unit_id: null,
      location_id: locationId,
      quantity: quantity(line.quantity),
    });
  }

  return {
    saleId: text(source.id),
    expectedVersion: Number(source.version),
    inventorySelections,
  };
}

export function getSaleConfirmationPayloadIssue(sale = {}) {
  const source = sale ?? {};
  if (source.commercialStatus !== 'draft') return 'البيع لم يعد مسودة قابلة للتأكيد.';
  if (!text(source.id) || !Number.isInteger(Number(source.version))) return 'بيانات إصدار البيع غير مكتملة. أعد تحميل الصفحة.';

  const stockLines = (source.lines ?? []).filter((line) => line.inventory?.kind !== 'service');
  if (stockLines.length && !stockLocationId(source)) return 'موقع المخزون غير محدد لهذه المسودة.';

  for (const line of stockLines) {
    if (!text(line.id)) return 'أحد بنود البيع غير مكتمل. أعد حفظ المسودة أولًا.';
    const lineQuantity = quantity(line.quantity);
    if (!(lineQuantity > 0)) return 'كمية أحد بنود البيع غير صحيحة.';
    if (line.inventory?.kind === 'serial') {
      const units = line.inventory.trackingUnits ?? [];
      if (!Number.isInteger(lineQuantity) || units.length !== lineQuantity || units.some((unit) => !text(unit.id))) {
        return 'اختيار القطع المتسلسلة غير مكتمل. راجع القطع المختارة في المسودة.';
      }
      if (new Set(units.map((unit) => unit.id)).size !== units.length) return 'لا يمكن اختيار نفس القطعة المتسلسلة أكثر من مرة.';
    }
  }
  return '';
}

export function saleConfirmationFingerprint(payload = {}) {
  const selections = [...(payload.inventorySelections ?? [])]
    .sort((left, right) => `${left.sale_line_id}:${left.tracking_unit_id ?? ''}`.localeCompare(`${right.sale_line_id}:${right.tracking_unit_id ?? ''}`));
  return JSON.stringify({
    saleId: payload.saleId,
    expectedVersion: payload.expectedVersion,
    inventorySelections: selections,
  });
}

export function createSaleConfirmationIdempotencyKey(saleId) {
  return `sales-confirm:${text(saleId)}:${crypto.randomUUID()}`;
}

export function resolveSaleConfirmationAttempt(currentAttempt, payload, createKey = createSaleConfirmationIdempotencyKey) {
  const fingerprint = saleConfirmationFingerprint(payload);
  if (currentAttempt?.fingerprint === fingerprint) return currentAttempt;
  return { fingerprint, idempotencyKey: createKey(payload.saleId) };
}
