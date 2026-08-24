import { Archive, ArrowLeft, Building2, Inbox } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { paperworkReadService } from '@/features/paperwork/services/queries/paperworkRead.service';
import { usePaperworkQuery, usePaperworkTenant } from '@/features/paperwork/hooks/usePaperworkQuery';
import { PaperworkPage } from '@/features/paperwork/shared/PaperworkPage';
import { PageError, PageSkeleton, StatusBadge } from '@/features/paperwork/shared/PaperworkUI';
import { PaperworkManualReceipt } from '@/features/paperwork/manual-receipt/PaperworkManualReceipt';
import { PAPERWORK_ROUTES, withPaperworkSearch } from '@/features/paperwork/routes/paperworkRoutes';
import { createPaperworkNavigationState } from '@/features/paperwork/routes/paperworkNavigation';
import { PaperworkBackButton } from '@/features/paperwork/shared/PaperworkBackButton';

export function PaperworkHomePage() {
  const tenantId = usePaperworkTenant();
  const location = useLocation();
  const query = usePaperworkQuery(() => tenantId ? paperworkReadService.getHomeSummary({ tenantId }) : Promise.resolve(null), [tenantId]);
  const cards = query.data ? [
    { label: 'تحتاج إجراء', value: query.data.actionCount, icon: Inbox, to: withPaperworkSearch(PAPERWORK_ROUTES.requests, { filter: 'preparation' }) },
    { label: 'عند الجهات', value: query.data.processorCount, icon: Building2, to: PAPERWORK_ROUTES.processors },
    { label: 'في الخزنة', value: query.data.vaultCount, icon: Archive, to: PAPERWORK_ROUTES.vault },
  ] : [];
  return (
    <PaperworkPage
      title="طلبات الأوراق"
      contextualBack={<PaperworkBackButton disabled />}
      showHeaderDivider={false}
      showTitle={false}
    >
      {query.loading ? <PageSkeleton rows={4} /> : query.error ? <PageError message={query.error} onRetry={query.retry} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon, to }) => (
            <Link key={label} to={to} state={to === PAPERWORK_ROUTES.processors ? createPaperworkNavigationState(location, { returnLabel: 'طلبات الأوراق' }) : undefined} className="rounded-2xl border border-slate-200 bg-white p-5 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200">
              <div className="flex items-center justify-between"><Icon className="h-5 w-5 text-blue-600" /><ArrowLeft className="h-4 w-4 text-slate-400" /></div>
              <div className="mt-5 text-3xl font-black">{value}</div><div className="mt-1 text-sm font-bold text-slate-500">{label}</div>
            </Link>
          ))}</div>
          <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="font-black">آخر الطلبات</h2>
            <div className="mt-4 divide-y divide-slate-100">{query.data.recentRequests.length ? query.data.recentRequests.map((request) => (
              <Link
                key={request.id}
                to={PAPERWORK_ROUTES.requestDetails(request.id)}
                state={createPaperworkNavigationState(location, { returnLabel: 'طلبات الأوراق' })}
                className="flex items-center justify-between gap-4 py-3 transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="truncate font-black text-slate-900">{request.customerName}</div>
                  <div className="mt-1 truncate text-sm font-bold text-slate-500">{request.productName} · #{request.shortNumber}</div>
                </div>
                <div className="flex flex-none items-center gap-3">
                  <StatusBadge label={request.stageLabel} status={request.currentStage} />
                  <time className="hidden text-xs font-bold text-slate-400 sm:block">{new Date(request.createdAt).toLocaleString('ar-EG')}</time>
                  <ArrowLeft className="h-4 w-4 text-slate-400" />
                </div>
              </Link>
            )) : <p className="py-6 text-center text-sm text-slate-500">لا توجد طلبات حتى الآن.</p>}</div>
          </section>
        </>
      )}
      <PaperworkManualReceipt onSaved={() => void query.retry()} />
    </PaperworkPage>
  );
}
