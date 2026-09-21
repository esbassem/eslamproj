import { useCallback, useEffect, useState } from 'react';
import { salesService } from '@/features/sales/services/sales.service';

export function useSaleDetails({ tenantId, saleId }) {
  const [state, setState] = useState({ status: 'loading', sale: null, readiness: null, error: '' });

  const load = useCallback(async () => {
    if (!tenantId || !saleId) return;
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const sale = await salesService.getSaleDetails({ tenantId, saleId });
      let readiness = null;
      if (sale.commercialStatus === 'draft') {
        try {
          readiness = await salesService.getSaleReadiness({ tenantId, saleId });
        } catch {
          readiness = null;
        }
      }
      setState({ status: 'ready', sale, readiness, error: '' });
    } catch (error) {
      setState({ status: 'error', sale: null, readiness: null, error: error.message || 'تعذر تحميل تفاصيل البيع.' });
    }
  }, [saleId, tenantId]);

  useEffect(() => { void load(); }, [load]);

  const refreshReadiness = useCallback(async () => {
    if (!tenantId || !saleId) return null;
    const readiness = await salesService.getSaleReadiness({ tenantId, saleId });
    setState((current) => ({ ...current, readiness }));
    return readiness;
  }, [saleId, tenantId]);

  return { ...state, reload: load, refreshReadiness };
}
