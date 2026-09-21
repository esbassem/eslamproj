import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { salesReturnService } from '@/features/sales/services/salesReturn.service';
import {
  buildSaleReturnLines,
  createInitialReturnSelection,
  getSaleReturnSelectionIssue,
  resolveSaleRefundAttempt,
  resolveSaleReturnAttempt,
} from '@/features/sales/services/salesReturn.model';

export function useSaleReturnEligibility({ tenantId, saleId, enabled = true } = {}) {
  const [state, setState] = useState({ status: 'idle', eligibility: null, error: null });
  const requestRef = useRef(0);
  const reload = useCallback(async () => {
    if (!enabled || !tenantId || !saleId) return null;
    const request = ++requestRef.current;
    setState((current) => ({ ...current, status: current.eligibility ? 'refreshing' : 'loading', error: null }));
    try {
      const eligibility = await salesReturnService.getSaleReturnEligibility({ tenantId, saleId });
      if (requestRef.current !== request) return null;
      setState({ status: 'ready', eligibility, error: null });
      return eligibility;
    } catch (error) {
      if (requestRef.current === request) setState({ status: 'error', eligibility: null, error });
      return null;
    }
  }, [enabled, saleId, tenantId]);
  useEffect(() => { if (enabled) void reload(); else setState({ status: 'idle', eligibility: null, error: null }); return () => { requestRef.current += 1; }; }, [enabled, reload]);
  return { ...state, reload };
}

export function useSaleReturn({ open, tenantId, sale, initialEligibility, onReturned, onVersionConflict, onTargetRefresh } = {}) {
  const [eligibility, setEligibility] = useState(initialEligibility || null);
  const [selection, setSelection] = useState({});
  const [destinationId, setDestinationId] = useState('');
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const lockRef = useRef(false);
  const attemptRef = useRef(null);
  const load = useCallback(async () => {
    if (!tenantId || !sale?.id) return null;
    setStatus('loading'); setError(null);
    try {
      const next = await salesReturnService.getSaleReturnEligibility({ tenantId, saleId: sale.id });
      setEligibility(next); setSelection(createInitialReturnSelection(next));
      setDestinationId(next.destinations.length === 1 ? next.destinations[0].id : '');
      setStatus('ready'); return next;
    } catch (caught) { setError(caught); setStatus('error'); return null; }
  }, [sale?.id, tenantId]);
  useEffect(() => { if (!open) return; setReason(''); setResult(null); attemptRef.current = null; void load(); }, [load, open]);
  const returnLines = useMemo(() => eligibility ? buildSaleReturnLines(eligibility, selection) : [], [eligibility, selection]);
  const payload = useMemo(() => ({ saleId: sale?.id, expectedVersion: sale?.version, returnLines, destinationLocationId: destinationId || null, reason: reason.trim() }), [destinationId, reason, returnLines, sale?.id, sale?.version]);
  const issue = getSaleReturnSelectionIssue(eligibility, selection, destinationId, reason);
  const total = returnLines.reduce((sum, item) => sum + item.quantity * (eligibility?.lines.find((line) => line.saleLineId === item.sale_line_id)?.unitPrice || 0), 0);
  const setQuantity = (lineId, value) => { setSelection((current) => ({ ...current, [lineId]: { ...(current[lineId] || {}), quantity: value } })); setError(null); };
  const setUnit = (lineId, unitId, checked) => { setSelection((current) => ({ ...current, [lineId]: { ...(current[lineId] || {}), units: { ...(current[lineId]?.units || {}), [unitId]: checked } } })); setError(null); };
  const submit = useCallback(async (event) => {
    event?.preventDefault?.(); if (lockRef.current || submitting || issue) return null;
    lockRef.current = true; setSubmitting(true); setError(null);
    try {
      const fresh = await salesReturnService.getSaleReturnEligibility({ tenantId, saleId: sale.id });
      setEligibility(fresh);
      if (!fresh.canReturn) { const blocked = new Error(fresh.reasonMessage); setError(blocked); await onTargetRefresh?.({ eligibility: fresh, message: blocked.message }); return null; }
      attemptRef.current = resolveSaleReturnAttempt(attemptRef.current, payload);
      const next = await salesReturnService.returnSale({ tenantId, ...payload, idempotencyKey: attemptRef.current.idempotencyKey });
      setResult(next); attemptRef.current = null; await onReturned?.(next); return next;
    } catch (caught) {
      setError(caught);
      if (caught?.code === 'SALES_VERSION_CONFLICT') { attemptRef.current = null; await onVersionConflict?.('تم تحديث البيع؛ راجع البنود المتاحة ثم حاول مرة أخرى.'); }
      else await onTargetRefresh?.({ message: caught?.message });
      return null;
    } finally { lockRef.current = false; setSubmitting(false); }
  }, [issue, onReturned, onTargetRefresh, onVersionConflict, payload, sale?.id, submitting, tenantId]);
  return { eligibility, selection, destinationId, reason, status, error, result, submitting, issue, total, setDestinationId, setReason, setQuantity, setUnit, submit, retryEligibility: load };
}

