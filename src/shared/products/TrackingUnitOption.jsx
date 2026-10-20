import { normalizeTrackingUnitOption } from '@/shared/products/productSelection.model';

export function TrackingUnitOption({ unit: rawUnit, onSelect }) {
  const unit = normalizeTrackingUnitOption(rawUnit);
  const details = [...unit.identifiers, ...unit.attributes].map((item) => `${item.name || item.label || 'تعريف'}: ${item.value || '-'}`);
  return <button type="button" className="block w-full rounded-lg p-3 text-right hover:bg-slate-50" onClick={() => onSelect?.(rawUnit)}>
    <b className="block" dir="ltr">{unit.trackingNumber || '—'}</b>
    {details.length ? <small className="mt-1 block text-slate-500">{details.join(' · ')}</small> : null}
  </button>;
}
