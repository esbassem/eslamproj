import { Package, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { TrackingUnitSelector } from '@/features/sales/create/TrackingUnitSelector';
import { salesService } from '@/features/sales/services/sales.service';
import { draftLineTotal } from '@/features/sales/services/salesDraft.model';

function QuantityAvailability({ tenantId, branchId, locationId, line, disabled }) {
  const [state, setState] = useState({ status: 'idle', data: null });
  useEffect(() => {
    const quantity = Number(line.quantity);
    if (disabled || !branchId || !locationId || !line.product.id || !Number.isFinite(quantity) || quantity <= 0) {
      setState({ status: 'idle', data: null }); return undefined;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      setState({ status: 'loading', data: null });
      salesService.getSaleQuantityAvailability({ tenantId, branchId, locationId, productId: line.product.id, quantity })
        .then((data) => { if (active) setState({ status: 'ready', data }); })
        .catch(() => { if (active) setState({ status: 'error', data: null }); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [branchId, disabled, line.product.id, line.quantity, locationId, tenantId]);
  if (state.status === 'loading') return <small className="text-slate-500">جاري التحقق من المتاح...</small>;
  if (state.status === 'error') return <small className="text-amber-700">تعذر قراءة المتاح الآن؛ سيعاد التحقق عند التأكيد.</small>;
  if (!state.data) return null;
  return <small className={state.data.isAvailable ? 'text-emerald-700' : 'text-amber-700'}>المتاح حاليًا: {state.data.availableQuantity.toLocaleString('ar-EG')} — لا يتم الحجز أثناء المسودة.</small>;
}

export function SaleItemRow({ tenantId, branchId, locationId, line, index, disabled, onChange, onRemove }) {
  const isService = line.product.productType === 'service';
  const isSerial = !isService && line.product.tracking === 'serial';
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-700"><Package className="h-4 w-4" /></span><div className="min-w-0"><h3 className="truncate font-black text-slate-950">{line.product.name}</h3><p className="text-xs text-slate-500">بند {index + 1} · {line.product.sku || 'بدون كود'} · {isService ? 'خدمة' : isSerial ? 'متتبع بالسيريال' : 'منتج كمي'}</p></div></div>
        {!disabled ? <Button aria-label={`حذف ${line.product.name}`} type="button" size="icon" variant="ghost" onClick={onRemove}><Trash2 className="h-4 w-4 text-red-600" /></Button> : null}
      </header>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <label className="text-sm font-bold text-slate-700">الوصف<Input className="mt-1" disabled={disabled} maxLength={500} value={line.description} onChange={(event) => onChange({ description: event.target.value })} /></label>
        <label className="text-sm font-bold text-slate-700">سعر الوحدة<Input className="mt-1 text-left" dir="ltr" disabled={disabled} min="0" step="0.01" inputMode="decimal" type="number" value={line.unitPrice} onChange={(event) => onChange({ unitPrice: event.target.value })} /></label>
        <label className="text-sm font-bold text-slate-700">الكمية<Input className="mt-1 text-left" dir="ltr" disabled={disabled || isSerial} min="0.0001" step={isSerial ? '1' : '0.0001'} inputMode="decimal" type="number" value={line.quantity} onChange={(event) => onChange({ quantity: event.target.value })} /></label>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">إجمالي البند</p><p className="mt-1 text-lg font-black">{draftLineTotal(line).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} {line.product.currencyCode || 'EGP'}</p></div>
      </div>
      {!isService ? <div className="mt-4 border-t border-slate-100 pt-4">{isSerial ? <><p className="mb-2 text-sm font-black">القطعة الفعلية</p><TrackingUnitSelector tenantId={tenantId} branchId={branchId} locationId={locationId} productId={line.product.id} value={line.trackingUnit} disabled={disabled} onChange={(trackingUnit) => onChange({ trackingUnit })} /></> : <QuantityAvailability tenantId={tenantId} branchId={branchId} locationId={locationId} line={line} disabled={disabled} />}</div> : <p className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">هذا البند خدمة ولا يتطلب مخزونًا.</p>}
    </article>
  );
}
