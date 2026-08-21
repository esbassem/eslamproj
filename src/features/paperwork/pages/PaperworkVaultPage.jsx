import { useDeferredValue, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "@/features/auth/hooks/useAuth";
import { paperworkService } from "@/features/paperwork/services/paperwork.service";
import { loadVaultPaperworkFirstPage } from "@/features/paperwork/services/vaultPaperworkCache";
import { paperworkReadService } from "@/features/paperwork/services/queries/paperworkRead.service";
import { usePaperworkTenant } from "@/features/paperwork/hooks/usePaperworkQuery";
import { PaperworkPage } from "@/features/paperwork/shared/PaperworkPage";
import {
  EmptyState,
  PageError,
  PageSkeleton,
  SearchInput,
  SerialDisplay,
  StatusBadge,
} from "@/features/paperwork/shared/PaperworkUI";
import { PAPERWORK_ROUTES } from "@/features/paperwork/routes/paperworkRoutes";

export function PaperworkVaultPage() {
  const tenantId = usePaperworkTenant();
  const { tenant_user: tenantUser } = useAuth();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [documents, setDocuments] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [balances, setBalances] = useState(new Map());
  const fetchCursorPage = ({ pageSize, cursor: nextCursor }) =>
    paperworkService.listVaultPaperworkSummary({
      tenantId,
      pageSize,
      cursor: nextCursor,
    });
  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    setError("");
    try {
      if (deferredSearch.trim()) {
        const result = await paperworkReadService.listDocumentSummaries({
          tenantId,
          custodyOnly: true,
          search: deferredSearch,
          pageSize: 30,
        });
        setDocuments(result.items);
        setCursor(null);
        setHasMore(false);
      } else {
        const result = await loadVaultPaperworkFirstPage({
          tenantId,
          userId: tenantUser?.id,
          search: "",
          pageSize: 30,
          fetchPage: fetchCursorPage,
        });
        setDocuments(result.documents || []);
        setCursor(result.cursor);
        setHasMore(result.hasMore);
      }
    } catch (nextError) {
      setError(nextError?.message || "تعذر تحميل الخزنة.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, [tenantId, tenantUser?.id, deferredSearch]);
  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchCursorPage({ pageSize: 30, cursor });
      setDocuments((current) => [...current, ...(result.documents || [])]);
      setCursor(result.cursor);
      setHasMore(result.hasMore);
    } catch (nextError) {
      setError(nextError?.message || "تعذر تحميل المزيد.");
    } finally {
      setLoadingMore(false);
    }
  };
  const loadBalance = async (document) => {
    try {
      const result =
        await paperworkService.listPaperworkDocumentInvoiceBalances({
          tenantId,
          documents: [document],
        });
      setBalances((current) =>
        new Map(current).set(document.id, result.get(document.id) || null),
      );
    } catch (nextError) {
      setError(nextError?.message || "تعذر تحميل الرصيد.");
    }
  };
  return (
    <PaperworkPage
      title="الخزنة"
      description="الحيازة التشغيلية الحالية؛ أول صفحة مخزنة بمعزل عن الشركة والمستخدم."
    >
      <div className="mb-4 rounded-2xl border bg-white p-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="بحث بالشاسيه أو الموتور أو القطعة أو العميل أو صاحب الورق"
        />
      </div>
      {loading ? (
        <PageSkeleton />
      ) : error && !documents.length ? (
        <PageError message={error} onRetry={load} />
      ) : !documents.length ? (
        <EmptyState title="الخزنة لا تحتوي مستندات مطابقة." />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {documents.map((document) => {
              const balance = balances.get(document.id);
              return (
                <article
                  key={document.id}
                  className="rounded-2xl border bg-white p-4"
                >
                  <Link
                    to={PAPERWORK_ROUTES.documentDetails(document.id)}
                    state={{ paperworkBackTo: PAPERWORK_ROUTES.vault }}
                    className="block"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h2 className="font-black">
                          {document.displayTitle || document.title}
                        </h2>
                        <p className="mt-1 text-sm font-bold text-slate-500">
                          {document.documentOwnerName || document.ownerName}
                        </p>
                      </div>
                      <StatusBadge label="في الحيازة" status="in_custody" />
                    </div>
                    <p className="mt-3 text-sm font-bold">
                      {document.productName}
                    </p>
                    <SerialDisplay
                      trackingNumber={
                        document.trackingUnit?.trackingNumber ||
                        document.trackingNumber
                      }
                      identifiers={(
                        document.trackingIdentifiers ||
                        document.identifiers ||
                        []
                      ).map((item) => item.value || item)}
                    />
                  </Link>
                  <div className="mt-3 border-t pt-3">
                    {balances.has(document.id) ? (
                      <p className="text-xs font-black text-slate-600">
                        {balance
                          ? `المتبقي: ${Number(balance.remainingAmount || 0).toLocaleString("ar-EG")}`
                          : "لا توجد فاتورة مرتبطة"}
                      </p>
                    ) : (
                      <button
                        onClick={() => void loadBalance(document)}
                        className="text-xs font-black text-blue-700"
                      >
                        تحميل حالة الرصيد
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-black text-red-700"
            >
              {error}
            </p>
          ) : null}
          {hasMore ? (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="mx-auto mt-5 block h-11 rounded-xl border bg-white px-5 text-sm font-black disabled:opacity-40"
            >
              {loadingMore ? "جارٍ التحميل…" : "تحميل المزيد"}
            </button>
          ) : null}
        </>
      )}
    </PaperworkPage>
  );
}
