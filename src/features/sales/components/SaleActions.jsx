import { CheckCircle2, Pencil } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { CanonicalSaleSettlementAction } from '@/features/settlement';
import { CanonicalSaleCancellationAction } from '@/features/sales/components/CanonicalSaleCancellationAction';
import { CanonicalSaleDeliveryAction } from '@/features/sales/components/CanonicalSaleDeliveryAction';
import { CanonicalSaleExchangeAction } from '@/features/sales/components/CanonicalSaleExchangeAction';
import { CanonicalSaleReturnAction } from '@/features/sales/components/CanonicalSaleReturnAction';

export function SaleActions({ tenantId, sale, returnEligibility, exchangeEligibility, canEditDraft, canConfirm, confirmationReady, confirmationIssue, confirming, onEdit, onConfirm, onSettled, onSettlementRefresh, onDelivered, onDeliveryRefresh, onDeliveryVersionConflict, onReturned, onReturnRefresh, onReturnVersionConflict, onExchangeStarted, onExchangeRefresh, onExchangeVersionConflict, onCancelled, onCancellationRefresh, onCancellationVersionConflict }) {
  if (sale.commercialStatus === 'draft') {
    if (confirming || (!canEditDraft && !canConfirm)) return null;
    return <div className="flex flex-wrap justify-end gap-2">{canEditDraft ? <Button variant="secondary" onClick={onEdit}><Pencil className="h-4 w-4" />تعديل المسودة</Button> : null}{canConfirm ? <Button onClick={onConfirm} disabled={!confirmationReady} title={confirmationIssue || undefined}><CheckCircle2 className="h-4 w-4" />تأكيد البيع</Button> : null}</div>;
  }

  if (sale.commercialStatus !== 'confirmed') return null;
  return <div className="flex flex-wrap justify-end gap-2">{Number(sale.payment?.outstandingAmount || 0) > 0 ? <CanonicalSaleSettlementAction saleId={sale.id} label="تحصيل" onSettled={onSettled} onRefreshRequested={onSettlementRefresh} /> : null}<CanonicalSaleDeliveryAction tenantId={tenantId} sale={sale} onDelivered={onDelivered} onRefreshRequested={onDeliveryRefresh} onVersionConflict={onDeliveryVersionConflict} /><CanonicalSaleReturnAction tenantId={tenantId} sale={sale} eligibility={returnEligibility} onReturned={onReturned} onRefreshRequested={onReturnRefresh} onVersionConflict={onReturnVersionConflict} /><CanonicalSaleExchangeAction tenantId={tenantId} sale={sale} eligibility={exchangeEligibility} onStarted={onExchangeStarted} onRefreshRequested={onExchangeRefresh} onVersionConflict={onExchangeVersionConflict} /><CanonicalSaleCancellationAction tenantId={tenantId} sale={sale} onCancelled={onCancelled} onRefreshRequested={onCancellationRefresh} onVersionConflict={onCancellationVersionConflict} /></div>;
}
