import { useCallback, useEffect, useRef, useState } from 'react';
import { salesService } from '@/features/sales/services/sales.service';

export function useSalesBranchReports({ tenantId, month }) {
  const [state, setState] = useState({ status: 'loading', data: [], error: '' });
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!tenantId) {
      setState({ status: 'error', data: [], error: 'تعذر تحديد مساحة العمل الحالية.' });
      return;
    }
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const data = await salesService.getSalesBranchReports({ tenantId, month });
      if (requestIdRef.current === requestId) setState({ status: 'ready', data, error: '' });
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setState({ status: 'error', data: [], error: error?.message || 'تعذر تحميل تقارير الفروع.' });
      }
    }
  }, [month, tenantId]);

  useEffect(() => {
    void load();
    return () => { requestIdRef.current += 1; };
  }, [load]);

  return { ...state, retry: load };
}
