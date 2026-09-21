import { useCallback, useState } from 'react';
import { Repeat2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { Button } from '@/core/ui/button';
import { SaleExchangeDialog } from '@/features/sales/components/SaleExchangeDialog';

export function CanonicalSaleExchangeAction({ tenantId, sale, eligibility, onStarted, onRefreshRequested, onVersionConflict }) {
  const { can, isLoading } = useAuthorization();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const handleStarted = useCallback(async (result) => {
    setOpen(false);
    await onStarted?.(result);
    navigate(`/app/sales/${result.replacementSaleId}`);
  }, [navigate, onStarted]);
  if (!tenantId || !sale?.id || sale.commercialStatus !== 'confirmed'
      || isLoading || !can('sales.exchange') || (!eligibility?.canExchange && !open)) return null;
  return <><Button type="button" variant="secondary" className="border-violet-200 text-violet-700 hover:bg-violet-50" onClick={() => setOpen(true)}><Repeat2 className="h-4 w-4" />استبدال</Button><SaleExchangeDialog open={open} onOpenChange={setOpen} tenantId={tenantId} sale={sale} initialEligibility={eligibility} onStarted={handleStarted} onTargetRefresh={onRefreshRequested} onVersionConflict={onVersionConflict} /></>;
}
