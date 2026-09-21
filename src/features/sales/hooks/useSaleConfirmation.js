import { useCallback, useMemo, useRef, useState } from 'react';
import { salesService } from '@/features/sales/services/sales.service';
import {
  buildSaleConfirmationPayload,
  getSaleConfirmationPayloadIssue,
  resolveSaleConfirmationAttempt,
  saleConfirmationFingerprint,
} from '@/features/sales/services/salesConfirmation.model';

const VERSION_CONFLICT_MESSAGE = 'تم تعديل البيع من مستخدم آخر. تم تحديث البيانات، راجعها ثم أعد التأكيد.';

export function useSaleConfirmation({ tenantId, sale, readiness, refreshReadiness, onConfirmed, onVersionConflict }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const submitLockRef = useRef(false);
  const attemptRef = useRef(null);
  const payload = useMemo(() => buildSaleConfirmationPayload(sale), [sale]);
  const payloadIssue = useMemo(() => getSaleConfirmationPayloadIssue(sale), [sale]);
  const fingerprint = useMemo(() => saleConfirmationFingerprint(payload), [payload]);

  const clearError = useCallback(() => setError(null), []);

  const submit = useCallback(async () => {
    if (submitLockRef.current) return null;
    const isRetry = attemptRef.current?.fingerprint === fingerprint;
    if (payloadIssue) {
      setError(Object.assign(new Error(payloadIssue), { code: 'CLIENT_VALIDATION' }));
      return null;
    }
    if (!isRetry && !readiness?.ready) {
      setError(Object.assign(new Error('المسودة غير جاهزة للتأكيد. راجع أسباب المنع أولًا.'), { code: 'STALE_READINESS' }));
      return null;
    }

    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      if (!isRetry) {
        const latestReadiness = await refreshReadiness();
        if (!latestReadiness?.ready) {
          setError(Object.assign(new Error('تغيرت جاهزية المسودة. راجع أسباب المنع قبل التأكيد.'), { code: 'STALE_READINESS' }));
          return null;
        }
        attemptRef.current = resolveSaleConfirmationAttempt(attemptRef.current, payload);
      }
      const result = await salesService.confirmSale({
        tenantId,
        saleId: payload.saleId,
        expectedVersion: payload.expectedVersion,
        inventorySelections: payload.inventorySelections,
        idempotencyKey: attemptRef.current.idempotencyKey,
      });
      attemptRef.current = null;
      await onConfirmed?.(result);
      return result;
    } catch (caught) {
      if (caught?.code === 'SALES_VERSION_CONFLICT' || caught?.code === 'SALE_NOT_DRAFT') {
        attemptRef.current = null;
        await onVersionConflict?.(VERSION_CONFLICT_MESSAGE);
        return null;
      }
      setError(caught instanceof Error ? caught : new Error('تعذر تأكيد البيع. حاول مرة أخرى.'));
      return null;
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }, [fingerprint, onConfirmed, onVersionConflict, payload, payloadIssue, readiness?.ready, refreshReadiness, tenantId]);

  return {
    payload,
    payloadIssue,
    canSubmit: readiness?.ready === true && !payloadIssue,
    submitting,
    error,
    clearError,
    submit,
  };
}
