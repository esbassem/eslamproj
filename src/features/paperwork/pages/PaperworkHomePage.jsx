import { Archive, ArrowLeft, Building2, ChevronDown, Inbox, Search } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { paperworkReadService } from '@/features/paperwork/services/queries/paperworkRead.service';
import { usePaperworkQuery, usePaperworkTenant } from '@/features/paperwork/hooks/usePaperworkQuery';
import { PaperworkPage } from '@/features/paperwork/shared/PaperworkPage';
import { PageError, PageSkeleton } from '@/features/paperwork/shared/PaperworkUI';
import { PaperworkManualReceipt } from '@/features/paperwork/manual-receipt/PaperworkManualReceipt';
import { PAPERWORK_ROUTES, withPaperworkSearch } from '@/features/paperwork/routes/paperworkRoutes';
import { createPaperworkNavigationState } from '@/features/paperwork/routes/paperworkNavigation';
import { PaperworkBackButton } from '@/features/paperwork/shared/PaperworkBackButton';

export function PaperworkHomePage() {
  const tenantId = usePaperworkTenant();
  const location = useLocation();
  const query = usePaperworkQuery(() => tenantId ? paperworkReadService.getHomeSummary({ tenantId }) : Promise.resolve(null), [tenantId]);
  const cards = query.data ? [
    { label: 'تحتاج إجراء', description: 'طلبات في انتظار التجهيز', value: query.data.actionCount, icon: Inbox, to: withPaperworkSearch(PAPERWORK_ROUTES.requests, { filter: 'preparation' }) },
    { label: 'عند الجهات', description: 'طلبات لدى جهات الإصدار', value: query.data.processorCount, icon: Building2, to: PAPERWORK_ROUTES.processors },
    { label: 'في الخزنة', description: 'مستندات في حيازة الشركة', value: query.data.vaultCount, icon: Archive, to: PAPERWORK_ROUTES.vault },
  ] : [];
  return (
    <PaperworkPage
      title="إدارة أوراق الملكية"
      contextualBack={<PaperworkBackButton disabled />}
      showHeaderDivider={false}
      showTitle={false}
    >
      {query.loading ? <PageSkeleton rows={4} /> : query.error ? <PageError message={query.error} onRetry={query.retry} /> : (
        <>
          <div className="mb-5 mt-8 flex max-w-[820px] flex-wrap items-center gap-2.5" aria-label="أدوات عرض الطلبات">
            <div className="relative w-[240px] max-w-full sm:w-[280px]">
              <Search className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
              <input
                type="search"
                readOnly
                placeholder="البحث في الطلبات"
                className="h-8 w-full rounded-lg border border-slate-300 bg-white pr-8 pl-3 text-xs font-semibold text-slate-700 outline-none placeholder:text-slate-500"
                aria-label="البحث في الطلبات — للعرض فقط"
              />
            </div>
            <button type="button" className="inline-flex h-8 flex-none items-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 text-xs font-bold text-slate-800" aria-label="تصفية حسب الحالة — للعرض فقط">
              الحالة
              <ChevronDown className="h-3.5 w-3.5 text-slate-500" aria-hidden="true" />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:max-w-[720px] xl:grid-cols-3">{cards.map(({ label, description, value, icon: Icon, to }) => (
            <Link key={label} to={to} state={to === PAPERWORK_ROUTES.processors ? createPaperworkNavigationState(location, { returnLabel: 'الرئيسية' }) : undefined} className="group flex min-h-[140px] flex-col rounded-lg border border-slate-300 bg-white p-4 text-right transition-colors hover:border-slate-400">
              <div>
                <h2 className="text-xs font-black text-slate-950">{label}</h2>
                <p className="mt-1.5 text-[11px] font-semibold text-slate-600">{description}</p>
              </div>
              <div className="mt-auto flex items-end justify-between gap-4 pt-6">
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-lg border border-slate-300 text-slate-700"><Icon className="h-4 w-4" /></span>
                  <strong className="text-lg font-black text-slate-950">{value}</strong>
                </div>
                <ArrowLeft className="h-4 w-4 text-slate-400 transition-transform group-hover:-translate-x-0.5" />
              </div>
            </Link>
          ))}</div>
          <section className="mt-8 max-w-[520px] rounded-lg border border-slate-300 bg-white p-5" aria-labelledby="recent-paperwork-requests">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="recent-paperwork-requests" className="text-sm font-black text-slate-950">آخر الطلبات</h2>
                <p className="mt-1 text-[11px] font-semibold text-slate-500">أحدث طلبات أوراق الملكية المسجلة</p>
              </div>
            </div>
            <div className="mt-5">
              {query.data.recentRequests.length ? query.data.recentRequests.map((request) => (
                <Link
                  key={request.id}
                  to={PAPERWORK_ROUTES.requestDetails(request.id)}
                  state={createPaperworkNavigationState(location, { returnLabel: 'الرئيسية' })}
                  className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-dashed border-slate-200 py-3 text-xs last:border-0 hover:bg-slate-50/60"
                >
                  <span className="h-4 w-4 rounded-full border-2 border-emerald-400 border-l-slate-300" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate font-black text-slate-800">{request.customerName}</span>
                    <span className="mt-0.5 block truncate text-[10px] font-semibold text-slate-500">{request.productName}</span>
                  </span>
                  <span className="flex items-center gap-3 whitespace-nowrap">
                    <span className="font-mono text-[10px] font-bold text-slate-700">{request.stageLabel}</span>
                    <span className="font-mono text-[10px] text-slate-500">{new Date(request.createdAt).toLocaleDateString('ar-EG')}</span>
                  </span>
                </Link>
              )) : (
                <p className="py-7 text-center text-xs font-semibold text-slate-500">لا توجد طلبات حتى الآن.</p>
              )}
            </div>
          </section>
        </>
      )}
      <PaperworkManualReceipt onSaved={() => void query.retry()} />
    </PaperworkPage>
  );
}
