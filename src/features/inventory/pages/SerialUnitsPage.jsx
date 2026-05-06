import { useState } from 'react';
import { Hash } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { useSerialUnits } from '@/features/inventory/hooks/useSerialUnits';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const STATUS_OPTIONS = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'in_stock', label: 'in_stock' },
  { value: 'reserved', label: 'reserved' },
  { value: 'sold', label: 'sold' },
];

export function SerialUnitsPage() {
  const { tenant } = useWorkspace();
  const tenantId = tenant?.id;
  const [filters, setFilters] = useState({ productId: 'all', status: 'all' });
  const { serialUnits, products, isLoading, error } = useSerialUnits(tenantId, filters);

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-950">السيريالات / IMEI</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">متابعة حالة كل وحدة Serial.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={filters.productId} onChange={(value) => setFilters((current) => ({ ...current, productId: value }))}>
            <option value="all">كل المنتجات</option>
            {products.filter((product) => product.tracking === 'serial').map((product) => (
              <option key={product.id} value={product.id}>{product.name}</option>
            ))}
          </Select>
          <Select value={filters.status} onChange={(value) => setFilters((current) => ({ ...current, status: value }))}>
            {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      {isLoading ? (
        <LoadingSpinner title="جاري تحميل السيريالات" />
      ) : serialUnits.length ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[minmax(0,1.3fr)_180px_130px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 max-md:hidden">
            <div>المنتج</div>
            <div>IMEI</div>
            <div>الحالة</div>
          </div>
          <div className="divide-y divide-slate-100">
            {serialUnits.map((unit) => (
              <div key={unit.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.3fr)_180px_130px] md:items-center">
                <div className="truncate text-sm font-extrabold text-slate-950">{unit.product?.name ?? '-'}</div>
                <div className="font-mono text-sm font-bold text-slate-700" dir="ltr">{unit.trackingNumber}</div>
                <div><StatusBadge status={unit.status} /></div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center">
          <Hash className="h-10 w-10 text-slate-300" />
          <h3 className="mt-3 text-lg font-extrabold text-slate-950">لا توجد سيريالات</h3>
        </div>
      )}
    </div>
  );
}

function Select({ value, onChange, children }) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 min-w-44 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-slate-200"
    >
      {children}
    </select>
  );
}

function StatusBadge({ status }) {
  const variant = status === 'in_stock' ? 'success' : status === 'reserved' ? 'warning' : 'default';
  return <Badge variant={variant}>{status}</Badge>;
}
