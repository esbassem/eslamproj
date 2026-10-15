import { useState } from 'react';
import { ArrowLeftRight, Layers, Plus } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { AddStockDialog } from '@/features/inventory/components/AddStockDialog';
import { TransferInventoryDialog } from '@/features/inventory/components/TransferInventoryDialog';
import { canShowReceivingAction } from '@/features/inventory/receivingUi.model';
import { useStock } from '@/features/inventory/hooks/useStock';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function StockListPage() {
  const { tenant, tenantUser } = useWorkspace();
  const { can, isReady: authorizationReady } = useAuthorization();
  const tenantId = tenant?.id;
  const { stock, products, isLoading, error, reload } = useStock(tenantId);
  const [addOpen, setAddOpen] = useState(false);
  const [transferItem, setTransferItem] = useState(null);
  const [receivingNotice, setReceivingNotice] = useState('');
  const canReceive = canShowReceivingAction({
    authorizationReady,
    canReceive: can('inventory.receive'),
  });
  const canTransfer = authorizationReady && can('inventory.transfer');

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-extrabold text-slate-950">رصيد المخزون</h2>
          <p className="mt-1 text-sm font-semibold text-slate-500">كمية المنتجات والوحدات المتاحة للبيع.</p>
        </div>
        {canReceive ? (
          <Button type="button" onClick={() => { setReceivingNotice(''); setAddOpen(true); }} className="gap-2 rounded-lg bg-[#17324d] hover:opacity-95">
            <Plus className="h-4 w-4" />
            إضافة مخزون
          </Button>
        ) : null}
      </div>

      {error ? <Alert>{error}</Alert> : null}
      {receivingNotice ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{receivingNotice}</div> : null}

      {isLoading ? (
        <LoadingSpinner title="جاري تحميل المخزون" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[minmax(0,1.5fr)_130px_150px_220px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 max-lg:hidden">
            <div>المنتج</div>
            <div>نوع التتبع</div>
            <div>المتاح</div>
            <div className="text-left">إجراء</div>
          </div>
          <div className="divide-y divide-slate-100">
            {stock.map((item) => (
              <div key={item.product.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.5fr)_130px_150px_220px] lg:items-center">
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-slate-950">{item.product.displayName || item.product.name}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{item.product.code || item.product.barcode || 'بدون كود'}</div>
                </div>
                <div><Badge variant={item.product.tracking === 'serial' ? 'accent' : 'default'}>{item.product.tracking === 'serial' ? 'Serial' : 'Quantity'}</Badge></div>
                <div className="text-sm font-extrabold text-[#17324d]">
                  {item.product.tracking === 'serial' ? item.availableSerials : item.quantity}
                </div>
                {canTransfer ? <div className="flex gap-2 lg:justify-self-end">
                  <Button type="button" size="sm" className="gap-2 rounded-lg" onClick={() => setTransferItem(item)}>
                    <ArrowLeftRight className="h-4 w-4" />نقل
                  </Button>
                </div> : <div />}
              </div>
            ))}
            {!stock.length ? <EmptyState /> : null}
          </div>
        </div>
      )}

      {canReceive ? (
        <AddStockDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          tenantId={tenantId}
          userId={tenantUser?.id}
          products={products}
          onSaved={async (result) => {
            setReceivingNotice(result?.documentationNotice || `تم الاستلام بنجاح${result?.line_count ? ` (${result.line_count} وحدة/بند)` : ''}.`);
            await reload();
          }}
        />
      ) : null}
      {canTransfer ? <TransferInventoryDialog open={Boolean(transferItem)} onOpenChange={(nextOpen) => { if (!nextOpen) setTransferItem(null); }} tenantId={tenantId} item={transferItem} onSaved={reload} /> : null}
    </div>
  );
}

function Alert({ children }) {
  return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{children}</div>;
}

function EmptyState() {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-4 text-center">
      <Layers className="h-10 w-10 text-slate-300" />
      <h3 className="mt-3 text-lg font-extrabold text-slate-950">لا يوجد مخزون بعد</h3>
      <p className="mt-1 text-sm font-semibold text-slate-500">ابدأ بإضافة مخزون لأول منتج.</p>
    </div>
  );
}
