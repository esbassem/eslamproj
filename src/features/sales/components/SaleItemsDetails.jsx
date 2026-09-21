import { Package } from 'lucide-react';
import { SaleStatusBadge } from '@/features/sales/components/SaleStatusBadge';

const money = (value, currency) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency}`;

function CompactSaleItems({ lines, currencyCode }) {
  return (
    <section
      className="flex min-h-56 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white"
      aria-labelledby="sale-invoice-items"
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-300 bg-slate-50 px-4 py-3">
        <h2 id="sale-invoice-items" className="text-[13px] font-bold text-slate-950">بنود الفاتورة</h2>
        <span className="text-[10px] font-semibold text-slate-400">{lines.length.toLocaleString('ar-EG')} بند</span>
      </header>

      <div className="sales-invoice-scrollbar min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto px-4">
        {lines.length ? lines.map((line) => (
          <article key={line.id || line.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3">
            <div className="min-w-0">
              <h3 className="truncate text-xs font-semibold text-slate-800">{line.product.name || line.description || 'بند غير محدد'}</h3>
              <p className="mt-1 truncate text-[10px] font-medium text-slate-500">
                {Number(line.quantity || 0).toLocaleString('ar-EG')} × {money(line.unitPrice, currencyCode)}
                {line.product.sku ? ` · ${line.product.sku}` : ''}
              </p>
            </div>
            <strong className="shrink-0 whitespace-nowrap text-xs font-bold tabular-nums text-slate-950">
              {money(line.lineTotal, currencyCode)}
            </strong>
          </article>
        )) : (
          <p className="py-10 text-center text-xs font-medium text-slate-400">لا تحتوي الفاتورة على بنود حتى الآن.</p>
        )}
      </div>
    </section>
  );
}

export function SaleItemsDetails({ lines, currencyCode, compact = false }) {
  if (compact) return <CompactSaleItems lines={lines} currencyCode={currencyCode} />;

  return (
    <section className="space-y-3" aria-labelledby="sale-details-items">
      <div>
        <h2 id="sale-details-items" className="text-lg font-black">بنود البيع</h2>
        <p className="mt-1 text-sm text-slate-500">البيانات التجارية وحالة التنفيذ لكل بند.</p>
      </div>
      {!lines.length ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-7 text-center text-sm font-bold text-slate-500">
          لا تحتوي المسودة على بنود حتى الآن.
        </div>
      ) : (
        <div className="space-y-3">
          {lines.map((line, index) => (
            <article key={line.id || line.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-4">
              <header className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><Package className="h-4 w-4" /></span>
                  <div className="min-w-0"><h3 className="font-black text-slate-950">{line.product.name}</h3><p className="text-xs text-slate-500">بند {index + 1}{line.product.sku ? ` · ${line.product.sku}` : ''}</p></div>
                </div>
                <SaleStatusBadge status={line.inventory.status} />
              </header>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[['الكمية', Number(line.quantity)], ['سعر الوحدة', money(line.unitPrice, currencyCode)], ['إجمالي البند', money(line.lineTotal, currencyCode)]].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 font-black">{typeof value === 'number' ? value.toLocaleString('ar-EG') : value}</p></div>
                ))}
              </div>
              {line.description && line.description !== line.product.name ? <p className="mt-3 text-sm text-slate-600">{line.description}</p> : null}
              {line.inventory.kind === 'quantity' ? <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold text-slate-600"><span>محجوز: {line.inventory.reservedQuantity.toLocaleString('ar-EG')}</span><span>مُسلّم: {line.inventory.deliveredQuantity.toLocaleString('ar-EG')}</span><span>متبقٍ: {line.inventory.remainingQuantity.toLocaleString('ar-EG')}</span></div> : null}
              {line.inventory.kind === 'serial' ? <div className="mt-4 space-y-2">{line.inventory.trackingUnits.map((unit) => <div key={unit.id} className="rounded-xl border border-violet-100 bg-violet-50/60 p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black">شاسيه: <span dir="ltr">{unit.chassisNumber}</span></p>{unit.engineNumber ? <p className="mt-1 text-sm text-violet-900">موتور: <span dir="ltr">{unit.engineNumber}</span></p> : null}</div><SaleStatusBadge status={unit.state} /></div>{unit.attributes.length ? <p className="mt-2 text-xs text-violet-800">{unit.attributes.map((item) => `${item.name}: ${item.value}`).join('، ')}</p> : null}</div>)}{!line.inventory.trackingUnits.length ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">لم تُحدد قطعة فعلية لهذا البند.</p> : null}</div> : null}
              {line.inventory.kind === 'service' ? <p className="mt-3 text-xs font-bold text-blue-700">خدمة — لا تتطلب مخزونًا.</p> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
