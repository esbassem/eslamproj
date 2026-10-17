import { useCallback, useEffect, useState } from 'react';
import { inventoryService } from '@/features/inventory/api/inventory.api';

const EMPTY_RESULT = { items: [], total: 0, page: 1, pageSize: 25 };

export function useStock(tenantId, filters = {}) {
  const [stock, setStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState(EMPTY_RESULT);
  const [isLoading, setIsLoading] = useState(false);
  const [isProductsLoading, setIsProductsLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!tenantId) {
      setStock([]);
      setPagination(EMPTY_RESULT);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const result = await inventoryService.listStockBalances(filters);
      setStock(result.items);
      setPagination(result);
    } catch (loadError) {
      setStock([]);
      setPagination(EMPTY_RESULT);
      setError(loadError.message || 'تعذر تحميل المخزون.');
    } finally {
      setIsLoading(false);
    }
  }, [filters.branchId, filters.categoryId, filters.locationId, filters.page, filters.pageSize, filters.search, tenantId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let mounted = true;
    if (!tenantId) {
      setProducts([]);
      return undefined;
    }
    setIsProductsLoading(true);
    inventoryService.listProducts(tenantId)
      .then((nextProducts) => { if (mounted) setProducts(nextProducts); })
      .catch(() => { if (mounted) setProducts([]); })
      .finally(() => { if (mounted) setIsProductsLoading(false); });
    return () => { mounted = false; };
  }, [tenantId]);

  return { stock, products, pagination, isLoading, isProductsLoading, error, reload };
}
