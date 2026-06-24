import { useCallback, useEffect, useMemo, useState } from 'react';
import { motoCustomerCareService } from '@/features/moto-customer-care/services/motoCustomerCare.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

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

export function useMotoCustomerCareSales({ search = '', status = 'all', limit = 150, enabled = true, activeSection = 'sales' } = {}) {
  const { tenant } = useWorkspace();
  const [sales, setSales] = useState([]);
  const [paperworkRequests, setPaperworkRequests] = useState([]);
  const [paperworkDocuments, setPaperworkDocuments] = useState([]);
  const [paperworkDocumentMoves, setPaperworkDocumentMoves] = useState([]);
  const [paperworkReports, setPaperworkReports] = useState({ missing: 0, vault: 0, sentPendingReceipt: 0 });
  const [reportsStatus, setReportsStatus] = useState('idle');
  const [reportsError, setReportsError] = useState('');
  const [sectionStatus, setSectionStatus] = useState({ sales: 'idle', papers: 'idle' });
  const [sectionError, setSectionError] = useState({ sales: '', papers: '' });

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
    setPaperworkReports({ missing: 0, vault: 0, sentPendingReceipt: 0 });
    setReportsStatus('idle');
    setReportsError('');
    setSectionStatus({ sales: 'idle', papers: 'idle' });
    setSectionError({ sales: '', papers: '' });
  }, []);

  const loadReports = useCallback(() => {
    let active = true;

    if (!tenant?.id) {
      setPaperworkReports({ missing: 0, vault: 0, sentPendingReceipt: 0 });
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

        setPaperworkReports(reports || { missing: 0, vault: 0, sentPendingReceipt: 0 });
        setReportsStatus('ready');
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }

        setPaperworkReports({ missing: 0, vault: 0, sentPendingReceipt: 0 });
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

    Promise.all([
      motoCustomerCareService.listSales({ tenantId: tenant.id, status, limit, includeAttachments: false }),
      motoCustomerCareService.listPaperworkRequests({ tenantId: tenant.id, limit }),
    ])
      .then(([rows, requests]) => {
        if (!active) {
          return;
        }

        setSales(rows);
        setPaperworkRequests(requests);
        setLoadStatus('sales', 'ready');
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }

        setSales([]);
        setPaperworkRequests([]);
        setLoadStatus('sales', 'error');
        setLoadError('sales', nextError?.message || 'تعذر تحميل عمليات المبيعات.');
      });

    return () => {
      active = false;
    };
  }, [enabled, limit, resetData, setLoadError, setLoadStatus, status, tenant?.id]);

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

    return loadSales();
  }, [activeSection, loadPaperwork, loadSales]);

  useEffect(() => loadReports(), [loadReports]);

  const refresh = useCallback(() => {
    loadReports();

    if (activeSection === 'papers') {
      return loadPaperwork();
    }

    return loadSales();
  }, [activeSection, loadPaperwork, loadReports, loadSales]);

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

  const loadSectionId = activeSection === 'requests' ? 'sales' : activeSection;
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
  };
}
