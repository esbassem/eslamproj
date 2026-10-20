import { PackagePlus } from 'lucide-react';
import { normalizeProductOption } from '@/shared/products/productSelection.model';

const defaultTrackingLabel = (product) => product.productType === 'service' ? 'خدمة' : product.tracking === 'serial' ? 'متتبع' : 'كمية';

export function ProductOption({ product: rawProduct, onSelect, meta, className = '' }) {
  const product = normalizeProductOption(rawProduct);
  return <button type="button" className={`flex w-full items-start gap-3 rounded-lg p-3 text-right hover:bg-slate-50 ${className}`} onClick={() => onSelect?.(rawProduct)}>
    <PackagePlus className="mt-0.5 h-4 w-4 shrink-0 text-violet-600" />
    <span className="min-w-0 flex-1"><b className="block truncate">{product.name || 'منتج بدون اسم'}</b><small className="text-slate-500">{meta ?? `${product.code || 'بدون كود'} · ${defaultTrackingLabel(product)}`}</small></span>
  </button>;
}
