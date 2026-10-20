import { useCallback, useState } from 'react';
import { TrackingUnitSearchField } from '@/shared/products';
import { salesService } from '@/features/sales/services/sales.service';

export function TrackingUnitSelector({ tenantId, branchId, locationId, productId, value, onChange, disabled = false }) {
  const [search, setSearch] = useState('');
  const searchTrackingUnits = useCallback(async ({ search: term, page, pageSize }) => {
    const result = await salesService.searchSaleTrackingUnits({ tenantId, branchId, locationId, productId, search: term, page, pageSize });
    return { ...result, items: result.items.map((unit) => ({
      ...unit,
      identifiers: [
        unit.chassisNumber ? { name: 'الشاسيه', value: unit.chassisNumber } : null,
        unit.engineNumber ? { name: 'الموتور', value: unit.engineNumber } : null,
      ].filter(Boolean),
    })) };
  }, [branchId, locationId, productId, tenantId]);
  if (!locationId) return <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">اختر موقع المخزون أولًا.</p>;
  return <TrackingUnitSearchField
    value={value}
    onChange={onChange}
    searchTrackingUnits={searchTrackingUnits}
    search={search}
    onSearchChange={setSearch}
    enabled={Boolean(branchId && locationId && productId)}
    disabled={disabled}
  />;
}
