import { StockListPage } from '@/features/inventory/pages/StockListPage';

export function InventoryDashboard() {
  return (
    <div className="relative min-h-[calc(100vh-4rem)]" dir="rtl">
      <section className="relative min-h-[calc(100vh-4rem)] overflow-hidden rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <StockListPage />
      </section>
    </div>
  );
}