export function useSaleRefund({ open, tenantId, saleId, saleReturnId, onRefunded } = {}) {
  const [options, setOptions] = useState(null); const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState(''); const [destinationId, setDestinationId] = useState('');
  const [reason, setReason] = useState(''); const [reference, setReference] = useState(''); const [notes, setNotes] = useState('');
  const [error, setError] = useState(null); const [result, setResult] = useState(null); const [submitting, setSubmitting] = useState(false);
  const attemptRef = useRef(null); const lockRef = useRef(false);
  const load = useCallback(async () => { if (!tenantId || !saleId) return null; try { const next = await salesReturnService.getSaleRefundOptions({ tenantId, saleId }); setOptions(next); const credit = next.credits.find((item) => item.saleReturnId === saleReturnId); setAmount(String(credit?.refundableAmount || '')); return next; } catch (caught) { setError(caught); return null; } }, [saleId, saleReturnId, tenantId]);
  useEffect(() => { if (!open) return; setError(null); setResult(null); setMethodId(''); setDestinationId(''); setReason(''); setReference(''); setNotes(''); attemptRef.current = null; void load(); }, [load, open]);
  const credit = options?.credits.find((item) => item.saleReturnId === saleReturnId);
  const method = options?.methods.find((item) => item.id === methodId);
  const issue = !credit ? 'لا يوجد رصيد قابل للرد.' : Number(amount) <= 0 || Number(amount) > credit.refundableAmount ? 'أدخل مبلغًا ضمن الرصيد القابل للرد.' : !methodId ? 'اختر طريقة رد المبلغ.' : !destinationId ? 'اختر المورد المالي.' : method?.requiresReference && !reference.trim() ? 'المرجع مطلوب لهذه الطريقة.' : !reason.trim() ? 'سبب رد المبلغ مطلوب.' : '';
  const chooseMethod = (value) => { setMethodId(value); const next = options?.methods.find((item) => item.id === value); setDestinationId(next?.destinations.length === 1 ? next.destinations[0].id : ''); };
  const submit = useCallback(async (event) => { event?.preventDefault?.(); if (issue || lockRef.current || submitting) return null; lockRef.current = true; setSubmitting(true); setError(null); const payload = { saleReturnId, amount: Number(amount), paymentMethodId: methodId, moneyDestinationId: destinationId, reason: reason.trim(), reference: reference.trim(), notes: notes.trim() }; try { attemptRef.current = resolveSaleRefundAttempt(attemptRef.current, payload); const next = await salesReturnService.refundSaleReturn({ tenantId, ...payload, idempotencyKey: attemptRef.current.idempotencyKey }); setResult(next); attemptRef.current = null; await onRefunded?.(next); return next; } catch (caught) { setError(caught); await load(); return null; } finally { lockRef.current = false; setSubmitting(false); } }, [amount, destinationId, issue, load, methodId, notes, onRefunded, reason, reference, saleReturnId, submitting, tenantId]);
  return { options, credit, methods: options?.methods || [], method, amount, setAmount, methodId, chooseMethod, destinationId, setDestinationId, reason, setReason, reference, setReference, notes, setNotes, error, result, submitting, issue, submit, retry: load };
}
