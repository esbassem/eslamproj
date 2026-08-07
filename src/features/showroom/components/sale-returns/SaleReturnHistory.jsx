import { useState } from 'react';

export function SaleReturnHistory({ operations = [], status = 'idle', error = '', onLoad }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = () => {
    const next = !expanded; setExpanded(next);
    if (next && status === 'idle') onLoad?.();
  };
  return (
    <section className="border-t p-4">
      <button type="button" onClick={toggle} className="flex w-full items-center justify-between rounded-xl border px-3 py-2 text-sm font-black">
        <span>المرتجعات والاستبدالات</span><span>{expanded ? 'إخفاء' : 'عرض'}</span>
      </button>
      {expanded && <div className="mt-3 space-y-2">
        {status === 'loading' && <p className="text-xs text-slate-500">جاري تحميل التاريخ...</p>}
        {status === 'error' && <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">عدم توافق Schema المرتجعات: {error}</p>}
        {status === 'ready' && !operations.length && <p className="text-xs text-slate-500">لا توجد عمليات.</p>}
        {operations.map((operation) => <article key={operation.id} className="rounded-xl border p-3 text-xs"><p className="font-black">{operation.operation_type === 'return' ? 'مرتجع' : operation.operation_type === 'exchange' ? 'استبدال' : 'مرتجع واستبدال'} · {operation.status}</p><p>{operation.showroom_sale_return_lines?.length || 0} سطر · إشعار دائن {operation.credit_note_move_id?.slice(0, 8) || '—'} · فاتورة بديلة {operation.replacement_invoice_move_id?.slice(0, 8) || '—'}</p><p>المرتجع {operation.total_return_amount} · البديل {operation.total_replacement_amount} · الفرق {operation.price_difference}</p></article>)}
      </div>}
    </section>
  );
}
