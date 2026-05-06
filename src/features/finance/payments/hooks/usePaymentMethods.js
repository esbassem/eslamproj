import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createJournal,
  createPaymentMethod,
  createPaymentMethodLine,
  ensureDefaultPaymentSetup,
  fetchPaymentJournals,
  fetchPaymentMethods,
  getPaymentMethodLines,
  toggleJournalActive,
  togglePaymentMethod,
  togglePaymentMethodLine,
  updateJournal,
  updatePaymentMethod,
  updatePaymentMethodLine,
} from '@/features/finance/payments/api/payments.api';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function usePaymentMethods(options = {}) {
  const { tenant } = useWorkspace();
  const tenantId = options.tenantId ?? tenant?.id;
  const enabled = options.enabled ?? true;
  const shouldBootstrap = options.bootstrap ?? false;
  const includeMethods = options.includeMethods ?? true;
  const includeMethodLines = options.includeMethodLines ?? false;
  const includeCashDestinations = options.includeCashDestinations ?? true;
  const bootstrappedTenantRef = useRef(null);
  const [methods, setMethods] = useState([]);
  const [methodLines, setMethodLines] = useState([]);
  const [paymentJournals, setPaymentJournals] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const loadPaymentMethods = useCallback(async () => {
    if (!enabled || !tenantId) {
      setMethods([]);
      setMethodLines([]);
      setPaymentJournals([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      if (shouldBootstrap && bootstrappedTenantRef.current !== tenantId) {
        await ensureDefaultPaymentSetup(tenantId);
        bootstrappedTenantRef.current = tenantId;
      }

      const [nextMethods, nextMethodLines, nextPaymentJournals] = await Promise.all([
        includeMethods ? fetchPaymentMethods(tenantId) : Promise.resolve([]),
        includeMethodLines ? getPaymentMethodLines(tenantId) : Promise.resolve([]),
        includeCashDestinations ? fetchPaymentJournals(tenantId) : Promise.resolve([]),
      ]);

      setMethods(nextMethods);
      setMethodLines(nextMethodLines);
      setPaymentJournals(nextPaymentJournals);
      setError('');
    } catch (loadError) {
      setError(loadError?.message || 'تعذر تحميل إعدادات طرق الدفع.');
    } finally {
      setIsLoading(false);
    }
  }, [
    enabled,
    includeCashDestinations,
    includeMethodLines,
    includeMethods,
    shouldBootstrap,
    tenantId,
  ]);

  useEffect(() => {
    loadPaymentMethods();
  }, [loadPaymentMethods]);

  const saveMethod = useCallback(async (payload) => {
    setIsSaving(true);
    try {
      const saved = payload.id
        ? await updatePaymentMethod(payload.id, payload)
        : await createPaymentMethod({ ...payload, isActive: payload.isActive ?? true });

      await loadPaymentMethods();
      return { data: saved };
    } catch (saveError) {
      return { error: saveError?.message || 'تعذر حفظ طريقة الدفع المحاسبية.' };
    } finally {
      setIsSaving(false);
    }
  }, [loadPaymentMethods]);

  const saveMethodLine = useCallback(async (payload) => {
    if (!tenantId) {
      return { error: 'لا يمكن حفظ الربط بدون تحديد الشركة الحالية.' };
    }

    setIsSaving(true);
    try {
      const body = { ...payload, tenantId };
      const saved = payload.id
        ? await updatePaymentMethodLine(payload.id, body)
        : await createPaymentMethodLine({ ...body, isActive: payload.isActive ?? true });

      await loadPaymentMethods();
      return { data: saved };
    } catch (saveError) {
      return { error: saveError?.message || 'تعذر حفظ ربط طريقة الدفع بالجورنال المالي.' };
    } finally {
      setIsSaving(false);
    }
  }, [loadPaymentMethods, tenantId]);

  const setMethodActive = useCallback(async (id, isActive) => {
    setIsSaving(true);
    try {
      const saved = await togglePaymentMethod(id, isActive);
      await loadPaymentMethods();
      return { data: saved };
    } catch (saveError) {
      return { error: saveError?.message || 'تعذر تحديث طريقة الدفع المحاسبية.' };
    } finally {
      setIsSaving(false);
    }
  }, [loadPaymentMethods]);

  const setMethodLineActive = useCallback(async (id, isActive) => {
    if (!tenantId) {
      return { error: 'لا يمكن تحديث الربط بدون تحديد الشركة الحالية.' };
    }

    setIsSaving(true);
    try {
      const saved = await togglePaymentMethodLine(id, isActive, tenantId);
      await loadPaymentMethods();
      return { data: saved };
    } catch (saveError) {
      return { error: saveError?.message || 'تعذر تحديث ربط طريقة الدفع بالجورنال المالي.' };
    } finally {
      setIsSaving(false);
    }
  }, [loadPaymentMethods, tenantId]);

  const saveJournal = useCallback(async (payload) => {
    if (!tenantId) {
      return { error: 'لا يمكن حفظ الجورنال المالي بدون تحديد الشركة الحالية.' };
    }

    setIsSaving(true);
    try {
      const body = { ...payload, tenantId };
      const saved = payload.id
        ? await updateJournal(payload.id, body)
        : await createJournal({ ...body, isActive: payload.isActive ?? true });

      await loadPaymentMethods();
      return { data: saved };
    } catch (saveError) {
      return { error: saveError?.message || 'تعذر حفظ الجورنال المالي.' };
    } finally {
      setIsSaving(false);
    }
  }, [loadPaymentMethods, tenantId]);

  const setJournalActive = useCallback(async (id, isActive) => {
    if (!tenantId) {
      return { error: 'لا يمكن تحديث الجورنال المالي بدون تحديد الشركة الحالية.' };
    }

    setIsSaving(true);
    try {
      const saved = await toggleJournalActive(id, isActive, tenantId);
      await loadPaymentMethods();
      return { data: saved };
    } catch (saveError) {
      return { error: saveError?.message || 'تعذر تحديث حالة الجورنال المالي.' };
    } finally {
      setIsSaving(false);
    }
  }, [loadPaymentMethods, tenantId]);

  const activeMethods = useMemo(() => methods.filter((method) => method.active), [methods]);
  const activePaymentJournals = useMemo(
    () => paymentJournals.filter((journal) => journal.active),
    [paymentJournals],
  );

  return {
    methods,
    methodLines,
    cashDestinations: paymentJournals,
    paymentJournals,
    journals: paymentJournals,
    activeMethods,
    activeCashDestinations: activePaymentJournals,
    activePaymentJournals,
    isLoading,
    isSaving,
    error,
    reload: loadPaymentMethods,
    saveMethod,
    saveMethodLine,
    saveJournal,
    setMethodActive,
    setMethodLineActive,
    setJournalActive,
  };
}
