import { lazy, Suspense, useState } from "react";
import { ArrowRight, CheckSquare } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { paperworkReadService } from "@/features/paperwork/services/queries/paperworkRead.service";
import {
  usePaperworkQuery,
  usePaperworkTenant,
} from "@/features/paperwork/hooks/usePaperworkQuery";
import { PaperworkPage } from "@/features/paperwork/shared/PaperworkPage";
import {
  EmptyState,
  PageError,
  PageSkeleton,
  SerialDisplay,
  StatusBadge,
} from "@/features/paperwork/shared/PaperworkUI";
import { PAPERWORK_ROUTES } from "@/features/paperwork/routes/paperworkRoutes";
import { useAuthorization } from "@/core/authorization/useAuthorization";
import { PAPERWORK_PERMISSIONS } from "@/features/paperwork/authorization/paperworkPermissions";

const BulkReceipt = lazy(() =>
  import("@/features/paperwork/processors/BulkReceiptFlow").then((module) => ({
    default: module.BulkReceiptFlow,
  })),
);

export function PaperworkProcessorDetailsPage() {
  const { processorId } = useParams();
  const tenantId = usePaperworkTenant();
  const { can } = useAuthorization();
  const canReceive = can(PAPERWORK_PERMISSIONS.RECEIVE);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const query = usePaperworkQuery(
    () =>
      tenantId
        ? paperworkReadService.listRequestSummaries({
            tenantId,
            processorId,
            pageSize: 100,
          })
        : Promise.resolve(null),
    [tenantId, processorId],
  );
  const processorName = query.data?.items[0]?.processorName || "جهة الإصدار";
  const processor = query.data
    ? {
        id: processorId,
        name: processorName,
        requests: query.data.items.map((item) => ({
          ...item,
          trackingIdentifiers: item.identifiers.map((value) => ({ value })),
        })),
      }
    : null;
  return (
    <PaperworkPage
      title={processorName}
      description="الطلبات الموجودة حاليًا لدى هذه الجهة."
      actions={
        <>
          <Link
            to={PAPERWORK_ROUTES.processors}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black"
          >
            <ArrowRight className="h-4 w-4" />
            رجوع
          </Link>
          {canReceive ? <button
            type="button"
            disabled={!query.data?.items.length}
            onClick={() => setReceiptOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-black text-white disabled:opacity-40"
          >
            <CheckSquare className="h-4 w-4" />
            استلام أوراق
          </button> : null}
        </>
      }
    >
      {query.loading ? (
        <PageSkeleton />
      ) : query.error ? (
        <PageError message={query.error} onRetry={query.retry} />
      ) : !query.data.items.length ? (
        <EmptyState title="لا توجد طلبات حالية لدى هذه الجهة." />
      ) : (
        <div className="space-y-3">
          {query.data.items.map((item) => (
            <Link
              key={item.id}
              to={PAPERWORK_ROUTES.requestDetails(item.id)}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <div className="font-black">{item.customerName}</div>
                <div className="text-sm font-bold text-slate-600">
                  {item.productName}
                </div>
                <SerialDisplay
                  trackingNumber={item.trackingNumber}
                  identifiers={item.identifiers}
                />
              </div>
              <StatusBadge label={item.stageLabel} status={item.currentStage} />
            </Link>
          ))}
        </div>
      )}
      {canReceive && receiptOpen ? (
        <Suspense fallback={null}>
          <BulkReceipt
            processor={processor}
            open={receiptOpen}
            onOpenChange={setReceiptOpen}
            tenantId={tenantId}
            onReceived={() => void query.retry()}
          />
        </Suspense>
      ) : null}
    </PaperworkPage>
  );
}
