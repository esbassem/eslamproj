import { useLocation, useParams } from "react-router-dom";
import { DocumentActions } from "@/features/paperwork/documents/DocumentActions";
import { DocumentContext } from "@/features/paperwork/documents/DocumentContext";
import { paperworkService } from "@/features/paperwork/services/paperwork.service";
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
import { PAPERWORK_ROUTES } from "@/features/paperwork/routes/paperworkRoutes";
import { resolvePaperworkReturnContext } from "@/features/paperwork/routes/paperworkNavigation";

const row = (label, value) => (
  <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
    <span className="text-sm font-bold text-slate-500">{label}</span>
    <span className="text-left text-sm font-black">{value || "—"}</span>
  </div>
);

export function PaperworkDocumentDetailsPage() {
  const { documentId } = useParams();
  const tenantId = usePaperworkTenant();
  const location = useLocation();
  const returnContext = resolvePaperworkReturnContext(location, PAPERWORK_ROUTES.documents, "المستندات");
  const query = usePaperworkQuery(
    () =>
      tenantId
        ? paperworkService.getPaperworkDocumentDetails({ tenantId, documentId })
        : Promise.resolve(null),
    [tenantId, documentId],
  );
  const document = query.data;
  return (
    <PaperworkDetailPage
      title={document?.displayTitle || "تفاصيل المستند"}
      returnContext={returnContext}
      actions={document ? (
            <DocumentActions
              document={document}
              tenantId={tenantId}
              onChanged={query.retry}
            />
          ) : null}
    >
      {query.loading ? (
        <PageSkeleton />
      ) : query.error ? (
        <PageError message={query.error} onRetry={query.retry} />
      ) : !document ? (
        <EmptyState title="المستند غير موجود." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <DetailSection title="نظرة عامة">
            <div className="mb-4">
              <StatusBadge label={document.status} status={document.status} />
            </div>
            {row("النوع", document.documentType)}
            {row("صاحب المستند", document.documentOwnerName)}
            {row("المنتج", document.productName)}
            {row(
              "الموقع الحالي",
              document.currentLocation || document.latestMove?.toLabel,
            )}
            <SerialDisplay
              trackingNumber={document.trackingUnit?.trackingNumber}
              identifiers={(document.trackingIdentifiers || []).map(
                (item) => item.value,
              )}
            />
            <div className="mt-5 border-t pt-4">
              <DocumentContext
                tenantId={tenantId}
                requestId={document.paperworkRequestId}
                returnLabel="المستند"
              />
            </div>
          </DetailSection>
          <DetailSection title="المرفقات">
            {document.attachments?.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {document.attachments.map((attachment) => (
                  <a
                    key={attachment.id}
                    href={attachment.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-slate-200 p-3 text-sm font-black text-blue-700"
                  >
                    {attachment.name || attachment.documentType}
                  </a>
                ))}
              </div>
            ) : (
              <EmptyState title="لا توجد مرفقات." />
            )}
          </DetailSection>
          <div className="lg:col-span-2">
            <DetailSection title="سجل حركة الحيازة">
              {document.moves?.length ? (
                <ol className="space-y-3">
                  {document.moves.map((move) => (
                    <li key={move.id} className="rounded-xl bg-slate-50 p-4">
                      <div className="font-black">
                        {move.fromLabel} ← {move.toLabel}
                      </div>
                      <div className="mt-1 text-xs font-bold text-slate-500">
                        {new Date(move.movedAt).toLocaleString("ar-EG")} ·{" "}
                        {move.createdByName || "النظام"}
                      </div>
                      {move.notes ? (
                        <p className="mt-2 text-sm text-slate-600">
                          {move.notes}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <EmptyState title="لا توجد حركات مسجلة." />
              )}
            </DetailSection>
          </div>
        </div>
      )}
    </PaperworkDetailPage>
  );
}
