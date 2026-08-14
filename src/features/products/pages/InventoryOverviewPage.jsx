import { useEffect, useState } from 'react';
import { Boxes, History, MapPin, Package, ShieldCheck, ShoppingCart } from 'lucide-react';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { inventoryService } from '@/features/inventory/api/inventory.api';
import { productsService } from '@/features/products/api/products.api';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const STATUS_CARDS = [
  { key: 'in_stock', label: 'القطع المتاحة', icon: ShieldCheck, tone: 'text-emerald-700 bg-emerald-50' },
  { key: 'reserved', label: 'القطع المحجوزة', icon: Boxes, tone: 'text-amber-700 bg-amber-50' },
  { key: 'sold', label: 'القطع المباعة', icon: ShoppingCart, tone: 'text-blue-700 bg-blue-50' },
];

export function InventoryOverviewPage() {
  const { tenant } = useWorkspace();
  const tenantId = tenant?.id;
  const [state, setState] = useState({ loading: true, error: '', products: 0, units: [], moves: [] });

  useEffect(() => {
    let mounted = true;
    if (!tenantId) return undefined;
    setState((current) => ({ ...current, loading: true, error: '' }));
    Promise.all([
      productsService.listProducts(tenantId),
      inventoryService.getSerialUnits({ tenantId }),
      inventoryService.getStockMoves({ tenantId }),
    ]).then(([products, units, moves]) => {
      if (mounted) setState({ loading: false, error: '', products: products.length, units, moves: moves.slice(0, 6) });
    }).catch((error) => {
      if (mounted) setState((current) => ({ ...current, loading: false, error: error.message || 'تعذر تحميل نظرة المخزون.' }));
    });
    return () => { mounted = false; };
  }, [tenantId]);

  if (state.loading) return <LoadingSpinner title="جاري تحميل نظرة المخزون" />;
  const counts = state.units.reduce((result, unit) => ({ ...result, [unit.status]: (result[unit.status] || 0) + 1 }), {});

  return (
    <div className="space-y-6" dir="rtl">
      <header>
        <h1 className="text-2xl font-black text-slate-950">نظرة عامة على المخزون</h1>
        <p className="mt-1 text-sm font-semibold text-slate-500">ملخص المنتجات والقطع الفريدة وأحدث الحركات المسجلة.</p>
      </header>
      {state.error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{state.error}</div> : null}
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="إجمالي المنتجات" value={state.products} icon={Package} tone="text-slate-700 bg-slate-100" />
        <Metric label="إجمالي القطع الفريدة" value={state.units.length} icon={Boxes} tone="text-indigo-700 bg-indigo-50" />
        {STATUS_CARDS.slice(0, 2).map((card) => <Metric key={card.key} {...card} value={counts[card.key] || 0} />)}
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric {...STATUS_CARDS[2]} value={counts.sold || 0} />
        <Metric label="المواقع" value="غير مفعّل" icon={MapPin} tone="text-slate-500 bg-slate-100" compact />
        <Metric label="الحركات المسجلة" value={state.moves.length ? 'آخر 6' : 0} icon={History} tone="text-violet-700 bg-violet-50" compact />
      </section>
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-4"><h2 className="font-black text-slate-950">آخر حركات المخزون</h2></div>
        {state.moves.length ? <div className="divide-y divide-slate-100">{state.moves.map((move) => (
          <div key={move.id} className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[100px_minmax(0,1fr)_100px_170px]">
            <span className="font-black text-slate-700">{move.moveType}</span><span className="truncate font-bold">{move.product?.name || '-'}</span>
            <span>{move.quantity}</span><span className="text-slate-500">{new Date(move.createdAt).toLocaleString('ar-EG')}</span>
          </div>
        ))}</div> : <p className="px-4 py-12 text-center text-sm font-bold text-slate-500">لا توجد حركات مسجلة بعد.</p>}
      </section>
    </div>
  );
}

function Metric({ label, value, icon: Icon, tone, compact = false }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div><p className="mt-3 text-xs font-bold text-slate-500">{label}</p><p className={`${compact ? 'text-xl' : 'text-3xl'} mt-1 font-black text-slate-950`}>{value}</p></div>;
}
