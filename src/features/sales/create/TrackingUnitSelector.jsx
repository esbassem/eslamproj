import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/core/ui/input';
import { salesService } from '@/features/sales/services/sales.service';

export function TrackingUnitSelector({ tenantId, branchId, locationId, productId, value, onChange, disabled = false }) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    if (disabled || !branchId || !locationId || !productId) { setItems([]); setStatus('idle'); return undefined; }
    let active = true;
    const timer = window.setTimeout(() => {
      setStatus('loading'); setError('');
      salesService.searchSaleTrackingUnits({ tenantId, branchId, locationId, productId, search })
        .then((data) => { if (active) { setItems(data.items); setStatus('ready'); } })
        .catch((nextError) => { if (active) { setError(nextError.message); setStatus('error'); } });
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [branchId, disabled, locationId, productId, search, tenantId]);

  if (value) {
    return (
      <button type="button" disabled={disabled} onClick={() => onChange(null)} className="w-full rounded-xl border border-violet-200 bg-violet-50 p-3 text-right disabled:cursor-default">
        <b className="block">شاسيه: <span dir="ltr">{value.chassisNumber || value.trackingNumber}</span></b>
        <small className="text-violet-800">{value.engineNumber ? `موتور: ${value.engineNumber}` : 'اضغط لتغيير القطعة'}</small>
      </button>
    );
  }

  if (!locationId) return <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">اختر موقع المخزون أولًا.</p>;

  return (
    <div className="space-y-2">
      <div className="relative"><Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" /><Input className="pr-10" disabled={disabled} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالشاسيه أو الموتور" /></div>
      {status === 'loading' ? <p className="text-sm text-slate-500">جاري تحميل القطع المتاحة...</p> : null}
      {status === 'error' ? <p className="text-sm font-bold text-red-700">{error}</p> : null}
      {status === 'ready' && !items.length ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">لا توجد قطعة متاحة في هذا الموقع.</p> : null}
      {items.length ? <div className="max-h-44 overflow-y-auto rounded-xl border border-slate-200 p-1">{items.map((unit) => <button key={unit.id} type="button" className="block w-full rounded-lg p-3 text-right hover:bg-slate-50" onClick={() => onChange(unit)}><b className="block">شاسيه: <span dir="ltr">{unit.chassisNumber}</span></b><small className="text-slate-500">{unit.engineNumber ? `موتور: ${unit.engineNumber}` : unit.trackingNumber}</small>{unit.attributes.length ? <span className="mt-1 block text-xs text-slate-400">{unit.attributes.map((item) => `${item.name}: ${item.value}`).join('، ')}</span> : null}</button>)}</div> : null}
    </div>
  );
}
