import { normalizeProductOption } from '@/shared/products/productSelection.model';

export function ProductSummary({ product: rawProduct, onClear, disabled = false }) {
  const product = normalizeProductOption(rawProduct);
  if (!product.id) return null;
  return <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
    <span className="min-w-0"><b className="block truncate">{product.name}</b><small className="text-slate-500">{product.code || 'بدون كود'}</small></span>
    {onClear ? <button type="button" disabled={disabled} onClick={onClear} className="shrink-0 text-xs font-extrabold text-blue-700 disabled:opacity-50">تغيير</button> : null}
  </div>;
}
