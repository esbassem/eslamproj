export function SaleTotals({ lines, total, currencyCode }) {
  return (
    <aside className="rounded-2xl bg-slate-950 p-5 text-white" aria-label="ملخص المسودة">
      <div className="flex items-center justify-between gap-4"><div><p className="text-sm font-bold text-slate-300">عدد البنود</p><p className="mt-1 text-2xl font-black">{lines.length}</p></div><div className="text-left"><p className="text-sm font-bold text-slate-300">الإجمالي</p><p className="mt-1 text-2xl font-black">{total.toLocaleString('ar-EG', { maximumFractionDigits: 2 })} {currencyCode}</p></div></div>
      <p className="mt-3 border-t border-white/10 pt-3 text-xs text-slate-400">الإجمالي المعروض للمراجعة؛ الخادم يعيد حسابه ويحفظه كقيمة authoritative.</p>
    </aside>
  );
}
