import { useCallback, useEffect, useState } from 'react';
import { inventoryService } from '@/features/inventory/api/inventory.api';

export function useStock(tenantId) {
  const [stock, setStock] = useState([]);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!tenantId) {
      setStock([]);
      setProducts([]);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const [nextStock, nextProducts] = await Promise.all([
        inventoryService.getStock({ tenantId }),
        inventoryService.listProducts(tenantId),
      ]);
      setStock(nextStock);
      setProducts(nextProducts);
    } catch (loadError) {
      setError(loadError.message || 'تعذر تحميل المخزون.');
    } finally {
      setIsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { stock, products, isLoading, error, reload };
}
