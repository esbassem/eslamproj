export function createBulkReceivingRow(createId = () => crypto.randomUUID()) {
  return { id: createId(), identities: {}, identityNotAvailable: {}, attributes: {}, documents: {}, selected: false };
}

export function buildBulkReceivingColumns(identifierDefinitions = [], attributes = []) {
  return [
    ...identifierDefinitions.map((definition, index) => ({
      key: `identity:${definition.identifierTypeId}`,
      kind: 'identity',
      id: definition.identifierTypeId,
      label: definition.name,
      required: index === 0 || Boolean(definition.isRequired),
      definition,
    })),
    ...attributes.map((attribute) => ({
      key: `attribute:${attribute.id}`,
      kind: 'attribute',
      id: attribute.id,
      label: attribute.name,
      required: Boolean(attribute.isRequired),
      definition: attribute,
    })),
  ];
}

export function readBulkCell(row, column) {
  return column.kind === 'identity' ? row.identities[column.id] ?? '' : row.attributes[column.id] ?? '';
}

export function writeBulkCell(row, column, value) {
  const bucket = column.kind === 'identity' ? 'identities' : 'attributes';
  return { ...row, [bucket]: { ...row[bucket], [column.id]: value } };
}

export function normalizePastedCell(column, rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value || column.kind !== 'attribute' || column.definition.inputMode === 'text') return value;
  const normalized = value.toLocaleLowerCase();
  const match = (column.definition.values ?? []).find((item) => (
    item.id === value || String(item.name ?? '').trim().toLocaleLowerCase() === normalized
  ));
  return match?.id ?? value;
}

export function pasteBulkReceivingGrid({ rows, columns, startRow, startColumn, text, overwrite = false, createId } = {}) {
  const matrix = String(text ?? '').replace(/\r/g, '').split('\n').filter((line, index, all) => line || index < all.length - 1)
    .map((line) => line.split('\t'));
  const next = [...rows];
  const conflicts = [];
  while (next.length < startRow + matrix.length) next.push(createBulkReceivingRow(createId));
  matrix.forEach((cells, rowOffset) => cells.forEach((rawValue, columnOffset) => {
    const column = columns[startColumn + columnOffset];
    if (!column) return;
    const rowIndex = startRow + rowOffset;
    const current = readBulkCell(next[rowIndex], column);
    if (current && !overwrite) {
      conflicts.push({ rowIndex, columnKey: column.key });
      return;
    }
    next[rowIndex] = writeBulkCell(next[rowIndex], column, normalizePastedCell(column, rawValue));
  }));
  return { rows: next, conflicts };
}

export function fillBulkAttribute(rows, attributeId, value, selectedOnly = false, overwrite = false) {
  const conflicts = [];
  const next = rows.map((row, rowIndex) => {
    if (selectedOnly && !row.selected) return row;
    if (row.attributes[attributeId] && !overwrite) {
      conflicts.push(rowIndex);
      return row;
    }
    return { ...row, attributes: { ...row.attributes, [attributeId]: value } };
  });
  return { rows: next, conflicts };
}

function normalized(value) {
  return String(value ?? '').trim().toUpperCase();
}

function matchesIdentifierSlot(character, type) {
  if (type === 'numeric') return /^\d$/.test(character);
  if (type === 'english_letter') return /^[A-Z]$/i.test(character);
  if (type === 'arabic_letter') return /^[\u0621-\u064A]$/.test(character);
  return true;
}

export function validateBulkReceivingRows(rows, identifierDefinitions = [], attributes = [], documentDefinitions = []) {
  const primary = identifierDefinitions[0] ?? null;
  const trackingCounts = new Map();
  const identityCounts = new Map();
  rows.forEach((row) => {
    const tracking = normalized(primary ? row.identities[primary.identifierTypeId] : row.identities.__tracking_number);
    if (tracking) trackingCounts.set(tracking, (trackingCounts.get(tracking) ?? 0) + 1);
    identifierDefinitions.forEach((definition) => {
      const value = normalized(row.identities[definition.identifierTypeId]);
      if (!value) return;
      const key = `${definition.identifierTypeId}:${value}`;
      identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
    });
  });

  return rows.map((row) => {
    const errors = [];
    const tracking = normalized(primary ? row.identities[primary.identifierTypeId] : row.identities.__tracking_number);
    if (!tracking) errors.push(primary ? `${primary.name} مطلوب` : 'رقم تتبع الوحدة مطلوب');
    if (tracking && trackingCounts.get(tracking) > 1) errors.push('رقم التتبع مكرر داخل الدفعة');
    identifierDefinitions.forEach((definition, index) => {
      const value = normalized(row.identities[definition.identifierTypeId]);
      const unavailable = Boolean(row.identityNotAvailable?.[definition.identifierTypeId]);
      if ((index === 0 || definition.isRequired) && !value && !(index > 0 && definition.allowNotAvailable && unavailable)) errors.push(`${definition.name} مطلوب`);
      if (value && identityCounts.get(`${definition.identifierTypeId}:${value}`) > 1) errors.push(`${definition.name} مكرر داخل الدفعة`);
      const values = Array.from(value);
      const slots = definition.inputSchema?.slots ?? definition.slots ?? [];
      if (value && slots.length && values.length !== slots.length) errors.push(`${definition.name}: عدد الخانات غير صحيح`);
      else if (value && slots.length && values.some((character, slotIndex) => !matchesIdentifierSlot(character, slots[slotIndex]?.type))) errors.push(`${definition.name}: صيغة الخانات غير صحيحة`);
    });
    attributes.forEach((attribute) => {
      const value = String(row.attributes[attribute.id] ?? '').trim();
      if (attribute.isRequired && !value) errors.push(`${attribute.name} مطلوب`);
      if (value && attribute.inputMode !== 'text' && !(attribute.values ?? []).some((item) => item.id === value)) {
        errors.push(`${attribute.name}: قيمة غير صالحة`);
      }
    });
    const missingDocuments = documentDefinitions.filter((document) => document.isRequired && !row.documents[document.documentType]);
    return { ...row, trackingNumber: tracking, errors, missingDocuments, complete: errors.length === 0 };
  });
}

export function summarizeBulkRows(validatedRows = []) {
  return {
    total: validatedRows.length,
    complete: validatedRows.filter((row) => row.complete).length,
    errors: validatedRows.filter((row) => row.errors.length).length,
    incompleteDocuments: validatedRows.filter((row) => row.missingDocuments.length).length,
  };
}
