import { useCallback, useEffect, useState } from 'react';
import {
  fetchCashDestinations,
  fetchPaymentRules,
  savePaymentRules,
} from '@/features/finance/payments/api/payments.api';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function usePayments(options = {}) {
  const { tenant } = useWorkspace();
  const tenantId = options.tenantId ?? tenant?.id;
  const enabled = options.enabled ?? true;
  const includeCashDestinations = options.includeCashDestinations ?? true;
  const [rules, setRules] = useState(null);
  const [cashDestinations, setCashDestinations] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function loadPaymentSettings() {
      if (!enabled || !tenantId) {
        setRules(null);
        setCashDestinations([]);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        const [nextRules, nextCashDestinations] = await Promise.all([
          fetchPaymentRules(tenantId),
          includeCashDestinations ? fetchCashDestinations(tenantId) : Promise.resolve([]),
        ]);

        if (isMounted) {
          setRules(nextRules);
          setCashDestinations(nextCashDestinations);
          setError('');
        }
      } catch (loadError) {
        if (isMounted) {
          setError(loadError?.message || 'تعذر تحميل القواعد العامة للدفع.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadPaymentSettings();

    return () => {
      isMounted = false;
    };
  }, [enabled, includeCashDestinations, tenantId]);

  const updateRules = useCallback(async (nextRules) => {
    if (!tenantId) {
      return { error: 'لا يمكن حفظ القواعد العامة بدون تحديد الشركة الحالية.' };
    }

    setIsSaving(true);
    try {
      const savedRules = await savePaymentRules(tenantId, nextRules);
      setRules(savedRules);
      setError('');
      return { data: savedRules };
    } catch (saveError) {
      const message = saveError?.message || 'تعذر حفظ القواعد العامة.';
      setError(message);
      return { error: message };
    } finally {
      setIsSaving(false);
    }
  }, [tenantId]);

  const submitPayment = useCallback(async () => ({
    error: 'تسجيل الدفع غير مفعل من إعدادات الدفع.',
  }), []);

  return {
    rules,
    cashDestinations,
    isLoading,
    isSaving,
    error,
    updateRules,
    submitPayment,
  };
}
