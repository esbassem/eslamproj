import { lazy, Suspense, useState } from 'react';
import { Archive, ArrowLeft, Building2, FilePlus2, Inbox, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { paperworkReadService } from '@/features/paperwork/services/queries/paperworkRead.service';
import { usePaperworkQuery, usePaperworkTenant } from '@/features/paperwork/hooks/usePaperworkQuery';
import { PaperworkPage } from '@/features/paperwork/shared/PaperworkPage';
import { PageError, PageSkeleton } from '@/features/paperwork/shared/PaperworkUI';
import { PAPERWORK_ROUTES } from '@/features/paperwork/routes/paperworkRoutes';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { PAPERWORK_PERMISSIONS } from '@/features/paperwork/authorization/paperworkPermissions';

const ManualReceipt = lazy(() => import('@/features/paperwork/manual-receipt/ManualReceiptFlow').then((module) => ({ default: module.ManualReceiptFlow })));

export function PaperworkHomePage() {
  const tenantId = usePaperworkTenant();
  const { tenant_user: tenantUser } = useAuth();
  const { can } = useAuthorization();
  const canReceive = can(PAPERWORK_PERMISSIONS.RECEIVE);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const query = usePaperworkQuery(() => tenantId ? paperworkReadService.getHomeSummary({ tenantId }) : Promise.resolve(null), [tenantId]);
  const cards = query.data ? [
    { label: 'تحتاج إجراء', value: query.data.actionCount, icon: Inbox, to: `${PAPERWORK_ROUTES.requests}?filter=action` },
    { label: 'عند الجهات', value: query.data.processorCount, icon: Building2, to: PAPERWORK_ROUTES.processors },
    { label: 'في الخزنة', value: query.data.vaultCount, icon: Archive, to: PAPERWORK_ROUTES.vault },
    { label: 'تحتاج مراجعة', value: query.data.reviewCount, icon: TriangleAlert, to: `${PAPERWORK_ROUTES.requests}?filter=action` },
  ] : [];
  return <PaperworkPage title="إدارة أوراق الملكية" description="نقطة بدء تشغيلية سريعة دون تحميل قوائم النطاق كاملة." actions={canReceive ? <button type="button" onClick={() => setReceiptOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-black text-white hover:bg-blue-700"><FilePlus2 className="h-4 w-4" />استلام ورق جديد</button> : null}>
    {query.loading ? <PageSkeleton rows={4} /> : query.error ? <PageError message={query.error} onRetry={query.retry} /> : <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(({ label, value, icon: Icon, to }) => <Link key={label} to={to} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200"><div className="flex items-center justify-between"><Icon className="h-5 w-5 text-blue-600" /><ArrowLeft className="h-4 w-4 text-slate-400" /></div><div className="mt-5 text-3xl font-black">{value}</div><div className="mt-1 text-sm font-bold text-slate-500">{label}</div></Link>)}</div><section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-black">آخر نشاط</h2><div className="mt-4 divide-y divide-slate-100">{query.data.activity.length ? query.data.activity.map((event) => <div key={event.id} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="font-bold text-slate-700">{event.notes || event.new_stage || event.event_type}</span><time className="flex-none text-xs text-slate-400">{new Date(event.created_at).toLocaleString('ar-EG')}</time></div>) : <p className="py-6 text-center text-sm text-slate-500">لا يوجد نشاط حديث.</p>}</div></section></>}
    {canReceive && receiptOpen ? <Suspense fallback={null}><ManualReceipt open={receiptOpen} onOpenChange={setReceiptOpen} tenantId={tenantId} userId={tenantUser?.id} onSaved={() => { setReceiptOpen(false); void query.retry(); }} /></Suspense> : null}
  </PaperworkPage>;
}
