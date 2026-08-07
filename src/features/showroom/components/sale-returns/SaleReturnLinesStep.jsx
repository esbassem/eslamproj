const identifier = (line, pattern) =>
  line.identifiers?.find((item) => pattern.test(`${item.code} ${item.label}`))?.value || '—';

export function SaleReturnLinesStep({ lines, selected, onToggle, onAll }) {
  return (
    <div className="space-y-3">
      <button type="button" onClick={onAll} className="rounded-lg border px-3 py-2 text-xs font-black">
        تحديد الكل القابل للإرجاع
      </button>
      {lines.map((line) => (
        <label
          key={line.id}
          className={`block rounded-xl border p-3 ${line.blockedReason ? 'bg-slate-50 opacity-70' : 'cursor-pointer'}`}
        >
          <div className="flex gap-3">
            <input
              type="checkbox"
              disabled={Boolean(line.blockedReason)}
              checked={selected.has(line.id)}
              onChange={() => onToggle(line.id)}
            />
            <div>
              <p className="font-black">{line.description || line.displayName}</p>
              <p className="text-xs text-slate-500">
                شاسيه {identifier(line, /chassis|شاسيه/i)} · موتور{' '}
                {identifier(line, /engine|motor|موتور|محرك/i)}
              </p>
              <p className="text-xs">
                الأصلية {line.originalQuantity} · سبق ردها {line.returnedQuantity} · المتاح{' '}
                {line.availableQuantity} · سعر الوحدة{' '}
                {Number(line.unit_price || line.unitPrice || 0).toFixed(2)}
              </p>
              <p className="text-xs">الأوراق: {line.paperworkRequest?.current_stage || 'لا يوجد طلب'}</p>
              {line.blockedReason ? <p className="mt-1 text-xs font-bold text-red-600">{line.blockedReason}</p> : null}
            </div>
          </div>
        </label>
      ))}
    </div>
  );
}
