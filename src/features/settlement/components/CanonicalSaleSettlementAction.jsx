import { useCallback, useEffect, useState } from 'react';
import { Banknote } from 'lucide-react';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { Button } from '@/core/ui/button';
import { settlementService } from '../services/settlement.service';
import { SettlementDialog } from './SettlementDialog';

export const SETTLEMENT_PERMISSIONS = Object.freeze({
  VIEW: 'settlement.view',
  COLLECT: 'settlement.collect',
});

export function CanonicalSaleSettlementAction({ saleId, onSettled, onRefreshRequested, label = 'تحصيل مستحق', className }) {
  const { can, isLoading } = useAuthorization();
  const [open, setOpen] = useState(false);
  const [eligibility, setEligibility] = useState({ saleId: '', canSettle: false });
  const canUseSettlement = can(SETTLEMENT_PERMISSIONS.VIEW) && can(SETTLEMENT_PERMISSIONS.COLLECT);

  useEffect(() => {
    let active = true;
    if (!saleId || isLoading || !canUseSettlement) {
      setEligibility({ saleId: '', canSettle: false });
      return () => { active = false; };
    }
    setEligibility({ saleId, canSettle: false });
    settlementService.getSettlementOptions({ targetType: 'sale', targetId: saleId })
      .then((options) => { if (active) setEligibility({ saleId, canSettle: options.canSettle }); })
      .catch(() => { if (active) setEligibility({ saleId, canSettle: false }); });
    return () => { active = false; };
  }, [canUseSettlement, isLoading, saleId]);

  const handleSettled = useCallback(async (payload) => {
    if (payload?.options) setEligibility({ saleId, canSettle: payload.options.canSettle });
    await onSettled?.(payload);
  }, [onSettled, saleId]);

  const handleTargetRefresh = useCallback(async (payload) => {
    if (payload?.options) setEligibility({ saleId, canSettle: payload.options.canSettle });
    await onRefreshRequested?.(payload);
  }, [onRefreshRequested, saleId]);

  if (!saleId || isLoading || !canUseSettlement || eligibility.saleId !== saleId || !eligibility.canSettle) return null;

  return (
    <>
      <Button type="button" className={className} onClick={() => setOpen(true)}>
        <Banknote className="h-4 w-4" aria-hidden="true" />
        {label}
      </Button>
      <SettlementDialog
        open={open}
        onOpenChange={setOpen}
        targetType="sale"
        targetId={saleId}
        onSettled={handleSettled}
        onTargetRefresh={handleTargetRefresh}
      />
    </>
  );
}
