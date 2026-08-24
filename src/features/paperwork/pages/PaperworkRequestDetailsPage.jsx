import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { paperworkService } from "@/features/paperwork/services/paperwork.service";
import { RequestActions } from "@/features/paperwork/requests/RequestActions";
import {
  usePaperworkQuery,
  usePaperworkTenant,
} from "@/features/paperwork/hooks/usePaperworkQuery";
import { PaperworkDetailPage } from "@/features/paperwork/shared/PaperworkDetailPage";
import {
  DetailSection,
  EmptyState,
  PageError,
  PageSkeleton,
  SerialDisplay,
  StatusBadge,
} from "@/features/paperwork/shared/PaperworkUI";
import {
  RequestActivityTab,
  RequestDocumentsTab,
  DeliveryBalanceSummary,
} from "@/features/paperwork/requests/RequestDetailsTabs";
import { PAPERWORK_ROUTES } from "@/features/paperwork/routes/paperworkRoutes";
import { resolvePaperworkReturnContext } from "@/features/paperwork/routes/paperworkNavigation";

const tabs = [
  { id: "overview", label: "نظرة عامة" },
  { id: "documents", label: "المستندات" },
  { id: "activity", label: "النشاط" },
];
const row = (label, value) => (
  <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
    <span className="text-sm font-bold text-slate-500">{label}</span>
    <span className="text-left text-sm font-black text-slate-900">
      {value || "—"}
    </span>
  </div>
);

export function PaperworkRequestDetailsPage() {
  const { requestId } = useParams();
  const tenantId = usePaperworkTenant();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const tab = tabs.some((item) => item.id === requestedTab) ? requestedTab : "overview";
  const returnContext = resolvePaperworkReturnContext(location, PAPERWORK_ROUTES.requests, "الطلبات");
  const query = usePaperworkQuery(
    () =>
      tenantId
        ? paperworkService.getPaperworkRequestDetails({ tenantId, requestId })
        : Promise.resolve(null),
    [tenantId, requestId],
  );
  const request = query.data;
  return (
    <PaperworkDetailPage
      title={
        request
          ? `طلب #${request.id.slice(0, 8).toUpperCase()}`
          : "تفاصيل الطلب"
      }
      returnContext={returnContext}
      actions={request ? (
            <RequestActions
              request={request}
              tenantId={tenantId}
              onChanged={query.retry}
            />
          ) : null}
    >
      {query.loading ? (
        <PageSkeleton />
      ) : query.error ? (
        <PageError message={query.error} onRetry={query.retry} />
      ) : !request ? (
        <EmptyState title="الطلب غير موجود." />
      ) : (
        <>
          <section className="mb-5 rounded-2xl bg-slate-950 p-5 text-white">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge
                label={request.stage?.name || request.currentStage}
                status={request.currentStage}
              />
              <span className="text-sm font-bold text-slate-300">
                {request.customer?.name || "عميل غير محدد"}
              </span>
            </div>
            <h1 className="mt-4 text-xl font-black">{request.productName}</h1>
            <div className="mt-2">
              <SerialDisplay
                trackingNumber={request.trackingUnit?.trackingNumber}
                identifiers={(request.trackingIdentifiers || []).map(
                  (item) => item.value,
                )}
              />
            </div>
            <p className="mt-3 text-sm font-bold text-slate-300">
              جهة الإصدار: {request.processor?.name || "غير محددة"}
            </p>
          </section>
          <div
            className="mb-5 flex gap-2 border-b border-slate-200"
            role="tablist"
          >
            {tabs.map((item) => (
              <button
                key={item.id}
                role="tab"
                aria-selected={tab === item.id}
                onClick={() => setParams((current) => {
                  item.id === "overview" ? current.delete("tab") : current.set("tab", item.id);
                  return current;
                }, { state: location.state })}
                className={`border-b-2 px-4 py-3 text-sm font-black ${tab === item.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
          {tab === "overview" ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <DetailSection title="بيانات العميل">
                {row("العميل", request.customer?.name)}
                {row("الهاتف", request.customer?.phone)}
                {row(
                  "صاحب الورق",
                  request.documentOwnerName || request.documentOwner?.name,
                )}
                {row("الرقم القومي", request.documentOwnerNationalId)}
              </DetailSection>
              <DetailSection title="بيانات الطلب">
                {row("القطعة", request.productName)}
                {row("جهة الإصدار", request.processor?.name)}
                {row("الحالة الحالية", request.stage?.name)}
                {row(
                  "آخر تحديث",
                  request.updatedAt
                    ? new Date(request.updatedAt).toLocaleString("ar-EG")
                    : "",
                )}
                <div className="mt-4">
                  <DeliveryBalanceSummary
                    tenantId={tenantId}
                    saleId={request.saleId}
                  />
                </div>
              </DetailSection>
            </div>
          ) : tab === "documents" ? (
            <RequestDocumentsTab
              tenantId={tenantId}
              requestId={request.id}
              returnLabel={`الطلب #${request.id.slice(0, 8).toUpperCase()}`}
            />
          ) : (
            <RequestActivityTab tenantId={tenantId} requestId={request.id} />
          )}
        </>
      )}
    </PaperworkDetailPage>
  );
}
