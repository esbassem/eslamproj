import { useDeferredValue, useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { DOCUMENT_FILTERS } from "@/features/paperwork/adapters/paperworkViewModels";
import { paperworkReadService } from "@/features/paperwork/services/queries/paperworkRead.service";
import {
  usePaperworkQuery,
  usePaperworkTenant,
} from "@/features/paperwork/hooks/usePaperworkQuery";
import { PaperworkPage } from "@/features/paperwork/shared/PaperworkPage";
import {
  EmptyState,
  FilterBar,
  PageError,
  PageSkeleton,
  SearchInput,
  SerialDisplay,
  StatusBadge,
} from "@/features/paperwork/shared/PaperworkUI";
import { PAPERWORK_ROUTES } from "@/features/paperwork/routes/paperworkRoutes";
import { createPaperworkNavigationState } from "@/features/paperwork/routes/paperworkNavigation";
import { usePaperworkListScroll } from "@/features/paperwork/hooks/usePaperworkListScroll";
import { PaperworkDocumentsNavigation } from "@/features/paperwork/shared/PaperworkDocumentsNavigation";

export function DocumentListContent({ vault = false }) {
  const location = useLocation();
  const tenantId = usePaperworkTenant();
  const [params, setParams] = useSearchParams();
  const filter = vault ? "in_custody" : params.get("filter") || "all";
  const requestId = params.get("request") || null;
  const page = Math.max(Number(params.get("page")) || 0, 0);
  const querySearch = params.get("q") || "";
  const [search, setSearch] = useState(querySearch);
  const deferredSearch = useDeferredValue(search);
  const query = usePaperworkQuery(
    () =>
      tenantId
        ? paperworkReadService.listDocumentSummaries({
            tenantId,
            filter,
            search: deferredSearch,
            page,
            custodyOnly: vault,
            requestId,
          })
        : Promise.resolve(null),
    [tenantId, filter, deferredSearch, page, vault, requestId],
  );
  const update = (next, options) =>
    setParams((current) => {
      Object.entries(next).forEach(([key, value]) =>
        value ? current.set(key, value) : current.delete(key),
      );
      return current;
    }, options);
  useEffect(() => setSearch(querySearch), [querySearch]);
  usePaperworkListScroll(location, !query.loading);
  return (
    <>
      <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row">
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            update({ q: value, page: "" }, { replace: true });
          }}
          placeholder="بحث بالعميل أو صاحب الورق أو المنتج أو أرقام التتبع"
        />
        {!vault ? (
          <FilterBar
            filters={DOCUMENT_FILTERS}
            value={filter}
            onChange={(value) =>
              update({ filter: value === "all" ? "" : value, page: "" })
            }
          />
        ) : null}
      </div>
      {query.loading ? (
        <PageSkeleton />
      ) : query.error ? (
        <PageError message={query.error} onRetry={query.retry} />
      ) : !query.data.items.length ? (
        <EmptyState
          title={
            vault
              ? "الخزنة لا تحتوي مستندات مطابقة."
              : "لا توجد مستندات مطابقة."
          }
        />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {query.data.items.map((item) => (
              <Link
                key={item.id}
                to={PAPERWORK_ROUTES.documentDetails(item.id)}
                state={createPaperworkNavigationState(location, { returnLabel: vault ? "الخزنة" : "المستندات" })}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:border-blue-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="font-black">{item.title}</h2>
                    <p className="mt-1 text-sm font-bold text-slate-500">
                      {item.ownerName}
                    </p>
                  </div>
                  <StatusBadge label={item.statusLabel} status={item.status} />
                </div>
                <div className="mt-3 text-sm font-bold text-slate-600">
                  {item.productName}
                </div>
                <SerialDisplay
                  trackingNumber={item.trackingNumber}
                  identifiers={item.identifiers}
                />
              </Link>
            ))}
          </div>
          <div className="mt-5 flex items-center justify-between">
            <button
              disabled={!page}
              onClick={() => update({ page: String(page - 1) })}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-black disabled:opacity-40"
            >
              السابق
            </button>
            <span className="text-xs font-bold text-slate-500">
              {query.data.count} مستند
            </span>
            <button
              disabled={(page + 1) * query.data.pageSize >= query.data.count}
              onClick={() => update({ page: String(page + 1) })}
              className="rounded-lg border bg-white px-4 py-2 text-sm font-black disabled:opacity-40"
            >
              التالي
            </button>
          </div>
        </>
      )}
    </>
  );
}

export function DocumentListPage({ vault = false }) {
  return (
    <PaperworkPage
      title={vault ? "الخزنة" : "المستندات"}
      description={vault ? "الحيازة التشغيلية الحالية للمستندات الموجودة داخل الخزنة." : "السجل التاريخي الكامل لكل مستندات أوراق الملكية."}
    >
      <PaperworkDocumentsNavigation />
      <DocumentListContent vault={vault} />
    </PaperworkPage>
  );
}
