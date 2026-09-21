export const SALE_SIDE_SHEET_PARAM = 'sale';
export const SALE_SIDE_SHEET_HISTORY_KEY = 'salesSideSheetEntry';

export function setSaleSideSheetParam(search = '', saleId) {
  const params = new URLSearchParams(search);
  const normalizedSaleId = String(saleId ?? '').trim();
  if (normalizedSaleId) params.set(SALE_SIDE_SHEET_PARAM, normalizedSaleId);
  else params.delete(SALE_SIDE_SHEET_PARAM);
  const query = params.toString();
  return query ? `?${query}` : '';
}
export function getSaleSideSheetId(search = '') {
  return new URLSearchParams(search).get(SALE_SIDE_SHEET_PARAM)?.trim() || '';
}

export function createSaleSideSheetLocation(location, saleId) {
  return {
    pathname: location.pathname,
    search: setSaleSideSheetParam(location.search, saleId),
    hash: location.hash || '',
  };
}

export function createSaleSideSheetState(currentState) {
  const state = currentState && typeof currentState === 'object' ? currentState : {};
  return { ...state, [SALE_SIDE_SHEET_HISTORY_KEY]: true };
}

export function clearSaleSideSheetState(currentState) {
  if (!currentState || typeof currentState !== 'object') return null;
  const nextState = { ...currentState };
  delete nextState[SALE_SIDE_SHEET_HISTORY_KEY];
  return Object.keys(nextState).length ? nextState : null;
}
