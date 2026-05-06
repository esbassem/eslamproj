import { useEffect, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { inventoryService } from '@/features/inventory/api/inventory.api';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function StockMovesPage() {
  const { tenant } = useWorkspace();
  const tenantId = tenant?.id;
  const [moves, setMoves] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    if (!tenantId) return undefined;

    setIsLoading(true);
    setError('');

    inventoryService
      .getStockMoves({ tenantId })
      .then((nextMoves) => {
        if (mounted) setMoves(nextMoves);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message || 'تعذر تحميل حركات المخزون.');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [tenantId]);

  return (
    <div className="space-y-5" dir="rtl">
      <div className="border-b border-slate-200 pb-5">
        <h2 className="text-2xl font-extrabold text-slate-950">حركات المخزون</h2>
        <p className="mt-1 text-sm font-semibold text-slate-500">كل دخول وخروج وتسوية يتم تسجيلها هنا.</p>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      {isLoading ? (
        <LoadingSpinner title="جاري تحميل حركات المخزون" />
      ) : moves.length ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[110px_minmax(0,1.2fr)_110px_180px_150px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 max-lg:hidden">
            <div>النوع</div>
            <div>المنتج</div>
            <div>الكمية</div>
            <div>التاريخ</div>
            <div>المستخدم</div>
          </div>
          <div className="divide-y divide-slate-100">
            {moves.map((move) => (
              <div key={move.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[110px_minmax(0,1.2fr)_110px_180px_150px] lg:items-center">
                <div><MoveBadge moveType={move.moveType} /></div>
                <div className="min-w-0">
                  <div className="truncate text-sm font-extrabold text-slate-950">{move.product?.name ?? '-'}</div>
                  {move.notes ? <div className="mt-1 truncate text-xs font-semibold text-slate-500">{move.notes}</div> : null}
                </div>
                <div className="text-sm font-bold text-[#17324d]">{move.quantity}</div>
                <div className="text-sm text-slate-600">{formatDate(move.createdAt)}</div>
                <div className="truncate text-sm text-slate-600">{move.userName ?? '-'}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center">
          <ArrowDownToLine className="h-10 w-10 text-slate-300" />
          <h3 className="mt-3 text-lg font-extrabold text-slate-950">لا توجد حركات بعد</h3>
        </div>
      )}
    </div>
  );
}

function MoveBadge({ moveType }) {
  const variant = moveType === 'in' ? 'success' : moveType === 'inventory' ? 'warning' : 'default';
  return <Badge variant={variant}>{moveType}</Badge>;
}
