import { AlertCircle, ArrowRight, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useAuthorization } from "@/core/authorization/useAuthorization";
import { Button } from "@/core/ui/button";
import { SaleDraftEditor } from "@/features/sales/create/SaleDraftEditor";
import { SaleActions } from "@/features/sales/components/SaleActions";
import { SaleCancellationSummary } from "@/features/sales/components/SaleCancellationSummary";
import { SaleConfirmationDialog } from "@/features/sales/components/SaleConfirmationDialog";
import { SaleExchangesSection, SaleExchangeSourceBanner } from "@/features/sales/components/SaleExchangesSection";
import { SaleHeader } from "@/features/sales/components/SaleHeader";
import { SaleItemsDetails } from "@/features/sales/components/SaleItemsDetails";
import { SalePaymentSummary } from "@/features/sales/components/SalePaymentSummary";
import { SaleReadiness } from "@/features/sales/components/SaleReadiness";
import { SaleReturnsSection } from "@/features/sales/components/SaleReturnsSection";
import { useSaleDetails } from "@/features/sales/hooks/useSaleDetails";
import { useSaleExchangeEligibility } from "@/features/sales/hooks/useSaleExchange";
import { useSaleConfirmation } from "@/features/sales/hooks/useSaleConfirmation";
import { useSaleCancellationEligibility } from "@/features/sales/hooks/useSaleCancellation";
import { useSaleReturnEligibility } from "@/features/sales/hooks/useSaleReturn";
import { useWorkspace } from "@/features/workspace/hooks/useWorkspace";

