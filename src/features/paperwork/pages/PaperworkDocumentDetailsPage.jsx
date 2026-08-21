import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { DocumentActions } from "@/features/paperwork/documents/DocumentActions";
import { DocumentContext } from "@/features/paperwork/documents/DocumentContext";
import { paperworkService } from "@/features/paperwork/services/paperwork.service";
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
import { PAPERWORK_ROUTES } from "@/features/paperwork/routes/paperworkRoutes";

const row = (label, value) => (
  <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
    <span className="text-sm font-bold text-slate-500">{label}</span>
    <span className="text-left text-sm font-black">{value || "—"}</span>
  </div>
);

export function PaperworkDocumentDetailsPage() {
  const { documentId } = useParams();
  const tenantId = usePaperworkTenant();
  const { tenant_user: tenantUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const sourceRoute = location.state?.paperworkBackTo;
  const sourcePath = typeof sourceRoute === "string" ? sourceRoute.split("?")[0] : "";
  const hasSafeSource =
    sourcePath === PAPERWORK_ROUTES.vault ||
    sourcePath === PAPERWORK_ROUTES.documents ||
    /^\/apps\/paperwork\/requests\/[^/]+$/.test(sourcePath);
  const backRoute = hasSafeSource ? sourceRoute : PAPERWORK_ROUTES.documents;
  const query = usePaperworkQuery(
    () =>
      tenantId
        ? paperworkService.getPaperworkDocumentDetails({ tenantId, documentId })
        : Promise.resolve(null),
    [tenantId, documentId],
  );
  const document = query.data;
  return (
    <PaperworkPage
      title={document?.displayTitle || "تفاصيل المستند"}
      actions={
        <>
          <button
            type="button"
            onClick={() => navigate(backRoute)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-sm font-black"
          >
            <ArrowRight className="h-4 w-4" />
            رجوع
          </button>
          {document ? (
            <DocumentActions
              document={document}
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
    </PaperworkPage>
  );
}
