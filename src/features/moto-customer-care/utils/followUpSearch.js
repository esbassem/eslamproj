function normalizeSearchText(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ar')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

function includesQuery(values, query) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;

  return normalizeSearchText(values.flat(Infinity).filter(Boolean).join(' ')).includes(normalizedQuery);
}

function trackingIdentifierValues(identifiers) {
  return (Array.isArray(identifiers) ? identifiers : []).flatMap((identifier) => [
    identifier?.value,
    identifier?.label,
    identifier?.code,
  ]);
}

export function saleMatchesFollowUpSearch(sale, query) {
  const items = Array.isArray(sale?.items) ? sale.items : [];

  return includesQuery([
    sale?.id,
    sale?.saleNumber,
    sale?.number,
    sale?.customer?.name,
    sale?.customer?.phone,
    sale?.customer?.phone1,
    sale?.customer?.phone2,
    sale?.customer?.address,
    sale?.notes,
    items.flatMap((item) => [
      item?.productName,
      item?.attributesText,
      item?.trackingUnitId,
      trackingIdentifierValues(item?.trackingIdentifiers),
    ]),
  ], query);
}

export function paperworkRequestMatchesFollowUpSearch(request, query) {
  return includesQuery([
    request?.id,
    request?.saleNumber,
    request?.customerName,
    request?.customer?.name,
    request?.customer?.phone,
    request?.customer?.phone1,
    request?.customer?.phone2,
    request?.documentOwnerName,
    request?.documentOwner?.name,
    request?.processorName,
    request?.processor?.name,
    request?.productName,
    request?.requestType,
    request?.currentStage,
    request?.stage?.name,
    trackingIdentifierValues(request?.trackingIdentifiers),
  ], query);
}
