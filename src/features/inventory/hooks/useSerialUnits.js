import { useCallback, useEffect, useState } from 'react';
import { inventoryService } from '@/features/inventory/api/inventory.api';

export function useSerialUnits(tenantId, filters = {}) {
  const [serialUnits, setSerialUnits] = useState([]);
  const [products, setProducts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!tenantId) {
      setSerialUnits([]);
      setProducts([]);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const [nextUnits, nextProducts] = await Promise.all([
        inventoryService.getSerialUnits({ tenantId, productId: filters.productId, status: filters.status }),
        inventoryService.listProducts(tenantId),
      ]);
      setSerialUnits(nextUnits);
      setProducts(nextProducts);
    } catch (loadError) {
      setError(loadError.message || 'تعذر تحميل السيريالات.');
    } finally {
      setIsLoading(false);
    }
  }, [filters.productId, filters.status, tenantId]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { serialUnits, products, isLoading, error, reload };
}
