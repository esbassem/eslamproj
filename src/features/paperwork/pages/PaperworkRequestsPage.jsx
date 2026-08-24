import { useDeferredValue, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { REQUEST_FILTERS } from '@/features/paperwork/adapters/paperworkViewModels';
import { paperworkReadService } from '@/features/paperwork/services/queries/paperworkRead.service';
import { usePaperworkQuery, usePaperworkTenant } from '@/features/paperwork/hooks/usePaperworkQuery';
import { EmptyState, FilterBar, PageError, PageSkeleton, SearchInput, SerialDisplay, StatusBadge } from '@/features/paperwork/shared/PaperworkUI';
import { PAPERWORK_ROUTES } from '@/features/paperwork/routes/paperworkRoutes';
import { createPaperworkNavigationState, resolvePaperworkReturnContext } from '@/features/paperwork/routes/paperworkNavigation';
import { usePaperworkListScroll } from '@/features/paperwork/hooks/usePaperworkListScroll';
import { PaperworkPage } from '@/features/paperwork/shared/PaperworkPage';
import { PaperworkBackButton } from '@/features/paperwork/shared/PaperworkBackButton';

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
    <>
      <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(value) => { setSearch(value); update({ q: value, page: '' }, { replace: true }); }} placeholder="بحث بالعميل أو صاحب الورق أو المنتج أو الرقم أو الجهة" />
        <FilterBar filters={REQUEST_FILTERS} value={filter} onChange={(value) => update({ filter: value === 'all' ? '' : value, page: '' })} />
      </div>
      {query.loading ? <PageSkeleton /> : query.error ? <PageError message={query.error} onRetry={query.retry} /> : !query.data.items.length ? <EmptyState title="لا توجد طلبات في هذه الحالة." /> : (
        <>
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white xl:block">
            <div className="grid grid-cols-[minmax(7rem,.75fr)_minmax(11rem,1.35fr)_minmax(11rem,1.35fr)_minmax(8rem,1fr)_minmax(8rem,.8fr)_1.5rem] items-center gap-4 border-b border-slate-200 bg-slate-50/80 px-5 py-3 text-xs font-black text-slate-600">
              <span>الحالة</span><span>العميل وصاحب الورق</span><span>المنتج والأرقام</span><span>جهة الإصدار</span><span>آخر تحديث</span><span aria-hidden="true" />
            </div>
            <div className="divide-y divide-slate-100">{query.data.items.map((item) => (
              <Link
                key={item.id}
                to={PAPERWORK_ROUTES.requestDetails(item.id)}
                state={detailState()}
                className="group relative grid grid-cols-[minmax(7rem,.75fr)_minmax(11rem,1.35fr)_minmax(11rem,1.35fr)_minmax(8rem,1fr)_minmax(8rem,.8fr)_1.5rem] items-center gap-4 px-5 py-4 text-sm transition-colors before:absolute before:inset-y-3 before:right-0 before:w-0.5 before:rounded-full before:bg-blue-600 before:opacity-0 hover:bg-blue-50/50 hover:before:opacity-100 focus-visible:bg-blue-50 focus-visible:outline-none"
              >
                <span><StatusBadge label={item.stageLabel} status={item.currentStage} /></span>
                <span className="min-w-0"><strong className="block truncate font-black text-slate-950">{item.customerName}</strong>{item.ownerName && item.ownerName !== item.customerName ? <small className="mt-0.5 block truncate text-xs font-bold text-slate-500">صاحب الورق: {item.ownerName}</small> : null}</span>
                <span className="min-w-0"><strong className="block truncate font-extrabold text-slate-900">{item.productName}</strong><SerialDisplay trackingNumber={item.trackingNumber} identifiers={item.identifiers} /></span>
                <span className="truncate font-extrabold text-slate-700">{item.processorName}</span>
                <time className="text-xs font-bold text-slate-600">{new Date(item.updatedAt).toLocaleString('ar-EG')}</time>
                <ArrowLeft className="h-4 w-4 text-slate-300 transition group-hover:-translate-x-0.5 group-hover:text-blue-600" />
              </Link>
            ))}</div>
          </div>
          <div className="space-y-3 xl:hidden">{query.data.items.map((item) => (
            <Link key={item.id} to={PAPERWORK_ROUTES.requestDetails(item.id)} state={detailState()} className="group block rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-blue-300 active:scale-[0.99]">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-black text-slate-950">{item.customerName}</div><div className="mt-1 truncate text-sm font-extrabold text-slate-700">{item.productName}</div></div><StatusBadge label={item.stageLabel} status={item.currentStage} /></div>
              <div className="mt-3"><SerialDisplay trackingNumber={item.trackingNumber} identifiers={item.identifiers} /></div>
              <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3"><span className="text-xs font-extrabold text-slate-600">{item.processorName}</span><ArrowLeft className="h-4 w-4 text-slate-300 transition group-hover:text-blue-600" /></div>
            </Link>
          ))}</div>
          <div className="mt-5 flex items-center justify-between">
            <button disabled={!page} onClick={() => update({ page: String(page - 1) })} className="rounded-lg border bg-white px-4 py-2 text-sm font-black disabled:opacity-40">السابق</button>
            <span className="text-xs font-bold text-slate-500">{query.data.count} طلب</span>
            <button disabled={(page + 1) * query.data.pageSize >= query.data.count} onClick={() => update({ page: String(page + 1) })} className="rounded-lg border bg-white px-4 py-2 text-sm font-black disabled:opacity-40">التالي</button>
          </div>
        </>
      )}
    </>
  );
}

export function PaperworkRequestsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const returnContext = resolvePaperworkReturnContext(location, PAPERWORK_ROUTES.root, 'طلبات الأوراق');

  return (
    <PaperworkPage
      title="تحتاج إجراء"
      description="الطلبات التي تنتظر استكمال تجهيز أوراقها قبل إرسالها إلى الجهة المختصة."
      contextualBack={<PaperworkBackButton onClick={() => navigate(returnContext.returnTo)} label={returnContext.returnLabel} />}
    >
      <PaperworkRequestsContent />
    </PaperworkPage>
  );
}
