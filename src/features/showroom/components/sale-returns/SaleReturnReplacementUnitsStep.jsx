export function SaleReturnReplacementUnitsStep({ rows, candidates, search, onSearch, onChange }) {
  const used = new Set(rows.map((row) => row.newTrackingUnitId).filter(Boolean));
  return (
    <div className="space-y-3">
      <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="ابحث برقم التتبع" className="h-10 w-full rounded-xl border px-3" />
      <p className="text-[10px] font-bold text-slate-500">تظهر أول 50 نتيجة مرتبة. ضيّق البحث للوصول إلى قطعة أخرى.</p>
      {rows.filter((row) => row.action === 'exchange').map((row) => (
        <label key={row.line.id} className="block rounded-xl border p-3">
          <span className="mb-2 block text-sm font-black">بديل: {row.line.description || row.line.displayName}</span>
          <select value={row.newTrackingUnitId || ''} onChange={(event) => onChange(row.line.id, event.target.value)} className="h-10 w-full rounded-lg border px-2">
            <option value="">اختر القطعة البديلة</option>
            {candidates.filter((unit) => !used.has(unit.id) || unit.id === row.newTrackingUnitId).map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.product?.display_name} · {unit.tracking_number} · {Number(unit.product?.sale_price || 0).toFixed(2)}</option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
