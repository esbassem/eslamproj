function normalizePaperworkSearchText(value) {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('ar')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

function getTrackingIdentifierValues(identifiers) {
  return (Array.isArray(identifiers) ? identifiers : []).flatMap((identifier) => [
    identifier?.value,
    identifier?.label,
    identifier?.code,
  ]);
}

export function paperworkDocumentMatchesSearch(document, query) {
  const normalizedQuery = normalizePaperworkSearchText(query);
  if (!normalizedQuery) return true;

  const searchableValues = [
    document?.documentTitle,
    document?.displayTitle,
    document?.documentOwnerName,
    document?.ownerName,
    document?.owner?.name,
    document?.trackingUnit?.trackingNumber,
    getTrackingIdentifierValues(document?.trackingIdentifiers),
  ];

  return normalizePaperworkSearchText(searchableValues.flat(Infinity).filter(Boolean).join(' '))
    .includes(normalizedQuery);
}

export function filterPaperworkDocumentsBySearch(documents, query) {
  return (Array.isArray(documents) ? documents : []).filter((document) => (
    paperworkDocumentMatchesSearch(document, query)
  ));
}

export function paperworkRequestMatchesSearch(request, query) {
  const normalizedQuery = normalizePaperworkSearchText(query);
  if (!normalizedQuery) return true;

  const searchableValues = [
    request?.documentTitle,
    request?.displayTitle,
    request?.documentOwnerName,
    request?.documentOwner?.name,
    request?.ownerName,
    request?.owner?.name,
    request?.customerName,
    request?.customer?.name,
    request?.productName,
    request?.trackingUnit?.trackingNumber,
    getTrackingIdentifierValues(request?.trackingIdentifiers),
  ];

  return normalizePaperworkSearchText(searchableValues.flat(Infinity).filter(Boolean).join(' '))
    .includes(normalizedQuery);
}

export function filterPaperworkRequestsBySearch(requests, query) {
  return (Array.isArray(requests) ? requests : []).filter((request) => (
    paperworkRequestMatchesSearch(request, query)
  ));
}

export function buildPaperworkProductSearchResults({ sales = [], requests = [], documents = [], query = '' }) {
  const normalizedQuery = normalizePaperworkSearchText(query);
  if (!normalizedQuery) return [];

  return (Array.isArray(sales) ? sales : []).flatMap((sale) => (
    (Array.isArray(sale?.items) ? sale.items : []).flatMap((item) => {
      const request = (Array.isArray(requests) ? requests : []).find((candidate) => (
        (item?.id && candidate?.saleLineId === item.id)
        || (item?.trackingUnitId && candidate?.trackingUnitId === item.trackingUnitId)
      )) || null;
      const document = (Array.isArray(documents) ? documents : []).find((candidate) => (
        item?.trackingUnitId && candidate?.trackingUnitId === item.trackingUnitId
      )) || null;
      const searchableValues = [
        sale?.customer?.name,
        item?.displayName,
        item?.name,
        item?.description,
        item?.trackingUnit?.trackingNumber,
        getTrackingIdentifierValues(item?.trackingIdentifiers),
        request?.documentTitle,
        request?.documentOwnerName,
        request?.customerName,
        getTrackingIdentifierValues(request?.trackingIdentifiers),
        document?.documentTitle,
        document?.displayTitle,
        document?.documentOwnerName,
        document?.owner?.name,
        document?.trackingUnit?.trackingNumber,
        getTrackingIdentifierValues(document?.trackingIdentifiers),
      ];

      const matches = normalizePaperworkSearchText(searchableValues.flat(Infinity).filter(Boolean).join(' '))
        .includes(normalizedQuery);

      return matches ? [{ sale, item, request, document }] : [];
    })
  ));
}
