export function formatNumber(value) {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatCurrency(value, currencyLabel) {
  return `${formatNumber(value)} ${currencyLabel}`.trim();
}

export function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-GB').format(date);
}
