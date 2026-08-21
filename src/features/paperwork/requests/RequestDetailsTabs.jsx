import { Link, useLocation } from "react-router-dom";
import { paperworkReadService } from "@/features/paperwork/services/queries/paperworkRead.service";
import { paperworkService } from "@/features/paperwork/services/paperwork.service";
import { usePaperworkQuery } from "@/features/paperwork/hooks/usePaperworkQuery";
import {
  DetailSection,
  EmptyState,
  PageError,
  PageSkeleton,
  StatusBadge,
} from "@/features/paperwork/shared/PaperworkUI";
import { PAPERWORK_ROUTES } from "@/features/paperwork/routes/paperworkRoutes";

export function RequestDocumentsTab({ tenantId, requestId }) {
  const location = useLocation();
  const query = usePaperworkQuery(
    () =>
      paperworkReadService.listDocumentSummaries({
        tenantId,
        requestId,
        pageSize: 30,
      }),
    [tenantId, requestId],
  );
  return (
    <DetailSection title="المستندات المرتبطة">
      {query.loading ? (
        <PageSkeleton rows={2} />
      ) : query.error ? (
        <PageError message={query.error} onRetry={query.retry} />
      ) : !query.data.items.length ? (
        <EmptyState title="لا توجد مستندات مرتبطة بالطلب." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {query.data.items.map((document) => (
            <Link
              key={document.id}
              to={PAPERWORK_ROUTES.documentDetails(document.id)}
              state={{
                paperworkBackTo: `${location.pathname}${location.search}`,
              }}
              className="rounded-xl border p-4"
            >
              <div className="flex justify-between gap-3">
                <strong>{document.title}</strong>
                <StatusBadge
                  label={document.statusLabel}
                  status={document.status}
                />
              </div>
              <p className="mt-2 text-xs font-bold text-slate-500">
                {document.ownerName}
              </p>
            </Link>
          ))}
        </div>
      )}
    </DetailSection>
  );
}

export function RequestActivityTab({ tenantId, requestId }) {
  const query = usePaperworkQuery(
    () => paperworkReadService.listRequestEvents({ tenantId, requestId }),
    [tenantId, requestId],
  );
  return (
    <DetailSection title="سجل النشاط">
      {query.loading ? (
        <PageSkeleton rows={3} />
      ) : query.error ? (
        <PageError message={query.error} onRetry={query.retry} />
      ) : !query.data.length ? (
        <EmptyState title="لا يوجد نشاط مسجل." />
      ) : (
        <ol className="space-y-4">
          {query.data.map((event) => (
            <li key={event.id} className="border-r-2 border-blue-200 pr-4">
              <div className="text-sm font-black">
                {event.newStage || event.eventType}
              </div>
              <div className="mt-1 text-xs font-bold text-slate-500">
                {event.createdByName || "النظام"} ·{" "}
                {new Date(event.createdAt).toLocaleString("ar-EG")}
              </div>
              {event.notes ? (
                <p className="mt-2 text-sm text-slate-600">{event.notes}</p>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </DetailSection>
  );
}

export function DeliveryBalanceSummary({ tenantId, saleId }) {
  const query = usePaperworkQuery(
    () =>
      saleId
        ? paperworkService.getPaperworkDeliveryBalance({ tenantId, saleId })
        : Promise.resolve(null),
    [tenantId, saleId],
  );
  if (!saleId)
    return <p className="text-sm text-slate-500">لا توجد فاتورة مرتبطة.</p>;
  if (query.loading)
    return <div className="h-12 animate-pulse rounded-xl bg-slate-100" />;
  if (query.error)
    return (
      <button onClick={query.retry} className="text-sm font-black text-red-700">
        تعذر تحميل أهلية التسليم — إعادة المحاولة
      </button>
    );
  const canDeliver = Number(query.data?.remainingAmount || 0) <= 0;
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-sm">
      <div className="flex justify-between">
        <span className="font-bold text-slate-500">المتبقي</span>
        <strong>
          {Number(query.data?.remainingAmount || 0).toLocaleString("ar-EG")}
        </strong>
      </div>
      <p
        className={`mt-2 text-xs font-black ${canDeliver ? "text-emerald-700" : "text-amber-700"}`}
      >
        {canDeliver ? "مؤهل للتسليم" : "راجع الرصيد قبل التسليم"}
      </p>
    </div>
  );
}
