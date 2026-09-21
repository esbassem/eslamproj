import { Search, UserRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { salesService } from '@/features/sales/services/sales.service';

export function SaleCustomerSelector({ tenantId, value, onChange, disabled = false }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    const term = search.trim();
    if (disabled || value || term.length < 2) { setResults([]); setStatus('idle'); return undefined; }
    let active = true;
    const timer = window.setTimeout(() => {
      setStatus('loading'); setError('');
      salesService.searchSaleCustomers({ tenantId, search: term })
        .then((data) => { if (active) { setResults(data.items); setStatus('ready'); } })
        .catch((nextError) => { if (active) { setError(nextError.message); setStatus('error'); } });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [disabled, search, tenantId, value]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <div className="min-w-0"><p className="truncate font-black">{value.name}</p>{value.phone ? <p dir="ltr" className="text-right text-xs text-slate-500">{value.phone}</p> : null}</div>
        {!disabled ? <Button aria-label="تغيير العميل" size="icon" type="button" variant="ghost" onClick={() => { onChange(null); setSearch(''); }}><X className="h-4 w-4" /></Button> : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
      <Input disabled={disabled} className="pr-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="اكتب اسم العميل أو الهاتف" />
      {search.trim().length > 0 && search.trim().length < 2 ? <p className="mt-1 text-xs text-slate-500">اكتب حرفين على الأقل.</p> : null}
      {status !== 'idle' ? (
        <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {status === 'loading' ? <p className="p-3 text-sm text-slate-500">جاري البحث عن العملاء...</p> : null}
          {status === 'error' ? <p className="p-3 text-sm font-bold text-red-700">{error}</p> : null}
          {status === 'ready' && !results.length ? <p className="p-3 text-sm text-slate-500">لا يوجد عميل مطابق.</p> : null}
          {results.map((customer) => (
            <button key={customer.id} type="button" className="flex w-full items-center gap-3 rounded-lg p-3 text-right hover:bg-slate-50" onClick={() => { onChange(customer); setSearch(''); setResults([]); }}>
              <UserRound className="h-4 w-4 shrink-0 text-slate-400" /><span className="min-w-0"><b className="block truncate">{customer.name}</b>{customer.phone ? <small dir="ltr" className="block text-right text-slate-500">{customer.phone}</small> : null}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
