export const NO_ALLOWED_DESTINATION_MESSAGE = 'لا يوجد مورد مالي مسموح لك باستخدامه لهذه العملية.';

export function normalizeMoneyDestinationSelection(payload) {
  const destinations = Array.isArray(payload?.destinations) ? payload.destinations : [];
  const allowedCount = Number(payload?.allowed_count ?? destinations.length);
  const selectionState = allowedCount === 0 ? 'none' : allowedCount === 1 ? 'single' : 'multiple';
  const autoSelectedDestinationId = selectionState === 'single'
    ? payload?.auto_selected_destination_id || destinations[0]?.destination_id || null
    : null;

  return {
    destinations,
    allowedCount,
    selectionState,
    autoSelectedDestinationId,
    reason: selectionState === 'none'
      ? payload?.reason || 'NO_ALLOWED_MONEY_DESTINATION'
      : null,
    message: selectionState === 'none' ? NO_ALLOWED_DESTINATION_MESSAGE : null,
  };
}
