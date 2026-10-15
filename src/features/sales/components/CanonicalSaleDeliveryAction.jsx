import { useCallback, useEffect, useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { Button } from '@/core/ui/button';
import { SaleDeliveryDialog } from '@/features/sales/components/SaleDeliveryDialog';
import { salesService } from '@/features/sales/services/sales.service';
import { getSaleDeliveryReasonMessage, isSaleDeliveryFinancialOnlyBlocked } from '@/features/sales/services/salesDelivery.model';

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
  const [eligibility, setEligibility] = useState({ saleId: '', options: null });
  const canDeliver = can(SALE_DELIVERY_PERMISSION);
  const isCandidate = sale?.commercialStatus === 'confirmed'
    && sale.fulfillment?.status !== 'delivered'
    && sale.fulfillment?.status !== 'not_required'
    && Number(sale.fulfillment?.remainingQuantity || 0) > 0;

  useEffect(() => {
    let active = true;
    if (!tenantId || !sale?.id || !isCandidate || isLoading || !canDeliver) {
      setEligibility({ saleId: '', options: null });
      return () => { active = false; };
    }
    setEligibility({ saleId: sale.id, options: null });
    salesService.getSaleDeliveryEligibility({ tenantId, saleId: sale.id })
      .then((options) => { if (active) setEligibility({ saleId: sale.id, options }); })
      .catch(() => { if (active) setEligibility({ saleId: sale.id, options: null }); });
    return () => { active = false; };
  }, [canDeliver, isCandidate, isLoading, sale?.id, tenantId]);

  const handleDelivered = useCallback(async (payload) => {
    if (payload?.eligibility) setEligibility({ saleId: sale.id, options: payload.eligibility });
    await onDelivered?.(payload);
  }, [onDelivered, sale.id]);

  const handleTargetRefresh = useCallback(async (payload) => {
    if (payload?.eligibility) setEligibility({ saleId: sale.id, options: payload.eligibility });
    await onRefreshRequested?.(payload);
  }, [onRefreshRequested, sale.id]);

  const handleVersionConflict = useCallback(async (payload) => {
    if (payload?.eligibility) setEligibility({ saleId: sale.id, options: payload.eligibility });
    setOpen(false);
    await onVersionConflict?.(payload.message);
  }, [onVersionConflict, sale.id]);

  const currentEligibility = eligibility.saleId === sale?.id ? eligibility.options : null;
  const financialOnlyBlock = isSaleDeliveryFinancialOnlyBlocked(currentEligibility ?? {});
  const actionReady = currentEligibility?.eligible === true
    || (financialOnlyBlock && currentEligibility?.canOverrideFinancialBlock === true);
  if (!tenantId || !sale?.id || !isCandidate || isLoading || !canDeliver) return null;

  return (
    <>
      {actionReady ? <Button type="button" variant="secondary" onClick={() => setOpen(true)}><PackageCheck className="h-4 w-4" />تسليم</Button> : null}
      {currentEligibility && !actionReady && !open ? <span role="alert" className="text-xs font-bold text-amber-800">{getSaleDeliveryReasonMessage(currentEligibility.blockingReasons?.[0])}</span> : null}
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
