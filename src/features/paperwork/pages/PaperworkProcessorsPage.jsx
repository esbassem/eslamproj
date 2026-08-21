import { Building2, Clock3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { paperworkReadService } from '@/features/paperwork/services/queries/paperworkRead.service';
import { usePaperworkQuery, usePaperworkTenant } from '@/features/paperwork/hooks/usePaperworkQuery';
import { PaperworkPage } from '@/features/paperwork/shared/PaperworkPage';
import { EmptyState, PageError, PageSkeleton } from '@/features/paperwork/shared/PaperworkUI';
import { PAPERWORK_ROUTES } from '@/features/paperwork/routes/paperworkRoutes';

function waitLabel(value) {
  if (!value) return 'غير محدد';
  const days = Math.max(Math.floor((Date.now() - new Date(value).getTime()) / 86400000), 0);
  return days ? `${days} يوم` : 'أقل من يوم';
}

export function PaperworkProcessorsPage() {
  const tenantId = usePaperworkTenant();
  const query = usePaperworkQuery(() => tenantId ? paperworkReadService.listProcessorSummaries({ tenantId }) : Promise.resolve([]), [tenantId]);
  return <PaperworkPage title="عند الجهات" description="قائمة تشغيلية مجمعة حسب جهة الإصدار.">{query.loading ? <PageSkeleton rows={5} /> : query.error ? <PageError message={query.error} onRetry={query.retry} /> : !query.data.length ? <EmptyState title="لا توجد أوراق عند جهات الإصدار." /> : <div className="grid gap-3 lg:grid-cols-2">{query.data.map((processor) => <Link key={processor.id} to={PAPERWORK_ROUTES.processorDetails(processor.id)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-violet-200"><div className="flex items-start justify-between"><div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-violet-50 text-violet-700"><Building2 className="h-5 w-5" /></span><div><h2 className="font-black">{processor.name}</h2><p className="text-sm font-bold text-slate-500">{processor.count} طلب</p></div></div><div className="flex items-center gap-1 text-xs font-bold text-slate-500"><Clock3 className="h-4 w-4" />{waitLabel(processor.oldestAt)}</div></div><p className="mt-4 text-xs text-slate-400">أقدم طلب: {processor.oldestAt ? new Date(processor.oldestAt).toLocaleDateString('ar-EG') : 'غير محدد'}</p></Link>)}</div>}</PaperworkPage>;
}
