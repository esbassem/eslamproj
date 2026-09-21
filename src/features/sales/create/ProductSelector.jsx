import { PackagePlus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/core/ui/input';
import { salesService } from '@/features/sales/services/sales.service';

const trackingLabel = (product) => product.productType === 'service' ? 'خدمة' : product.tracking === 'serial' ? 'قطعة متسلسلة' : 'منتج كمي';

export function ProductSelector({ tenantId, onSelect, disabled = false }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    const term = search.trim();
    if (disabled || term.length < 2) { setResults([]); setStatus('idle'); return undefined; }
    let active = true;
    const timer = window.setTimeout(() => {
      setStatus('loading'); setError('');
      salesService.searchSaleProducts({ tenantId, search: term })
        .then((data) => { if (active) { setResults(data.items); setStatus('ready'); } })
        .catch((nextError) => { if (active) { setError(nextError.message); setStatus('error'); } });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [disabled, search, tenantId]);

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
      <Input disabled={disabled} className="pr-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المنتج أو SKU لإضافة بند" />
      {status !== 'idle' ? (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {status === 'loading' ? <p className="p-3 text-sm text-slate-500">جاري البحث عن المنتجات...</p> : null}
          {status === 'error' ? <p className="p-3 text-sm font-bold text-red-700">{error}</p> : null}
          {status === 'ready' && !results.length ? <p className="p-3 text-sm text-slate-500">لا يوجد منتج قابل للبيع مطابق.</p> : null}
          {results.map((product) => (
            <button key={product.id} type="button" className="flex w-full items-start gap-3 rounded-lg p-3 text-right hover:bg-slate-50" onClick={() => { onSelect(product); setSearch(''); setResults([]); setStatus('idle'); }}>
              <PackagePlus className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
              <span className="min-w-0 flex-1"><b className="block truncate">{product.name}</b><small className="text-slate-500">{product.sku || 'بدون كود'} · {trackingLabel(product)} · {product.salePrice.toLocaleString('ar-EG')} EGP</small></span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
