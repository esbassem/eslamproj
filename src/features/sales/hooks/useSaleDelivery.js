import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { salesService } from '@/features/sales/services/sales.service';
import {
  buildSaleDeliveryLines,
  createInitialSaleDeliverySelection,
  getSaleDeliveryReasonMessage,
  getSaleDeliverySelectionIssue,
  isAuthoritativeSaleDeliveryError,
  resolveSaleDeliveryAttempt,
  saleDeliveryFingerprint,
} from '@/features/sales/services/salesDelivery.model';

export const SALE_DELIVERY_VERSION_CONFLICT_MESSAGE = 'تم تحديث البيع أو تنفيذ عملية عليه من مستخدم آخر. تم تحديث البيانات، راجع حالة التسليم ثم حاول مرة أخرى.';

const EMPTY_SELECTION = Object.freeze({ quantities: {}, trackingUnits: {} });

export function useSaleDelivery({
  open,
  tenantId,
  saleId,
  onDelivered,
  onVersionConflict,
  onTargetRefresh,
} = {}) {
  const [status, setStatus] = useState('idle');
  const [eligibility, setEligibility] = useState(null);
  const [selection, setSelection] = useState(EMPTY_SELECTION);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const attemptRef = useRef(null);
  const requestVersionRef = useRef(0);
  const activeTargetRef = useRef('');
  const onDeliveredRef = useRef(onDelivered);
  const onVersionConflictRef = useRef(onVersionConflict);
  const onTargetRefreshRef = useRef(onTargetRefresh);

  useEffect(() => { onDeliveredRef.current = onDelivered; }, [onDelivered]);
  useEffect(() => { onVersionConflictRef.current = onVersionConflict; }, [onVersionConflict]);
  useEffect(() => { onTargetRefreshRef.current = onTargetRefresh; }, [onTargetRefresh]);

  const loadEligibility = useCallback(async ({ resetSelection = true, keepError = false } = {}) => {
    const requestVersion = ++requestVersionRef.current;
    setStatus((current) => eligibility ? 'refreshing' : current === 'ready' ? 'refreshing' : 'loading');
    if (!keepError) setError(null);
    setNotice('');
    try {
      const nextEligibility = await salesService.getSaleDeliveryEligibility({ tenantId, saleId });
      if (requestVersionRef.current !== requestVersion) return null;
      setEligibility(nextEligibility);
      if (resetSelection) setSelection(createInitialSaleDeliverySelection(nextEligibility));
      setStatus('ready');
      return nextEligibility;
    } catch (caught) {
      if (requestVersionRef.current !== requestVersion) return null;
      setStatus('error');
      setError(caught instanceof Error ? caught : new Error('تعذر تحميل جاهزية التسليم.'));
      return null;
    }
  }, [eligibility, saleId, tenantId]);

  useEffect(() => {
    if (!open) {
      requestVersionRef.current += 1;
      return;
    }
    const targetKey = `${tenantId || ''}:${saleId || ''}`;
    if (activeTargetRef.current !== targetKey) {
      activeTargetRef.current = targetKey;
      attemptRef.current = null;
      setEligibility(null);
      setSelection(EMPTY_SELECTION);
    }
    setResult(null);
    setError(null);
    setNotice('');
    void loadEligibility({ resetSelection: true });
  // Opening always rechecks Backend eligibility; current eligibility is intentionally excluded.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saleId, tenantId]);

  const deliveryLines = useMemo(
    () => buildSaleDeliveryLines(eligibility ?? {}, selection),
    [eligibility, selection],
  );
  const payload = useMemo(() => ({
    saleId,
    expectedVersion: eligibility?.version,
    deliveryLines,
  }), [deliveryLines, eligibility?.version, saleId]);
  const payloadIssue = useMemo(
    () => eligibility ? getSaleDeliverySelectionIssue(eligibility, selection) : 'جاري تحميل جاهزية التسليم.',
    [eligibility, selection],
  );
  const fingerprint = useMemo(() => saleDeliveryFingerprint(payload), [payload]);

  const setQuantity = useCallback((saleLineId, value) => {
    setSelection((current) => ({
      ...current,
      quantities: { ...current.quantities, [saleLineId]: value },
    }));
    setError(null);
    setNotice('');
  }, []);

  const setTrackingUnit = useCallback((saleLineId, trackingUnitId, checked) => {
    const key = `${saleLineId}:${trackingUnitId}`;
    setSelection((current) => ({
      ...current,
      trackingUnits: { ...current.trackingUnits, [key]: checked },
    }));
    setError(null);
    setNotice('');
  }, []);

  const submit = useCallback(async (event) => {
    event?.preventDefault?.();
    if (submitLockRef.current || submitting) return null;
    if (payloadIssue) {
      setError(Object.assign(new Error(payloadIssue), { code: 'CLIENT_VALIDATION' }));
      return null;
    }

    attemptRef.current = resolveSaleDeliveryAttempt(attemptRef.current, payload);
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    setNotice('');
    try {
      const commandResult = await salesService.deliverSale({
        tenantId,
        saleId,
        expectedVersion: payload.expectedVersion,
        deliveryLines: payload.deliveryLines,
        idempotencyKey: attemptRef.current.idempotencyKey,
      });
      let refreshedEligibility = null;
      try {
        refreshedEligibility = await salesService.getSaleDeliveryEligibility({ tenantId, saleId });
        setEligibility(refreshedEligibility);
        setSelection(createInitialSaleDeliverySelection(refreshedEligibility));
        setStatus('ready');
      } catch {
        setNotice('تم التسليم بنجاح، لكن تعذر تحديث جاهزية التسليم الآن. حدّث الصفحة لقراءة أحدث حالة.');
      }
      setResult(commandResult);
      attemptRef.current = null;
      try {
        await onDeliveredRef.current?.({ result: commandResult, eligibility: refreshedEligibility });
      } catch {
        setNotice('تم التسليم بنجاح، لكن تعذر تحديث صفحة البيع تلقائيًا.');
      }
      return commandResult;
    } catch (caught) {
      const normalizedError = caught instanceof Error ? caught : new Error('تعذر تنفيذ التسليم. حاول مرة أخرى.');
      if (normalizedError.code === 'SALES_VERSION_CONFLICT') {
        attemptRef.current = null;
        normalizedError.message = SALE_DELIVERY_VERSION_CONFLICT_MESSAGE;
        setError(normalizedError);
        const refreshedEligibility = await loadEligibility({ resetSelection: true, keepError: true });
        await onVersionConflictRef.current?.({ message: SALE_DELIVERY_VERSION_CONFLICT_MESSAGE, eligibility: refreshedEligibility });
        return null;
      }
      setError(normalizedError);
      if (isAuthoritativeSaleDeliveryError(normalizedError.code)) {
        const refreshedEligibility = await loadEligibility({ resetSelection: true, keepError: true });
        if (refreshedEligibility?.blockingReasons?.length) {
          normalizedError.message = getSaleDeliveryReasonMessage(refreshedEligibility.blockingReasons[0]);
          setError(normalizedError);
        }
        await onTargetRefreshRef.current?.({
          eligibility: refreshedEligibility,
          reason: normalizedError.code,
          message: normalizedError.message,
        });
      }
      return null;
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }, [fingerprint, loadEligibility, payload, payloadIssue, saleId, submitting, tenantId]);

  return {
    status,
    eligibility,
    selection,
    error,
    notice,
    result,
    submitting,
    payloadIssue,
    canSubmit: status === 'ready' && eligibility?.eligible === true && !payloadIssue,
    setQuantity,
    setTrackingUnit,
    submit,
    retryEligibility: () => loadEligibility({ resetSelection: true }),
  };
}
