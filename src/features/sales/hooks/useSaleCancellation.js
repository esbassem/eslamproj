import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { salesService } from '@/features/sales/services/sales.service';
import {
  getSaleCancellationReasonMessage,
  isAuthoritativeSaleCancellationError,
  resolveSaleCancellationAttempt,
} from '@/features/sales/services/salesCancellation.model';

export const SALE_CANCELLATION_VERSION_CONFLICT_MESSAGE = 'تم تحديث البيع من مستخدم آخر. تم تحديث البيانات، راجع الحالة ثم حاول مرة أخرى.';

export function useSaleCancellationEligibility({ tenantId, saleId, enabled = true } = {}) {
  const [state, setState] = useState({ status: 'idle', eligibility: null, error: null });
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    if (!enabled || !tenantId || !saleId) return null;
    const request = ++requestRef.current;
    setState((current) => ({ ...current, status: current.eligibility ? 'refreshing' : 'loading', error: null }));
    try {
      const eligibility = await salesService.getSaleCancellationEligibility({ tenantId, saleId });
      if (requestRef.current !== request) return null;
      setState({ status: 'ready', eligibility, error: null });
      return eligibility;
    } catch (error) {
      if (requestRef.current !== request) return null;
      setState({ status: 'error', eligibility: null, error });
      return null;
    }
  }, [enabled, saleId, tenantId]);

  useEffect(() => {
    if (!enabled) {
      requestRef.current += 1;
      setState({ status: 'idle', eligibility: null, error: null });
      return;
    }
    void reload();
    return () => { requestRef.current += 1; };
  }, [enabled, reload]);

  return { ...state, reload };
}

export function useSaleCancellation({ open, tenantId, sale, initialEligibility, onCancelled, onVersionConflict, onTargetRefresh } = {}) {
  const [eligibility, setEligibility] = useState(initialEligibility ?? null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const attemptRef = useRef(null);

  const loadEligibility = useCallback(async ({ keepError = false } = {}) => {
    if (!tenantId || !sale?.id) return null;
    setStatus('loading');
    if (!keepError) setError(null);
    try {
      const next = await salesService.getSaleCancellationEligibility({ tenantId, saleId: sale.id });
      setEligibility(next);
      setStatus('ready');
      return next;
    } catch (caught) {
      setStatus('error');
      if (!keepError) setError(caught);
      return null;
    }
  }, [sale?.id, tenantId]);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setResult(null);
    setError(null);
    attemptRef.current = null;
    void loadEligibility();
  }, [loadEligibility, open]);

  const cleanReason = reason.trim();
  const payload = useMemo(() => ({
    saleId: sale?.id,
    expectedVersion: sale?.version,
    reason: cleanReason,
  }), [cleanReason, sale?.id, sale?.version]);
  const reasonIssue = !cleanReason
    ? 'سبب الإلغاء مطلوب.'
    : cleanReason.length > 1000 ? 'سبب الإلغاء يجب ألا يتجاوز 1000 حرف.' : '';

  const submit = useCallback(async (event) => {
    event?.preventDefault?.();
    if (submitLockRef.current || submitting) return null;
    if (reasonIssue) {
      setError(Object.assign(new Error(reasonIssue), { code: 'CLIENT_VALIDATION' }));
      return null;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const currentEligibility = await salesService.getSaleCancellationEligibility({ tenantId, saleId: sale.id });
      setEligibility(currentEligibility);
      if (!currentEligibility.canCancel) {
        const blocked = Object.assign(
          new Error(currentEligibility.reasonMessage || getSaleCancellationReasonMessage(currentEligibility.reasonIfBlocked)),
          { code: currentEligibility.reasonIfBlocked || 'SALE_CANCELLATION_NOT_ELIGIBLE' },
        );
        setError(blocked);
        await onTargetRefresh?.({ eligibility: currentEligibility, message: blocked.message });
        return null;
      }

      attemptRef.current = resolveSaleCancellationAttempt(attemptRef.current, payload);
      const commandResult = await salesService.cancelSale({
        tenantId,
        saleId: sale.id,
        expectedVersion: payload.expectedVersion,
        reason: payload.reason,
        idempotencyKey: attemptRef.current.idempotencyKey,
      });
      setResult(commandResult);
      attemptRef.current = null;
      await onCancelled?.(commandResult);
      return commandResult;
    } catch (caught) {
      const normalized = caught instanceof Error ? caught : new Error('تعذر إلغاء البيع. حاول مرة أخرى.');
      if (normalized.code === 'SALES_VERSION_CONFLICT') {
        normalized.message = SALE_CANCELLATION_VERSION_CONFLICT_MESSAGE;
        attemptRef.current = null;
        setError(normalized);
        await loadEligibility({ keepError: true });
        await onVersionConflict?.(normalized.message);
        return null;
      }
      setError(normalized);
      if (isAuthoritativeSaleCancellationError(normalized.code)) {
        const refreshed = await loadEligibility({ keepError: true });
        await onTargetRefresh?.({ eligibility: refreshed, message: normalized.message });
      }
      return null;
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }, [loadEligibility, onCancelled, onTargetRefresh, onVersionConflict, payload, reasonIssue, sale?.id, submitting, tenantId]);

  return {
    eligibility,
    reason,
    setReason: (value) => { setReason(value); setError(null); },
    status,
    error,
    result,
    submitting,
    reasonIssue,
    canSubmit: status === 'ready' && eligibility?.canCancel === true && !reasonIssue,
    submit,
    retryEligibility: loadEligibility,
  };
}
