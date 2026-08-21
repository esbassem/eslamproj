import { useEffect, useMemo, useState } from 'react';
import { motoCustomerCareService } from '@/features/moto-customer-care/services/motoCustomerCare.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function useMotoCustomerCareSales({ search = '', status = 'all', limit = 250, enabled = true } = {}) {
  const { tenant } = useWorkspace();
  const [sales, setSales] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!tenant?.id || !enabled) return () => { active = false; };
    setIsLoading(true);
    setError('');
    motoCustomerCareService.listSales({ tenantId: tenant.id, status, limit, includeAttachments: false })
      .then((rows) => { if (active) setSales(rows || []); })
      .catch((nextError) => { if (active) { setSales([]); setError(nextError?.message || 'تعذر تحميل المبيعات.'); } })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, [enabled, limit, status, tenant?.id]);

  const filteredSales = useMemo(() => {
    const query = String(search || '').trim().toLowerCase();
    if (!query) return sales;
    return sales.filter((sale) => [sale.customer?.name, sale.customer?.phone, sale.saleDate, sale.notes]
      .filter(Boolean).join(' ').toLowerCase().includes(query));
  }, [sales, search]);
  const summary = useMemo(() => filteredSales.reduce((result, sale) => ({
    ...result,
    count: result.count + 1,
    totalAmount: result.totalAmount + Number(sale.totalAmount || 0),
    paidAmount: result.paidAmount + Number(sale.paidAmount || 0),
    remainingAmount: result.remainingAmount + Number(sale.remainingAmount || 0),
    openCount: result.openCount + (Number(sale.remainingAmount || 0) > 0 ? 1 : 0),
    confirmedCount: result.confirmedCount + (['confirmed', 'completed'].includes(sale.status) ? 1 : 0),
    pendingCount: result.pendingCount + (sale.status === 'pending' ? 1 : 0),
  }), { count: 0, totalAmount: 0, paidAmount: 0, remainingAmount: 0, openCount: 0, confirmedCount: 0, pendingCount: 0 }), [filteredSales]);

  return { sales: filteredSales, summary, isLoading, error };
}
