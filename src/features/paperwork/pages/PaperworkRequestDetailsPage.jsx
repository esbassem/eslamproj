import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { paperworkService } from "@/features/paperwork/services/paperwork.service";
import { RequestActions } from "@/features/paperwork/requests/RequestActions";
import { useAuth } from "@/features/auth/hooks/useAuth";
import {
  usePaperworkQuery,
  usePaperworkTenant,
} from "@/features/paperwork/hooks/usePaperworkQuery";
import { PaperworkPage } from "@/features/paperwork/shared/PaperworkPage";
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
  const { tenant_user: tenantUser } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState("overview");
  const query = usePaperworkQuery(
    () =>
      tenantId
        ? paperworkService.getPaperworkRequestDetails({ tenantId, requestId })
        : Promise.resolve(null),
    [tenantId, requestId],
  );
  const request = query.data;
  return (
    <PaperworkPage
      title={
        request
          ? `طلب #${request.id.slice(0, 8).toUpperCase()}`
          : "تفاصيل الطلب"
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => navigate(PAPERWORK_ROUTES.requests)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-black"
          >
            <ArrowRight className="h-4 w-4" />
            رجوع
          </button>
          {request ? (
            <RequestActions
              request={request}
              tenantId={tenantId}
              isOwner={tenantUser?.role === "owner"}
              onChanged={query.retry}
            />
          ) : null}
        </>
      }
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
                onClick={() => setTab(item.id)}
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
            <RequestDocumentsTab tenantId={tenantId} requestId={request.id} />
          ) : (
            <RequestActivityTab tenantId={tenantId} requestId={request.id} />
          )}
        </>
      )}
    </PaperworkPage>
  );
}
