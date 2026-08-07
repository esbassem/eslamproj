export function SaleReturnReviewStep({ sale, rows, preview }) {
  const previewLines = new Map((preview?.lines || []).map((line) => [line.sale_line_id, line]));
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-xl bg-slate-50 p-3">
        <p className="font-black">الفاتورة الأصلية · {sale.customer?.name || sale.customerName || ''}</p>
        <p>الإجمالي {Number(sale.total_amount || sale.totalAmount || 0).toFixed(2)}</p>
      </div>
      {rows.map((row) => {
        const serverLine = previewLines.get(row.line.id);
        return <div key={row.line.id} className="rounded-xl border p-3"><p className="font-black">{row.line.description || row.line.displayName}</p><p>{row.action === 'exchange' ? 'استبدال' : 'استرجاع'} · كمية {row.quantity} · قيمة الخادم {Number(serverLine?.return_amount || 0).toFixed(2)}</p><p>الأوراق: {serverLine?.paperwork_effect || 'none'}</p></div>;
      })}
      <div className="rounded-xl bg-blue-50 p-3 font-black">
        <p>إجمالي الإشعار الدائن: {Number(preview?.total_return_amount || 0).toFixed(2)}</p>
        <p>إجمالي الفاتورة البديلة: {Number(preview?.total_replacement_amount || 0).toFixed(2)}</p>
        <p>الفرق النهائي: {Number(preview?.price_difference || 0).toFixed(2)}</p>
      </div>
    </div>
  );
}
