import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motoCustomerCareService } from '@/features/moto-customer-care/services/motoCustomerCare.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const EMPTY_PAPERWORK_REPORTS = Object.freeze({
  missing: 0,
  totalRequests: 0,
  vault: 0,
  sentPendingReceipt: 0,
  pendingNotification: 0,
});

function normalizeQuery(value) {
  return String(value || '').trim().toLowerCase();
}

function matchesSearch(sale, query) {
  if (!query) {
    return true;
  }

  const haystack = [
    sale.customer?.name,
    sale.customer?.phone,
    sale.saleDate,
    sale.status,
    sale.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(query);
}

export function useMotoCustomerCareSales({ search = '', status = 'all', limit = 150, paperworkRequestsLimit = limit, enabled = true, activeSection = 'sales' } = {}) {
  const { tenant } = useWorkspace();
  const [sales, setSales] = useState([]);
  const [paperworkRequests, setPaperworkRequests] = useState([]);
  const [paperworkDocuments, setPaperworkDocuments] = useState([]);
  const [paperworkDocumentMoves, setPaperworkDocumentMoves] = useState([]);
  const [paperworkReports, setPaperworkReports] = useState(EMPTY_PAPERWORK_REPORTS);
  const [reportsStatus, setReportsStatus] = useState('idle');
  const [reportsError, setReportsError] = useState('');
  const [sectionStatus, setSectionStatus] = useState({ sales: 'idle', requests: 'idle', papers: 'idle' });
  const [sectionError, setSectionError] = useState({ sales: '', requests: '', papers: '' });
  const requestsReadyRef = useRef(false);
  const requestsTenantIdRef = useRef(null);
  const requestsLimitRef = useRef(undefined);

  const setLoadStatus = useCallback((sectionId, nextStatus) => {
    setSectionStatus((current) => ({ ...current, [sectionId]: nextStatus }));
  }, []);

  const setLoadError = useCallback((sectionId, nextError) => {
    setSectionError((current) => ({ ...current, [sectionId]: nextError }));
  }, []);

  const resetData = useCallback(() => {
    setSales([]);
    setPaperworkRequests([]);
    setPaperworkDocuments([]);
    setPaperworkDocumentMoves([]);
    setPaperworkReports(EMPTY_PAPERWORK_REPORTS);
    setReportsStatus('idle');
    setReportsError('');
    setSectionStatus({ sales: 'idle', requests: 'idle', papers: 'idle' });
    setSectionError({ sales: '', requests: '', papers: '' });
    requestsReadyRef.current = false;
    requestsTenantIdRef.current = null;
    requestsLimitRef.current = undefined;
  }, []);

  const loadReports = useCallback(() => {
    let active = true;

    if (!tenant?.id) {
      setPaperworkReports(EMPTY_PAPERWORK_REPORTS);
      setReportsStatus('idle');
      setReportsError('');
      return () => {};
    }

    setReportsStatus('loading');
    setReportsError('');

    motoCustomerCareService.getPaperworkReportCounts({ tenantId: tenant.id })
      .then((reports) => {
        if (!active) {
          return;
        }

        setPaperworkReports(reports || EMPTY_PAPERWORK_REPORTS);
        setReportsStatus('ready');
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }

        setPaperworkReports(EMPTY_PAPERWORK_REPORTS);
        setReportsStatus('error');
        setReportsError(nextError?.message || 'تعذر تحميل تقارير الأوراق.');
      });

    return () => {
      active = false;
    };
  }, [tenant?.id]);

  const loadSales = useCallback(() => {
    let active = true;

    if (!tenant?.id) {
      resetData();
      return () => {};
    }

    if (!enabled) {
      setLoadStatus('sales', 'idle');
      setLoadError('sales', '');
      return () => {};
    }

    setLoadStatus('sales', 'loading');
    setLoadError('sales', '');

    motoCustomerCareService.listSales({ tenantId: tenant.id, status, limit, includeAttachments: false })
      .then((rows) => {
        if (!active) {
          return;
        }

        setSales(rows);
        setLoadStatus('sales', 'ready');
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }

        setSales([]);
        setLoadStatus('sales', 'error');
        setLoadError('sales', nextError?.message || 'تعذر تحميل عمليات المبيعات.');
      });

    return () => {
      active = false;
    };
  }, [enabled, limit, resetData, setLoadError, setLoadStatus, status, tenant?.id]);

  const loadRequests = useCallback((force = false) => {
    let active = true;
    const tenantChanged = requestsTenantIdRef.current !== tenant?.id;

    if (tenantChanged) {
      requestsReadyRef.current = false;
      requestsTenantIdRef.current = tenant?.id || null;
    }

    if (!tenant?.id) {
      setPaperworkRequests([]);
      requestsReadyRef.current = false;
      setLoadStatus('requests', 'idle');
      return () => {};
    }
    if (!enabled) {
      setLoadStatus('requests', 'idle');
      setLoadError('requests', '');
      return () => {};
    }
    if (!force && requestsReadyRef.current && requestsLimitRef.current === paperworkRequestsLimit) {
      return () => {};
    }

    setLoadStatus('requests', 'loading');
    setLoadError('requests', '');

    motoCustomerCareService.listPaperworkRequests({
      tenantId: tenant.id,
      limit: paperworkRequestsLimit,
      includeDetails: false,
    })
      .then((requests) => {
        if (!active) return;
        setPaperworkRequests(requests);
        requestsReadyRef.current = true;
        requestsTenantIdRef.current = tenant.id;
        requestsLimitRef.current = paperworkRequestsLimit;
        setLoadStatus('requests', 'ready');
      })
      .catch((nextError) => {
        if (!active) return;
        setPaperworkRequests([]);
        requestsReadyRef.current = false;
        setLoadStatus('requests', 'error');
        setLoadError('requests', nextError?.message || 'تعذر تحميل طلبات الأوراق.');
      });

    return () => {
      active = false;
    };
  }, [enabled, paperworkRequestsLimit, setLoadError, setLoadStatus, tenant?.id]);

  const loadPaperwork = useCallback(() => {
    let active = true;

    if (!tenant?.id) {
      resetData();
      return () => {};
    }

    if (!enabled) {
      setLoadStatus('papers', 'idle');
      setLoadError('papers', '');
      return () => {};
    }

    setLoadStatus('papers', 'loading');
    setLoadError('papers', '');

    motoCustomerCareService.listPaperworkDocuments({ tenantId: tenant.id, limit })
      .then((paperworkInventory) => {
        if (!active) {
          return;
        }

        setPaperworkDocuments(paperworkInventory.documents || []);
        setPaperworkDocumentMoves(paperworkInventory.moves || []);
        setLoadStatus('papers', 'ready');
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }

        setPaperworkDocuments([]);
        setPaperworkDocumentMoves([]);
        setLoadStatus('papers', 'error');
        setLoadError('papers', nextError?.message || 'تعذر تحميل عمليات الأوراق.');
      });

    return () => {
      active = false;
    };
  }, [enabled, limit, resetData, setLoadError, setLoadStatus, tenant?.id]);

  useEffect(() => {
    if (activeSection === 'papers') {
      return loadPaperwork();
    }
    if (activeSection === 'requests') {
      return loadRequests();
    }

    const cancelSales = loadSales();
    const cancelRequests = loadRequests();
    return () => {
      cancelSales?.();
      cancelRequests?.();
    };
  }, [activeSection, loadPaperwork, loadRequests, loadSales]);

  useEffect(() => loadReports(), [loadReports]);

  const refresh = useCallback(() => {
    loadReports();

    if (activeSection === 'papers') {
      return loadPaperwork();
    }
    if (activeSection === 'requests') {
      return loadRequests(true);
    }

    loadRequests(true);
    return loadSales();
  }, [activeSection, loadPaperwork, loadReports, loadRequests, loadSales]);

  const updatePaperworkRequestLocally = useCallback((requestId, patch) => {
    if (!requestId || !patch) {
      return;
    }

    setPaperworkRequests((current) => current.map((request) => (
      request.id === requestId ? { ...request, ...patch } : request
    )));
  }, []);

  const ensurePaperworkLoaded = useCallback(() => {
    if (sectionStatus.papers === 'ready' || sectionStatus.papers === 'loading') {
      return () => {};
    }

    return loadPaperwork();
  }, [loadPaperwork, sectionStatus.papers]);

  const ensureAllPaperworkRequestsLoaded = useCallback(() => {
    if (!tenant?.id || !enabled || requestsLimitRef.current === null) return () => {};
    let active = true;
    setLoadStatus('requests', 'loading');
    setLoadError('requests', '');
    motoCustomerCareService.listPaperworkRequests({
      tenantId: tenant.id,
      limit: null,
      includeDetails: false,
    }).then((requests) => {
      if (!active) return;
      setPaperworkRequests(requests);
      requestsReadyRef.current = true;
      requestsTenantIdRef.current = tenant.id;
      requestsLimitRef.current = null;
      setLoadStatus('requests', 'ready');
    }).catch((nextError) => {
      if (!active) return;
      setLoadStatus('requests', 'error');
      setLoadError('requests', nextError?.message || 'تعذر تحميل طلبات الأوراق الكاملة.');
    });
    return () => { active = false; };
  }, [enabled, setLoadError, setLoadStatus, tenant?.id]);

  const query = normalizeQuery(search);

  const filteredSales = useMemo(
    () => sales.filter((sale) => matchesSearch(sale, query)),
    [query, sales],
  );

  const summary = useMemo(() => {
    return filteredSales.reduce(
      (accumulator, sale) => {
        accumulator.count += 1;
        accumulator.totalAmount += sale.totalAmount;
        accumulator.paidAmount += sale.paidAmount;
        accumulator.remainingAmount += sale.remainingAmount;

        if (sale.remainingAmount > 0) {
          accumulator.openCount += 1;
        }

        if (sale.status === 'completed' || sale.status === 'confirmed') {
          accumulator.confirmedCount += 1;
        }

        if (sale.status === 'pending') {
          accumulator.pendingCount += 1;
        }

        return accumulator;
      },
      {
        count: 0,
        totalAmount: 0,
        paidAmount: 0,
        remainingAmount: 0,
        openCount: 0,
        confirmedCount: 0,
        pendingCount: 0,
      },
    );
  }, [filteredSales]);

  const loadSectionId = activeSection;
  const currentSectionStatus = sectionStatus[loadSectionId] || 'idle';
  const currentSectionError = sectionError[loadSectionId] || '';

  return {
    tenantId: tenant?.id ?? null,
    sales: filteredSales,
    rawSales: sales,
    paperworkRequests,
    paperworkDocuments,
    paperworkDocumentMoves,
    paperworkReports,
    summary,
    isLoading: currentSectionStatus === 'loading',
    isReportsLoading: reportsStatus === 'loading',
    error: currentSectionError,
    reportsError,
    loadStatus: currentSectionStatus,
    reportsStatus,
    sectionStatus,
    refresh,
    updatePaperworkRequestLocally,
    ensurePaperworkLoaded,
    ensureAllPaperworkRequestsLoaded,
  };
}
