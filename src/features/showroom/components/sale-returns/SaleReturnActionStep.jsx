export function SaleReturnActionStep({ rows, onChange }) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.line.id} className="rounded-xl border p-3">
          <p className="mb-2 font-black">{row.line.description || row.line.displayName}</p>
          <div className="flex gap-2">
            {[
              ['return', 'استرجاع فقط'],
              ['exchange', 'استبدال بقطعة أخرى'],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                onClick={() => onChange(row.line.id, value)}
                className={`rounded-lg border px-3 py-2 text-xs font-black ${row.action === value ? 'border-blue-600 bg-blue-50 text-blue-700' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
          {!row.line.trackingUnitId ? (
            <input
              type="number"
              min="0.01"
              max={row.line.availableQuantity}
              value={row.quantity}
              onChange={(event) => onChange(row.line.id, row.action, Number(event.target.value))}
              className="mt-2 h-9 w-32 rounded-lg border px-2"
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
