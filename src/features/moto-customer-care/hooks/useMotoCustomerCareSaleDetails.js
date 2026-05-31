import { useEffect, useState } from 'react';
import { motoCustomerCareService } from '@/features/moto-customer-care/services/motoCustomerCare.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function useMotoCustomerCareSaleDetails(saleId) {
  const { tenant } = useWorkspace();
  const [sale, setSale] = useState(null);
  const [loadStatus, setLoadStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    if (!tenant?.id || !saleId) {
      setSale(null);
      setLoadStatus('idle');
      setError('');
      return undefined;
    }

    setLoadStatus('loading');
    setError('');

    motoCustomerCareService
      .getSaleDetails({ tenantId: tenant.id, saleId })
      .then((row) => {
        if (!active) {
          return;
        }

        setSale(row);
        setLoadStatus('ready');
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }

        setSale(null);
        setLoadStatus('error');
        setError(nextError?.message || 'تعذر تحميل تفاصيل العملية.');
      });

    return () => {
      active = false;
    };
  }, [saleId, tenant?.id]);

  return {
    sale,
    isLoading: loadStatus === 'loading',
    error,
    loadStatus,
  };
}
