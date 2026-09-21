import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createInitialSettlementForm,
  getSettlementErrorDescriptor,
  resolveSettlementAttempt,
  validateMoneyPaymentInput,
} from '../services/settlement.model';
import { settlementService } from '../services/settlement.service';

const EMPTY_FORM = Object.freeze({
  mechanism: '',
  amount: '',
  paymentMethodId: '',
  moneyDestinationId: '',
  referenceNumber: '',
  notes: '',
});

export function useSettlementWorkspace({ open, targetType, targetId, onSettled, onTargetRefresh } = {}) {
  const [status, setStatus] = useState('idle');
  const [options, setOptions] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const attemptRef = useRef(null);
  const submitLockRef = useRef(false);
  const requestVersionRef = useRef(0);
  const activeTargetRef = useRef('');
  const onSettledRef = useRef(onSettled);
  const onTargetRefreshRef = useRef(onTargetRefresh);

  useEffect(() => {
    onSettledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    onTargetRefreshRef.current = onTargetRefresh;
  }, [onTargetRefresh]);

  const loadOptions = useCallback(async ({ resetForm = false, keepError = false } = {}) => {
    const requestVersion = ++requestVersionRef.current;
    setStatus((current) => current === 'ready' ? 'refreshing' : 'loading');
    if (!keepError) setError(null);
    setNotice('');
    try {
      const nextOptions = await settlementService.getSettlementOptions({ targetType, targetId });
      if (requestVersionRef.current !== requestVersion) return null;
      setOptions(nextOptions);
      setForm((current) => createInitialSettlementForm(nextOptions, current, { reset: resetForm }));
      setStatus('ready');
      return nextOptions;
    } catch (nextError) {
      if (requestVersionRef.current !== requestVersion) return null;
      setStatus('error');
      setError(getSettlementErrorDescriptor(nextError, 'تعذر تحميل خيارات التحصيل.'));
      return null;
    }
  }, [targetId, targetType]);

  useEffect(() => {
    if (!open) {
      requestVersionRef.current += 1;
      return;
    }

    const targetKey = `${String(targetType || '').trim()}:${String(targetId || '').trim()}`;
    const targetChanged = activeTargetRef.current !== targetKey;
    if (targetChanged) {
      activeTargetRef.current = targetKey;
      attemptRef.current = null;
      setOptions(null);
      setForm(EMPTY_FORM);
      setResult(null);
      setError(null);
      setNotice('');
    }
    loadOptions({ resetForm: targetChanged || !options }).catch(() => {});
  // Opening must refresh authoritative state; options is deliberately not a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, targetId, targetType, loadOptions]);

  const selectedMechanism = useMemo(
    () => options?.settlementMechanisms?.find((item) => item.code === form.mechanism) ?? null,
    [form.mechanism, options?.settlementMechanisms],
  );
  const selectedPaymentMethod = useMemo(
    () => selectedMechanism?.paymentMethods?.find((item) => item.id === form.paymentMethodId) ?? null,
    [form.paymentMethodId, selectedMechanism?.paymentMethods],
  );

  const setField = useCallback((field, value) => {
    setForm((current) => {
      if (field === 'mechanism') {
        const mechanism = options?.settlementMechanisms?.find((item) => item.code === value);
        return {
          ...current,
          mechanism: value,
          paymentMethodId: mechanism?.paymentMethods?.[0]?.id || '',
          moneyDestinationId: '',
        };
      }
      if (field === 'paymentMethodId') {
        return { ...current, paymentMethodId: value, moneyDestinationId: '' };
      }
      return { ...current, [field]: value };
    });
    setError(null);
    setNotice('');
  }, [options?.settlementMechanisms]);

  const submit = useCallback(async (event) => {
    event?.preventDefault?.();
    if (submitLockRef.current || submitting || !options?.canSettle) return null;

    const validationMessage = form.mechanism === 'money_payment'
      ? validateMoneyPaymentInput({
        amount: form.amount,
        outstandingAmount: options.outstandingAmount,
        paymentMethod: selectedPaymentMethod,
        moneyDestinationId: form.moneyDestinationId,
        referenceNumber: form.referenceNumber,
      })
      : 'آلية التحصيل المختارة غير مدعومة في هذه النسخة.';
    if (validationMessage) {
      setError({ code: 'CLIENT_VALIDATION', message: validationMessage, shouldRefreshOptions: false });
      return null;
    }

    const payload = {
      targetType,
      targetId,
      mechanism: form.mechanism,
      amount: Number(form.amount),
      paymentMethodId: selectedPaymentMethod.id,
      moneyDestinationId: selectedPaymentMethod.requiresMoneyDestination
        ? form.moneyDestinationId
        : null,
      referenceNumber: form.referenceNumber.trim() || null,
      notes: form.notes.trim() || null,
    };
    attemptRef.current = resolveSettlementAttempt(attemptRef.current, payload);

    submitLockRef.current = true;
    setSubmitting(true);
    setError(null);
    setNotice('');
    try {
      const commandResult = await settlementService.settleObligation({
        ...payload,
        idempotencyKey: attemptRef.current.idempotencyKey,
      });

      let refreshedOptions = null;
      try {
        refreshedOptions = await settlementService.getSettlementOptions({ targetType, targetId });
        setOptions(refreshedOptions);
        setForm((current) => createInitialSettlementForm(refreshedOptions, current));
        setStatus('ready');
      } catch {
        setNotice('تم التحصيل بنجاح، لكن تعذر تحديث الرصيد الآن. حدّث الشاشة لقراءة أحدث رصيد.');
      }

      setResult(commandResult);
      attemptRef.current = null;
      try {
        await onSettledRef.current?.({ result: commandResult, options: refreshedOptions });
      } catch {
        setNotice('تم التحصيل بنجاح، لكن تعذر تحديث الشاشة الأصلية تلقائيًا.');
      }
      return commandResult;
    } catch (nextError) {
      const descriptor = getSettlementErrorDescriptor(nextError);
      setError(descriptor);
      if (descriptor.shouldRefreshOptions) {
        try {
          const refreshedOptions = await settlementService.getSettlementOptions({ targetType, targetId });
          setOptions(refreshedOptions);
          setForm((current) => createInitialSettlementForm(refreshedOptions, current));
          setStatus('ready');
          await onTargetRefreshRef.current?.({ options: refreshedOptions, reason: descriptor.code });
        } catch {
          setNotice('تعذر تحديث خيارات التحصيل بعد الرفض. أعد تحميل البيانات قبل المحاولة التالية.');
        }
      }
      return null;
    } finally {
      submitLockRef.current = false;
      setSubmitting(false);
    }
  }, [form, options, selectedPaymentMethod, submitting, targetId, targetType]);

  const startAnother = useCallback(() => {
    attemptRef.current = null;
    setResult(null);
    setError(null);
    setNotice('');
    setForm((current) => createInitialSettlementForm(options, current, { reset: true }));
  }, [options]);

  return {
    status,
    options,
    form,
    selectedMechanism,
    selectedPaymentMethod,
    error,
    notice,
    result,
    submitting,
    setField,
    submit,
    retryOptions: () => loadOptions({ resetForm: !options }),
    startAnother,
  };
}
