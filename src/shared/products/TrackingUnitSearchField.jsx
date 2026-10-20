import { Search } from 'lucide-react';
import { Input } from '@/core/ui/input';
import { TrackingUnitOption } from '@/shared/products/TrackingUnitOption';
import { TrackingUnitSummary } from '@/shared/products/TrackingUnitSummary';
import { useTrackingUnitSearch } from '@/shared/products/useTrackingUnitSearch';

export function TrackingUnitSearchField({ value, onChange, searchTrackingUnits, search, onSearchChange, enabled = true, disabled = false, pageSize = 20, placeholder = 'ابحث برقم التتبع أو أي معرّف', emptyMessage = 'لا توجد وحدة متاحة في هذا الموقع.' }) {
  const state = useTrackingUnitSearch({ searchTrackingUnits, search, enabled, disabled, pageSize });
  if (value) return <TrackingUnitSummary unit={value} disabled={disabled} onClear={() => onChange?.(null)} />;
  return <div className="space-y-2">
    <div className="relative"><Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" /><Input className="pr-10" disabled={disabled || !enabled} value={search} onChange={(event) => onSearchChange?.(event.target.value)} placeholder={placeholder} /></div>
    {state.status === 'loading' ? <p className="text-sm text-slate-500">جاري تحميل الوحدات المتاحة...</p> : null}
    {state.status === 'error' ? <p className="text-sm font-bold text-red-700">{state.error}</p> : null}
    {state.status === 'ready' && !state.items.length ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{emptyMessage}</p> : null}
    {state.items.length ? <div className="max-h-52 overflow-y-auto rounded-xl border border-slate-200 p-1">{state.items.map((unit) => <TrackingUnitOption key={unit.id} unit={unit} onSelect={onChange} />)}{state.hasMore ? <button type="button" disabled={state.status === 'loading-more'} onClick={state.loadMore} className="w-full rounded-lg p-2 text-sm font-bold text-blue-700 disabled:opacity-50">{state.status === 'loading-more' ? 'جاري التحميل...' : 'تحميل المزيد'}</button> : null}</div> : null}
  </div>;
}
