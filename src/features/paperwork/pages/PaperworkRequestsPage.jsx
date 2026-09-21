import { useDeferredValue, useEffect, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { REQUEST_FILTERS } from '@/features/paperwork/adapters/paperworkViewModels';
import { paperworkReadService } from '@/features/paperwork/services/queries/paperworkRead.service';
import { usePaperworkQuery, usePaperworkTenant } from '@/features/paperwork/hooks/usePaperworkQuery';
import { EmptyState, PageError, PageSkeleton } from '@/features/paperwork/shared/PaperworkUI';
import { PAPERWORK_ROUTES } from '@/features/paperwork/routes/paperworkRoutes';
import { createPaperworkNavigationState } from '@/features/paperwork/routes/paperworkNavigation';
import { usePaperworkListScroll } from '@/features/paperwork/hooks/usePaperworkListScroll';
import { PaperworkPage } from '@/features/paperwork/shared/PaperworkPage';

export function PaperworkRequestsContent() {
  const tenantId = usePaperworkTenant();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const querySearch = params.get('q') || '';
  const filter = params.get('filter') || 'all';
  const page = Math.max(Number(params.get('page')) || 0, 0);
  const [search, setSearch] = useState(querySearch);
  const deferredSearch = useDeferredValue(search);
  const query = usePaperworkQuery(
    () => tenantId
      ? paperworkReadService.listRequestSummaries({ tenantId, filter, search: deferredSearch, page })
      : Promise.resolve(null),
    [tenantId, filter, deferredSearch, page],
  );
  const update = (next, options) => setParams((current) => {
    Object.entries(next).forEach(([key, value]) => (
      value ? current.set(key, value) : current.delete(key)
    ));
    return current;
  }, options);

  useEffect(() => setSearch(querySearch), [querySearch]);
  usePaperworkListScroll(location, !query.loading);

  const detailState = () => createPaperworkNavigationState(location, {
    returnLabel: 'الطلبات',
  });
  return (
    <div className="max-w-[920px]">
      <div className="mb-5 mt-8 flex flex-wrap items-center gap-2.5">
        <label className="relative block w-[240px] max-w-full sm:w-[300px]">
          <span className="sr-only">البحث في الطلبات</span>
          <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => { setSearch(event.target.value); update({ q: event.target.value, page: '' }, { replace: true }); }}
            placeholder="البحث في الطلبات"
            className="h-8 w-full rounded-lg border border-slate-300 bg-white pr-8 pl-3 text-xs font-semibold text-slate-800 outline-none transition-colors placeholder:text-slate-500 focus:border-slate-500"
          />
        </label>
        <select
          value={filter}
          onChange={(event) => update({ filter: event.target.value === 'all' ? '' : event.target.value, page: '' })}
          className="h-8 rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800 outline-none focus:border-slate-500"
          aria-label="تصفية الطلبات حسب الحالة"
        >
          {REQUEST_FILTERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        {query.data ? <span className="text-[11px] font-bold text-slate-500">{query.data.count} طلب</span> : null}
      </div>
      {query.loading ? <PageSkeleton /> : query.error ? <PageError message={query.error} onRetry={query.retry} /> : !query.data.items.length ? <EmptyState title="لا توجد طلبات في هذه الحالة." /> : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-300 bg-white">
            <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(8rem,0.75fr)_7rem_1rem] gap-4 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 text-[10px] font-black text-slate-500 sm:grid">
              <span>الطلب</span>
              <span>بيانات التتبع</span>
              <span>الجهة</span>
              <span>الحالة</span>
              <span />
            </div>
            <div className="divide-y divide-slate-200">{query.data.items.map((item) => (
              <Link
                key={item.id}
                to={PAPERWORK_ROUTES.requestDetails(item.id)}
                state={detailState()}
                className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-slate-400 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(8rem,0.75fr)_7rem_1rem] sm:gap-4"
              >
                <div className="min-w-0">
                  <h2 className="truncate text-xs font-black text-slate-950">{item.customerName}</h2>
                  <p className="mt-1 truncate text-[10px] font-semibold text-slate-500">{item.productName}</p>
                  <time className="mt-1 block text-[9px] font-semibold text-slate-400 sm:hidden">{new Date(item.updatedAt).toLocaleDateString('ar-EG')}</time>
                </div>
                <span className="hidden truncate font-mono text-[10px] text-slate-600 sm:block" dir="ltr">{[item.trackingNumber, ...(item.identifiers || [])].filter(Boolean).slice(0, 2).join(' · ') || '—'}</span>
                <span className="hidden truncate text-[10px] font-bold text-slate-600 sm:block">{item.processorName}</span>
                <span className="justify-self-end whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-[9px] font-black text-slate-700 sm:justify-self-start">{item.stageLabel}</span>
                <ArrowLeft className="hidden h-3.5 w-3.5 text-slate-400 transition-transform group-hover:-translate-x-0.5 sm:block" />
              </Link>
            ))}</div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <button disabled={!page} onClick={() => update({ page: String(page - 1) })} className="h-8 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40">السابق</button>
            <span className="text-[10px] font-bold text-slate-500">صفحة {page + 1}</span>
            <button disabled={(page + 1) * query.data.pageSize >= query.data.count} onClick={() => update({ page: String(page + 1) })} className="h-8 rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 disabled:opacity-40">التالي</button>
          </div>
        </>
      )}
    </div>
  );
}

export function PaperworkRequestsPage() {
  return (
    <PaperworkPage
      title="طلبات الأوراق"
      showHeaderDivider={false}
      showTitle={false}
    >
      <PaperworkRequestsContent />
    </PaperworkPage>
  );
}
