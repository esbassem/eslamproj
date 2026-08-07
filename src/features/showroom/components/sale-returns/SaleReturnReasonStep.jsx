import { SALE_RETURN_REASONS } from '@/features/showroom/constants/saleReturn.constants';

export function SaleReturnReasonStep({ code, reason, onCode, onReason }) {
  return (
    <div className="space-y-3">
      <select value={code} onChange={(event) => onCode(event.target.value)} className="h-10 w-full rounded-xl border px-3">
        <option value="">اختر السبب</option>
        {SALE_RETURN_REASONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <textarea
        value={reason}
        onChange={(event) => onReason(event.target.value)}
        placeholder="شرح السبب (إجباري)"
        className="min-h-24 w-full rounded-xl border p-3"
      />
    </div>
  );
}
