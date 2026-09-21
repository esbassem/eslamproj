import { useCallback, useEffect, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { Button } from '@/core/ui/button';
import { SaleDeliveryDialog } from '@/features/sales/components/SaleDeliveryDialog';
import { salesService } from '@/features/sales/services/sales.service';

export const SALE_DELIVERY_PERMISSION = 'sales.deliver';

export function CanonicalSaleDeliveryAction({
  tenantId,
  sale,
  onDelivered,
  onRefreshRequested,
  onVersionConflict,
}) {
  const { can, isLoading } = useAuthorization();
  const [open, setOpen] = useState(false);
  const [eligibility, setEligibility] = useState({ saleId: '', canDeliver: false });
  const canDeliver = can(SALE_DELIVERY_PERMISSION);
  const isCandidate = sale?.commercialStatus === 'confirmed'
    && sale.fulfillment?.status !== 'delivered'
    && sale.fulfillment?.status !== 'not_required'
    && Number(sale.fulfillment?.remainingQuantity || 0) > 0;

  useEffect(() => {
    let active = true;
    if (!tenantId || !sale?.id || !isCandidate || isLoading || !canDeliver) {
      setEligibility({ saleId: '', canDeliver: false });
      return () => { active = false; };
    }
    setEligibility({ saleId: sale.id, canDeliver: false });
    salesService.getSaleDeliveryEligibility({ tenantId, saleId: sale.id })
      .then((options) => { if (active) setEligibility({ saleId: sale.id, canDeliver: options.eligible }); })
      .catch(() => { if (active) setEligibility({ saleId: sale.id, canDeliver: false }); });
    return () => { active = false; };
  }, [canDeliver, isCandidate, isLoading, sale?.id, tenantId]);

  const handleDelivered = useCallback(async (payload) => {
    if (payload?.eligibility) setEligibility({ saleId: sale.id, canDeliver: payload.eligibility.eligible });
    await onDelivered?.(payload);
  }, [onDelivered, sale.id]);

  const handleTargetRefresh = useCallback(async (payload) => {
    if (payload?.eligibility) setEligibility({ saleId: sale.id, canDeliver: payload.eligibility.eligible });
    await onRefreshRequested?.(payload);
  }, [onRefreshRequested, sale.id]);

  const handleVersionConflict = useCallback(async (payload) => {
    if (payload?.eligibility) setEligibility({ saleId: sale.id, canDeliver: payload.eligibility.eligible });
    setOpen(false);
    await onVersionConflict?.(payload.message);
  }, [onVersionConflict, sale.id]);

  const actionReady = eligibility.saleId === sale?.id && eligibility.canDeliver;
  if (!tenantId || !sale?.id || !isCandidate || isLoading || !canDeliver || (!actionReady && !open)) return null;

  return (
    <>
      {actionReady ? <Button type="button" variant="secondary" onClick={() => setOpen(true)}><PackageCheck className="h-4 w-4" />تسليم</Button> : null}
      <SaleDeliveryDialog
        open={open}
        onOpenChange={setOpen}
        tenantId={tenantId}
        sale={sale}
        onDelivered={handleDelivered}
        onTargetRefresh={handleTargetRefresh}
        onVersionConflict={handleVersionConflict}
      />
    </>
  );
}
