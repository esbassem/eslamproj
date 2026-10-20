import { normalizeTrackingUnitOption } from '@/shared/products/productSelection.model';

export function TrackingUnitSummary({ unit: rawUnit, onClear, disabled = false }) {
  const unit = normalizeTrackingUnitOption(rawUnit);
  const details = [...unit.identifiers, ...unit.attributes].map((item) => `${item.name || item.label || 'تعريف'}: ${item.value || '-'}`);
  return <button type="button" disabled={disabled || !onClear} onClick={onClear} className="w-full rounded-xl border border-violet-200 bg-violet-50 p-3 text-right disabled:cursor-default">
    <b className="block" dir="ltr">{unit.trackingNumber || '—'}</b>
    <small className="text-violet-800">{details.length ? details.join(' · ') : onClear ? 'اضغط لتغيير الوحدة' : 'وحدة متتبعة'}</small>
  </button>;
}
