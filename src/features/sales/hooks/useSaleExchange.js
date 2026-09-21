import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  buildExchangePayload,
  createExchangeDraftLine,
  createExchangeReturnSelection,
  getExchangeInputIssue,
  replacementDraftTotal,
  resolveSaleExchangeAttempt,
  selectedReturnTotal,
} from '@/features/sales/services/salesExchange.model';
import { salesExchangeService } from '@/features/sales/services/salesExchange.service';

export function useSaleExchangeEligibility({ tenantId, saleId, enabled = true } = {}) {
  const [state, setState] = useState({ status: 'idle', eligibility: null, error: '' });
  const reload = useCallback(async () => {
    if (!enabled || !tenantId || !saleId) {
      setState({ status: 'idle', eligibility: null, error: '' });
      return null;
    }
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const eligibility = await salesExchangeService.getSaleExchangeEligibility({ tenantId, saleId });
      setState({ status: 'ready', eligibility, error: '' });
      return eligibility;
    } catch (error) {
      setState({ status: 'error', eligibility: null, error: error.message });
      return null;
    }
  }, [enabled, saleId, tenantId]);
  useEffect(() => { void reload(); }, [reload]);
  return { ...state, reload };
}

export function useSaleExchange({
  open,
  tenantId,
  sale,
  initialEligibility,
  onStarted,
  onVersionConflict,
  onTargetRefresh,
} = {}) {
  const [eligibility, setEligibility] = useState(initialEligibility || null);
  const [status, setStatus] = useState('idle');
  const [step, setStep] = useState(1);
  const [returnSelection, setReturnSelection] = useState({});
  const [returnDestinationId, setReturnDestinationId] = useState('');
  const [replacementLocationId, setReplacementLocationId] = useState('');
  const [replacementLines, setReplacementLines] = useState([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const submitLockRef = useRef(false);
  const attemptRef = useRef(null);

  const applyEligibility = useCallback((next) => {
    setEligibility(next);
    setReturnSelection(createExchangeReturnSelection(next));
    setReturnDestinationId((current) => current || next?.returnEligibility?.destinations?.[0]?.id || '');
    setReplacementLocationId((current) => current || next?.replacementLocations?.[0]?.id || '');
  }, []);

  const reload = useCallback(async () => {
    if (!tenantId || !sale?.id) return null;
    setStatus('loading');
    setError(null);
    try {
      const next = await salesExchangeService.getSaleExchangeEligibility({ tenantId, saleId: sale.id });
      applyEligibility(next);
      setStatus('ready');
      return next;
    } catch (caught) {
      setError(caught);
      setStatus('error');
      return null;
    }
  }, [applyEligibility, sale?.id, tenantId]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setReason('');
    setReplacementLines([]);
    setError(null);
    attemptRef.current = null;
    if (initialEligibility) {
      applyEligibility(initialEligibility);
      setStatus('ready');
    }
    void reload();
  }, [applyEligibility, initialEligibility, open, reload]);

  const setUnit = (lineId, unitId, checked) => {
    setError(null);
    setReturnSelection((current) => ({
      ...current,
      [lineId]: {
        ...(current[lineId] || { quantity: '', units: {} }),
        units: { ...(current[lineId]?.units || {}), [unitId]: checked },
      },
    }));
  };
  const setQuantity = (lineId, quantity) => {
    setError(null);
    setReturnSelection((current) => ({
      ...current,
      [lineId]: { ...(current[lineId] || { units: {} }), quantity },
    }));
  };
  const addProduct = (product) => {
    setError(null);
    setReplacementLines((current) => [...current, createExchangeDraftLine(product)]);
  };
  const updateLine = (key, changes) => {
    setError(null);
    setReplacementLines((current) => current.map((line) => line.key === key ? { ...line, ...changes } : line));
  };
  const removeLine = (key) => {
    setError(null);
    setReplacementLines((current) => current.filter((line) => line.key !== key));
  };

  const form = useMemo(() => ({
    eligibility, returnSelection, returnDestinationId,
    replacementLocationId, replacementLines, reason,
  }), [eligibility, reason, replacementLines, replacementLocationId, returnDestinationId, returnSelection]);
  const issue = useMemo(() => getExchangeInputIssue(form), [form]);
  const returnedTotal = useMemo(
    () => selectedReturnTotal(eligibility, returnSelection),
    [eligibility, returnSelection],
  );
  const replacementTotal = useMemo(
    () => replacementDraftTotal(replacementLines),
    [replacementLines],
  );

  const submit = async (event) => {
    event?.preventDefault?.();
    if (submitLockRef.current || issue) return null;
    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const fresh = await salesExchangeService.getSaleExchangeEligibility({ tenantId, saleId: sale.id });
      if (!fresh.canExchange || fresh.expectedVersion !== eligibility.expectedVersion) {
        applyEligibility(fresh);
        const conflict = new Error('تم تحديث البيع من مستخدم آخر. راجع البيانات ثم أعد المحاولة.');
        conflict.code = 'SALES_VERSION_CONFLICT';
        await onVersionConflict?.(conflict.message);
        throw conflict;
      }
      const payload = buildExchangePayload({ ...form, eligibility: fresh });
      attemptRef.current = resolveSaleExchangeAttempt(attemptRef.current, payload);
      const result = await salesExchangeService.startSaleExchange({
        tenantId,
        payload,
        idempotencyKey: attemptRef.current.idempotencyKey,
      });
      attemptRef.current = null;
      await onStarted?.(result);
      return result;
    } catch (caught) {
      setError(caught);
      if (caught.code === 'SALES_VERSION_CONFLICT') await onTargetRefresh?.({ message: caught.message });
      return null;
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  };

  return {
    eligibility, status, step, setStep, returnSelection, returnDestinationId,
    setReturnDestinationId, replacementLocationId, setReplacementLocationId,
    replacementLines, reason, setReason, error, submitting, issue,
    returnedTotal, replacementTotal, estimatedDifference: replacementTotal - returnedTotal,
    reload, setUnit, setQuantity, addProduct, updateLine, removeLine, submit,
  };
}
