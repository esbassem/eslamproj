import { Search } from 'lucide-react';
import { Input } from '@/core/ui/input';
import { ProductOption } from '@/shared/products/ProductOption';
import { usePagedProductSearch } from '@/shared/products/usePagedProductSearch';

export function ProductSearchField({ searchProducts, search, onSearchChange, onSelect, disabled = false, minSearchLength = 0, pageSize = 20, placeholder = 'ابحث عن منتج', renderOption, emptyMessage = 'لا توجد منتجات مطابقة.', className = '' }) {
  const state = usePagedProductSearch({ searchProducts, search, disabled, minSearchLength, pageSize });
  const showResults = !disabled && String(search || '').trim().length >= minSearchLength;
  return <div className={`relative ${className}`}>
    <Search className="pointer-events-none absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
    <Input disabled={disabled} className="pr-10" value={search} onChange={(event) => onSearchChange?.(event.target.value)} placeholder={placeholder} />
    {showResults ? <div className="mt-1 max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      {state.status === 'loading' ? <p className="p-3 text-sm text-slate-500">جاري تحميل المنتجات...</p> : null}
      {state.status === 'error' ? <p className="p-3 text-sm font-bold text-red-700">{state.error}</p> : null}
      {state.status === 'ready' && !state.items.length ? <p className="p-3 text-sm text-slate-500">{emptyMessage}</p> : null}
      {state.items.map((product) => renderOption ? renderOption(product, () => onSelect?.(product)) : <ProductOption key={product.id} product={product} onSelect={onSelect} />)}
      {state.hasMore ? <button type="button" disabled={state.status === 'loading-more'} onClick={state.loadMore} className="w-full rounded-lg p-2 text-sm font-bold text-blue-700 disabled:opacity-50">{state.status === 'loading-more' ? 'جاري التحميل...' : 'تحميل المزيد'}</button> : null}
    </div> : null}
  </div>;
}
