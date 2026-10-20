import { useCallback, useEffect, useRef, useState } from 'react';

export function useCustomerSearch({ open, disabled, searchCustomers, debounceMs = 250, pageSize = 20 } = {}) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const load = useCallback(async ({ nextPage = 1, append = false } = {}) => {
    if (disabled || !open || !searchCustomers) return;
    const request = ++requestRef.current;
    setStatus('loading'); setError('');
    try {
      const result = await searchCustomers({ search: search.trim(), page: nextPage, pageSize });
      if (request !== requestRef.current) return;
      const nextItems = result?.items || [];
      setItems((current) => append ? [...current, ...nextItems.filter((item) => !current.some((entry) => entry.id === item.id))] : nextItems);
      setPage(result?.page || nextPage); setHasMore(Boolean(result?.hasMore)); setStatus('ready');
    } catch (nextError) {
      if (request !== requestRef.current) return;
      setError(nextError?.message || 'تعذر تحميل العملاء.'); setStatus('error');
    }
  }, [disabled, open, pageSize, search, searchCustomers]);
  useEffect(() => {
    if (disabled || !open) { requestRef.current += 1; setItems([]); setStatus('idle'); return undefined; }
    const timer = window.setTimeout(() => load({ nextPage: 1 }), search.trim() ? debounceMs : 0);
    return () => window.clearTimeout(timer);
  }, [debounceMs, disabled, load, open, search]);
  const loadMore = useCallback(() => {
    if (status !== 'loading' && hasMore) void load({ nextPage: page + 1, append: true });
  }, [hasMore, load, page, status]);
  const reset = useCallback(() => { setSearch(''); setItems([]); setPage(1); setHasMore(false); setError(''); }, []);
  const retry = useCallback(() => void load({ nextPage: 1 }), [load]);
  return { search, setSearch, items, status, error, hasMore, loadMore, retry, reset };
}
