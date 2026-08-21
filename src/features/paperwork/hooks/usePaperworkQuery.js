import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function usePaperworkTenant() {
  const { tenant } = useWorkspace();
  return tenant?.id || null;
}

export function usePaperworkQuery(loader, dependencies = []) {
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const requestIdRef = useRef(0);
  const run = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const data = await loader();
      if (requestIdRef.current !== requestId) return;
      setState({ data, loading: false, error: '' });
    } catch (error) {
      if (requestIdRef.current !== requestId) return;
      setState((current) => ({ ...current, loading: false, error: error?.message || 'تعذر تحميل البيانات.' }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
  useEffect(() => { void run(); return () => { requestIdRef.current += 1; }; }, [run]);
  return { ...state, retry: run };
}
