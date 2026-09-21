import { useCallback, useEffect, useRef, useState } from 'react';
import { salesService } from '@/features/sales/services/sales.service';

const EMPTY_RESULT = Object.freeze({
  items: [],
  page: 1,
  pageSize: 25,
  pageCount: 0,
  totalCount: 0,
  filterOptions: { branches: [] },
});

export function useSalesList({ tenantId, filters, page, pageSize = 25, searchDelay = 300, loadAll = false }) {
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const [state, setState] = useState({ status: 'loading', data: EMPTY_RESULT, error: '' });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(filters.search.trim()), searchDelay);
    return () => window.clearTimeout(timer);
  }, [filters.search, searchDelay]);

  const load = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!tenantId) {
      setState({ status: 'error', data: EMPTY_RESULT, error: 'تعذر تحديد مساحة العمل الحالية.' });
      return;
    }

    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      let data = await salesService.listSales({
        tenantId,
        page: loadAll ? 1 : page,
        pageSize,
        ...filters,
        search: debouncedSearch,
      });
      if (loadAll && data.pageCount > 1) {
        const items = [...data.items];
        for (let nextPage = 2; nextPage <= data.pageCount; nextPage += 1) {
          if (requestIdRef.current !== requestId) return;
          const nextResult = await salesService.listSales({
            tenantId,
            page: nextPage,
            pageSize,
            ...filters,
            search: debouncedSearch,
          });
          items.push(...nextResult.items);
        }
        data = {
          ...data,
          items,
          page: 1,
          pageSize: Math.max(items.length, 1),
          pageCount: items.length ? 1 : 0,
        };
      }
      if (requestIdRef.current === requestId) {
        setState({ status: 'ready', data, error: '' });
      }
    } catch (error) {
      if (requestIdRef.current === requestId) {
        setState((current) => ({
          ...current,
          status: 'error',
          error: error?.message || 'تعذر تحميل المبيعات.',
        }));
      }
    }
  }, [
    debouncedSearch,
    filters.branchId,
    filters.dateFrom,
    filters.dateTo,
    filters.fulfillmentStatus,
    filters.paymentStatus,
    filters.status,
    loadAll,
    page,
    pageSize,
    tenantId,
  ]);

  useEffect(() => {
    void load();
    return () => { requestIdRef.current += 1; };
  }, [load]);

  return { ...state, retry: load, debouncedSearch };
}
