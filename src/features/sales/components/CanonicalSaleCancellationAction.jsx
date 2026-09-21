import { useCallback, useState } from 'react';
import { Ban } from 'lucide-react';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { Button } from '@/core/ui/button';
import { SaleCancellationDialog } from '@/features/sales/components/SaleCancellationDialog';
import { useSaleCancellationEligibility } from '@/features/sales/hooks/useSaleCancellation';

export const SALE_CANCELLATION_PERMISSION = 'sales.cancel';

export function CanonicalSaleCancellationAction({ tenantId, sale, onCancelled, onRefreshRequested, onVersionConflict }) {
  const { can, isLoading } = useAuthorization();
  const [open, setOpen] = useState(false);
  const permitted = can(SALE_CANCELLATION_PERMISSION);
  const candidate = sale?.commercialStatus === 'confirmed';
  const readiness = useSaleCancellationEligibility({
    tenantId,
    saleId: sale?.id,
    enabled: Boolean(tenantId && sale?.id && candidate && permitted && !isLoading),
  });

  const handleCancelled = useCallback(async (result) => {
    await onCancelled?.(result);
  }, [onCancelled]);
  const handleRefresh = useCallback(async (payload) => {
    await readiness.reload();
    await onRefreshRequested?.(payload);
  }, [onRefreshRequested, readiness.reload]);

  if (!tenantId || !sale?.id || !candidate || isLoading || !permitted) return null;
  if (readiness.status === 'ready' && !readiness.eligibility?.canCancel) {
    return <p className="max-w-sm rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-950">{readiness.eligibility?.reasonMessage}</p>;
  }
  if (readiness.status !== 'ready' || !readiness.eligibility?.canCancel) return null;

  return <><Button type="button" variant="secondary" className="border-red-200 text-red-700 hover:bg-red-50" onClick={() => setOpen(true)}><Ban className="h-4 w-4" />إلغاء البيع</Button><SaleCancellationDialog open={open} onOpenChange={setOpen} tenantId={tenantId} sale={sale} initialEligibility={readiness.eligibility} onCancelled={handleCancelled} onTargetRefresh={handleRefresh} onVersionConflict={onVersionConflict} /></>;
}
