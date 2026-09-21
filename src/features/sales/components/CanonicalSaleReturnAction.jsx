import { useCallback, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { Button } from '@/core/ui/button';
import { SaleReturnDialog } from '@/features/sales/components/SaleReturnDialog';

export function CanonicalSaleReturnAction({ tenantId, sale, eligibility, onReturned, onRefreshRequested, onVersionConflict }) {
  const { can, isLoading } = useAuthorization(); const [open, setOpen] = useState(false);
  const handleReturned = useCallback(async (payload) => { await onReturned?.(payload); }, [onReturned]);
  if (!tenantId || !sale?.id || sale.commercialStatus !== 'confirmed' || isLoading || !can('sales.return') || (!eligibility?.canReturn && !open)) return null;
  return <><Button type="button" variant="secondary" className="border-orange-200 text-orange-700 hover:bg-orange-50" onClick={() => setOpen(true)}><RotateCcw className="h-4 w-4" />مرتجع</Button><SaleReturnDialog open={open} onOpenChange={setOpen} tenantId={tenantId} sale={sale} initialEligibility={eligibility} onReturned={handleReturned} onTargetRefresh={onRefreshRequested} onVersionConflict={onVersionConflict} /></>;
}
