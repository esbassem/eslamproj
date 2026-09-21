import { ProductSelector } from '@/features/sales/create/ProductSelector';
import { SaleItemRow } from '@/features/sales/create/SaleItemRow';

export function SaleItemsSection({ tenantId, branchId, locationId, lines, disabled, onAdd, onUpdate, onRemove }) {
  return (
    <section className="space-y-4" aria-labelledby="sale-items-title">
      <div><h2 id="sale-items-title" className="text-lg font-black">بنود البيع</h2><p className="mt-1 text-sm text-slate-500">ابحث عن المنتج ثم أضفه. السعر الافتراضي يأتي من كتالوج المنتجات ويمكن تعديله.</p></div>
      {!disabled ? <ProductSelector tenantId={tenantId} onSelect={onAdd} /> : null}
      {!lines.length ? <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm font-bold text-slate-500">لم تتم إضافة بنود بعد.</div> : <div className="space-y-3">{lines.map((line, index) => <SaleItemRow key={line.key} tenantId={tenantId} branchId={branchId} locationId={locationId} line={line} index={index} disabled={disabled} onChange={(changes) => onUpdate(line.key, changes)} onRemove={() => onRemove(line.key)} />)}</div>}
    </section>
  );
}