export function SaleDetails({ saleId, onDetailsStateChange, compact = false }) {
  const saleReference = String(saleId).trim();
  const { tenant } = useWorkspace();
  const { can } = useAuthorization();
  const details = useSaleDetails({
    tenantId: tenant?.id,
    saleId: saleReference,
  });
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionNotice, setActionNotice] = useState("");

  useEffect(() => {
    onDetailsStateChange?.({ status: details.status, sale: details.sale, notice: actionNotice });
  }, [actionNotice, details.sale, details.status, onDetailsStateChange]);
  const cancellationRead = useSaleCancellationEligibility({
    tenantId: tenant?.id,
    saleId: details.sale?.id,
    enabled:
      details.status === "ready" &&
      !details.sale?.isHistorical &&
      details.sale?.commercialStatus === "cancelled",
  });
  const returnRead = useSaleReturnEligibility({
    tenantId: tenant?.id,
    saleId: details.sale?.id,
    enabled:
      details.status === "ready" &&
      !details.sale?.isHistorical &&
      details.sale?.commercialStatus === "confirmed",
  });
  const exchangeRead = useSaleExchangeEligibility({
    tenantId: tenant?.id,
    saleId: details.sale?.id,
    enabled: details.status === "ready" && !details.sale?.isHistorical && Boolean(details.sale?.id),
  });

  const handleConfirmed = useCallback(async () => {
    setConfirmOpen(false);
    setActionNotice("");
    await details.reload();
  }, [details.reload]);

  const handleVersionConflict = useCallback(
    async (message) => {
      setConfirmOpen(false);
      setActionNotice(message);
      await details.reload();
    },
    [details.reload],
  );

  const handleDelivered = useCallback(async () => {
    setActionNotice("");
    await details.reload();
  }, [details.reload]);

  const handleDeliveryVersionConflict = useCallback(
    async (message) => {
      setActionNotice(message);
      await details.reload();
    },
    [details.reload],
  );

  const handleDeliveryRefresh = useCallback(
    async (payload) => {
      if (payload?.message) setActionNotice(payload.message);
      await details.reload();
    },
    [details.reload],
  );

  const handleCancelled = useCallback(async () => {
    setActionNotice("");
    await details.reload();
  }, [details.reload]);

  const handleCancellationVersionConflict = useCallback(
    async (message) => {
      setActionNotice(message);
      await details.reload();
    },
    [details.reload],
  );

  const handleCancellationRefresh = useCallback(
    async (payload) => {
      if (payload?.message) setActionNotice(payload.message);
      await details.reload();
    },
    [details.reload],
  );

  const handleReturned = useCallback(async () => {
    setActionNotice("");
    await details.reload();
    await returnRead.reload();
    await exchangeRead.reload();
  }, [details.reload, exchangeRead.reload, returnRead.reload]);

  const handleReturnVersionConflict = useCallback(
    async (message) => {
      setActionNotice(message);
      await details.reload();
      await returnRead.reload();
      await exchangeRead.reload();
    },
    [details.reload, exchangeRead.reload, returnRead.reload],
  );

  const handleReturnRefresh = useCallback(
    async (payload) => {
      if (payload?.message) setActionNotice(payload.message);
      await details.reload();
      await returnRead.reload();
      await exchangeRead.reload();
    },
    [details.reload, exchangeRead.reload, returnRead.reload],
  );

  const handleExchangeStarted = useCallback(async () => {
    setActionNotice("");
    await details.reload();
    await returnRead.reload();
    await exchangeRead.reload();
  }, [details.reload, exchangeRead.reload, returnRead.reload]);

  const handleExchangeRefresh = useCallback(
    async (payload) => {
      if (payload?.message) setActionNotice(payload.message);
      await details.reload();
      await returnRead.reload();
      await exchangeRead.reload();
    },
    [details.reload, exchangeRead.reload, returnRead.reload],
  );

  const confirmation = useSaleConfirmation({
    tenantId: tenant?.id,
    sale: details.sale,
    readiness: details.readiness,
    refreshReadiness: details.refreshReadiness,
    onConfirmed: handleConfirmed,
    onVersionConflict: handleVersionConflict,
  });

  const finishEditing = async () => {
    setEditing(false);
    await details.reload();
  };

  return (
    <div className={compact ? 'sale-details-compact' : undefined}>
      {details.status === "loading" ? (
        <div role="status" className="space-y-4">
          <div className="h-52 animate-pulse rounded-2xl bg-slate-100" />
          <div className="grid gap-4 md:grid-cols-2">
            <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
            <div className="h-40 animate-pulse rounded-2xl bg-slate-100" />
          </div>
          <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      ) : null}
      {details.status === 'error' ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
          <p className="mt-3 font-black text-red-900">{details.error}</p>
          <Button className="mt-4" variant="secondary" onClick={details.reload}>
            <RefreshCcw className="h-4 w-4" />
            إعادة المحاولة
          </Button>
        </div>
      ) : null}
      {details.status === "ready" && details.sale && editing ? (
        <div className="space-y-4">
          <Button variant="ghost" onClick={() => setEditing(false)}>
            <ArrowRight className="h-4 w-4" />
            العودة إلى التفاصيل
          </Button>
          <SaleDraftEditor
            key={`${details.sale.id}:${details.sale.version}`}
            tenantId={tenant?.id}
            initialSale={details.sale}
            canBackdate={can("sales.backdate")}
            onSaved={finishEditing}
            onReload={details.reload}
          />
        </div>
      ) : null}
      {details.status === "ready" && details.sale && !editing ? (
        <div className="space-y-6">
          <SaleHeader sale={details.sale} embedded={compact} />
          {compact ? (
            <div className="grid items-stretch gap-4 md:grid-cols-2">
              <SaleItemsDetails lines={details.sale.lines} currencyCode={details.sale.currencyCode} compact />
              <SalePaymentSummary sale={details.sale} compact />
            </div>
          ) : null}
          {!details.sale.isHistorical ? <SaleActions
            tenantId={tenant?.id}
            sale={details.sale}
            returnEligibility={returnRead.eligibility}
            exchangeEligibility={exchangeRead.eligibility}
            canEditDraft={can('sales.update_draft')}
            canConfirm={can('sales.confirm')}
            confirmationReady={confirmation.canSubmit}
            confirmationIssue={
              confirmation.payloadIssue ||
              (!details.readiness?.ready
                ? "راجع أسباب عدم جاهزية المسودة."
                : "")
            }
            confirming={confirmation.submitting}
            onEdit={() => {
              setActionNotice("");
              setEditing(true);
            }}
            onConfirm={() => {
              confirmation.clearError();
              setActionNotice("");
              setConfirmOpen(true);
            }}
            onSettled={details.reload}
            onSettlementRefresh={details.reload}
            onDelivered={handleDelivered}
            onDeliveryRefresh={handleDeliveryRefresh}
            onDeliveryVersionConflict={handleDeliveryVersionConflict}
            onReturned={handleReturned}
            onReturnRefresh={handleReturnRefresh}
            onReturnVersionConflict={handleReturnVersionConflict}
            onExchangeStarted={handleExchangeStarted}
            onExchangeRefresh={handleExchangeRefresh}
            onExchangeVersionConflict={handleExchangeRefresh}
            onCancelled={handleCancelled}
            onCancellationRefresh={handleCancellationRefresh}
            onCancellationVersionConflict={handleCancellationVersionConflict}
          /> : null}
          {!details.sale.isHistorical ? <SaleExchangeSourceBanner source={exchangeRead.eligibility?.sourceExchange} /> : null}
          {details.sale.commercialStatus === "cancelled" ? (
            <SaleCancellationSummary
              cancellation={
                cancellationRead.eligibility?.cancellation || {
                  reason: "",
                  cancelledAt: details.sale.cancelledAt,
                  cancelledByName: details.sale.cancelledByName,
                }
              }
            />
          ) : null}
          {!details.sale.isHistorical && returnRead.eligibility ? (
            <SaleReturnsSection
              tenantId={tenant?.id}
              saleId={details.sale.id}
              eligibility={returnRead.eligibility}
              onRefunded={handleReturned}
            />
          ) : null}
          {!details.sale.isHistorical ? <SaleExchangesSection eligibility={exchangeRead.eligibility} /> : null}
          {details.sale.commercialStatus === "draft" ? (
            <SaleReadiness readiness={details.readiness} />
          ) : null}
          {details.sale.notes ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="font-black">ملاحظات</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
                {details.sale.notes}
              </p>
            </section>
          ) : null}
        </div>
      ) : null}
      {!details.sale?.isHistorical ? <SaleConfirmationDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        sale={details.sale}
        readiness={details.readiness}
        confirmation={confirmation}
      /> : null}
    </div>
  );
}
