const RETRYABLE_SQLSTATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available / lock_timeout
]);

export function classifyFinancialRetry(error) {
  const sqlstate = error?.code ?? error?.sqlstate ?? null;
  return Object.freeze({
    sqlstate,
    retryable: RETRYABLE_SQLSTATES.has(sqlstate),
    reason: RETRYABLE_SQLSTATES.has(sqlstate) ? 'transient_database_conflict' : 'not_automatically_retryable',
  });
}
