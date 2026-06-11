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

export function useMotoCustomerCareSales({ search = '', status = 'all', limit = 150, enabled = true } = {}) {
  const { tenant } = useWorkspace();
  const [sales, setSales] = useState([]);
  const [paperworkRequests, setPaperworkRequests] = useState([]);
  const [paperworkDocuments, setPaperworkDocuments] = useState([]);
  const [paperworkDocumentMoves, setPaperworkDocumentMoves] = useState([]);
  const [loadStatus, setLoadStatus] = useState('idle');
  const [error, setError] = useState('');

  const loadSales = useCallback(() => {
    let active = true;

    if (!tenant?.id) {
      setSales([]);
      setPaperworkRequests([]);
      setPaperworkDocuments([]);
      setPaperworkDocumentMoves([]);
      setLoadStatus('idle');
      setError('');
      return () => {};
    }

    if (!enabled) {
      setLoadStatus('idle');
      setError('');
      return () => {};
    }

    setLoadStatus('loading');
    setError('');

    Promise.all([
      motoCustomerCareService.listSales({ tenantId: tenant.id, status, limit }),
      motoCustomerCareService.listPaperworkRequests({ tenantId: tenant.id, limit }),
      motoCustomerCareService.listPaperworkDocuments({ tenantId: tenant.id, limit }),
    ])
      .then(([rows, requests, paperworkInventory]) => {
        if (!active) {
          return;
        }

        setSales(rows);
        setPaperworkRequests(requests);
        setPaperworkDocuments(paperworkInventory.documents || []);
        setPaperworkDocumentMoves(paperworkInventory.moves || []);
        setLoadStatus('ready');
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }

        setSales([]);
        setPaperworkRequests([]);
        setPaperworkDocuments([]);
        setPaperworkDocumentMoves([]);
        setLoadStatus('error');
        setError(nextError?.message || 'تعذر تحميل عمليات المتابعة.');
      });

    return () => {
      active = false;
    };
  }, [enabled, limit, status, tenant?.id]);

  useEffect(() => loadSales(), [loadSales]);

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

  return {
    tenantId: tenant?.id ?? null,
    sales: filteredSales,
    rawSales: sales,
    paperworkRequests,
    paperworkDocuments,
    paperworkDocumentMoves,
    summary,
    isLoading: loadStatus === 'loading',
    error,
    loadStatus,
    refresh: loadSales,
  };
}
