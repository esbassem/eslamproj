import { useCallback, useEffect, useRef, useState } from 'react';
import { normalizeProductOption } from '@/shared/products/productSelection.model';

export function usePagedProductSearch({ searchProducts, search = '', disabled = false, minSearchLength = 0, pageSize = 20, debounceMs = 250 } = {}) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const requestIdRef = useRef(0);

  const load = useCallback(async (nextPage, append, signal) => {
    const requestId = ++requestIdRef.current;
    const term = String(search).trim();
    if (disabled || !searchProducts || term.length < minSearchLength) {
      setItems([]); setPage(1); setHasMore(false); setStatus('idle'); setError('');
      return;
    }
    setStatus(append ? 'loading-more' : 'loading'); setError('');
    try {
      const result = await searchProducts({ search: term, page: nextPage, pageSize });
      if (signal.cancelled || requestId !== requestIdRef.current) return;
      const nextItems = (result?.items || []).map(normalizeProductOption).filter((item) => item.id);
      setItems((current) => append ? [...current, ...nextItems.filter((item) => !current.some((existing) => existing.id === item.id))] : nextItems);
      setPage(Number(result?.page) || nextPage);
      setHasMore(Boolean(result?.hasMore ?? result?.has_more));
      setStatus('ready');
    } catch (nextError) {
      if (signal.cancelled || requestId !== requestIdRef.current) return;
      setError(nextError?.message || 'تعذر تحميل المنتجات.'); setStatus('error');
    }
  }, [disabled, minSearchLength, pageSize, search, searchProducts]);

  useEffect(() => {
    const signal = { cancelled: false };
    const timer = window.setTimeout(() => { void load(1, false, signal); }, debounceMs);
    return () => { signal.cancelled = true; window.clearTimeout(timer); };
  }, [debounceMs, load]);

  const loadMore = useCallback(() => {
    if (!hasMore || status === 'loading-more') return;
    void load(page + 1, true, { cancelled: false });
  }, [hasMore, load, page, status]);

  const reset = useCallback(() => { setItems([]); setPage(1); setHasMore(false); setStatus('idle'); setError(''); }, []);
  return { items, page, hasMore, status, error, loadMore, reset };
}
