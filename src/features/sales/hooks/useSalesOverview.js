import { useCallback, useEffect, useRef, useState } from 'react';
import { salesService } from '@/features/sales/services/sales.service';

const EMPTY_OVERVIEW = Object.freeze({
  period: { code: 'last_7_days', dateFrom: '', dateTo: '' },
  scope: { selectedBranchId: null, defaultBranchId: null, branches: [] },
  kpis: {
    confirmedSalesCount: 0,
    confirmedSalesValueByCurrency: [],
    outstandingByCurrency: [],
    pendingDeliveryCount: 0,
  },
  draftsPreview: [],
  outstandingPreview: [],
  pendingDeliveryPreview: [],
  recentSales: [],
  salespersonBreakdown: [],
});

export function useSalesOverview({ tenantId, period, branchId }) {
  const [state, setState] = useState({ status: 'loading', data: EMPTY_OVERVIEW, error: '' });
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!tenantId) {
      setState({ status: 'error', data: EMPTY_OVERVIEW, error: 'تعذر تحديد مساحة العمل الحالية.' });
      return;
    }

    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const data = await salesService.getSalesOverview({ tenantId, period, branchId });
      if (requestIdRef.current === requestId) setState({ status: 'ready', data, error: '' });
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: error?.message || 'تعذر تحميل نظرة المبيعات.',
        }));
      }
    }
  }, [branchId, period, tenantId]);

  useEffect(() => {
    void load();
    return () => { requestIdRef.current += 1; };
  }, [load]);

  return { ...state, retry: load };
}
