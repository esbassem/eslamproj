import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Boxes, History, ImageOff, Package, Plus, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '@/core/ui/badge';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { PageHeader } from '@/core/ui/page-header';
import { getCanonicalBreadcrumbs } from '@/core/navigation/platformNavigation';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { inventoryService } from '@/features/inventory/api/inventory.api';

const MOVE_LABELS = {
  receiving: 'استلام', transfer: 'تحويل', reservation: 'حجز', delivery: 'تسليم',
  return: 'مرتجع', adjustment: 'تسوية', opening: 'رصيد افتتاحي',
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 4 });
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function InventoryOverviewPage() {
  const { can, isReady: authorizationReady } = useAuthorization();
  const canRead = authorizationReady && (
    can('inventory.read') || can('inventory.availability')
    || can('inventory.receive') || can('inventory.transfer')
  );
  const canReadMoves = authorizationReady && (can('inventory.read') || can('inventory.availability'));
  const [summary, setSummary] = useState(null);
  const [moves, setMoves] = useState([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [movesLoading, setMovesLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [movesError, setMovesError] = useState('');

  useEffect(() => {
    let mounted = true;
    if (!canRead) return undefined;
    setSummaryLoading(true); setSummaryError('');
    inventoryService.getDashboardSummary().then((value) => {
      if (mounted) setSummary(value);
    }).catch((error) => {
      if (mounted) { setSummary(null); setSummaryError(error.message || 'تعذر تحميل نظرة المخزون.'); }
    }).finally(() => { if (mounted) setSummaryLoading(false); });
    return () => { mounted = false; };
  }, [canRead]);

  useEffect(() => {
    let mounted = true;
    if (!canReadMoves) { setMoves([]); setMovesLoading(false); return undefined; }
    setMovesLoading(true); setMovesError('');
    inventoryService.listStockMovements({ page: 1, pageSize: 6 }).then((result) => {
      if (mounted) setMoves(result.items);
    }).catch((error) => {
      if (mounted) { setMoves([]); setMovesError(error.message || 'تعذر تحميل أحدث الحركات.'); }
    }).finally(() => { if (mounted) setMovesLoading(false); });
    return () => { mounted = false; };
  }, [canReadMoves]);

  if (!authorizationReady) return <LoadingSpinner title="جاري التحقق من صلاحيات المخزون" />;
  if (!canRead) return <Alert tone="warning">ليست لديك صلاحية عرض نظرة المخزون.</Alert>;

  const metrics = summary?.metrics;
  const shortcuts = [
    { label: 'أرصدة المخزون', to: '/apps/inventory/stock', icon: ShieldCheck, show: true },
    { label: 'الوحدات المتسلسلة', to: '/apps/inventory/unique-units', icon: Boxes, show: can('inventory.read') },
    { label: 'حركات المخزون', to: '/apps/inventory/operations/moves', icon: History, show: canReadMoves },
    { label: 'استلام مخزون', to: '/apps/inventory/stock?action=receive', icon: Plus, show: can('inventory.receive') },
    { label: 'تحويل مخزون', to: '/apps/inventory/stock?action=transfer', icon: ArrowLeftRight, show: can('inventory.transfer') },
  ].filter((item) => item.show);

  return <div className="space-y-6" dir="rtl">
    <PageHeader
      title="نظرة عامة على المخزون"
      description="ملخص تشغيلي للأرصدة والوحدات والحركات ضمن الفروع والمواقع المصرح بها."
      breadcrumbs={getCanonicalBreadcrumbs('/apps/inventory')}
    />

    <nav aria-label="اختصارات المخزون" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {shortcuts.map((item) => <Link key={item.to} to={item.to} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-800 transition hover:border-slate-300 hover:bg-slate-50"><span className="flex items-center gap-2"><item.icon className="h-4 w-4 text-slate-500" />{item.label}</span><ArrowLeft className="h-4 w-4 text-slate-400" /></Link>)}
    </nav>

    {summaryError ? <Alert>{summaryError}</Alert> : null}
    {summaryLoading ? <LoadingSpinner title="جاري تحميل ملخص المخزون" /> : !summaryError && summary ? <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="منتجات لها رصيد" value={metrics.stockedProductCount} icon={Package} tone="bg-slate-100 text-slate-700" />
        <Metric label="الوحدات المتسلسلة" value={metrics.serialUnitCount} icon={Boxes} tone="bg-indigo-50 text-indigo-700" />
        <Metric label="الرصيد المتاح" value={formatNumber(metrics.availableQuantity)} icon={ShieldCheck} tone="bg-emerald-50 text-emerald-700" />
        <Metric label="الرصيد المحجوز" value={formatNumber(metrics.reservedQuantity)} icon={Boxes} tone="bg-amber-50 text-amber-700" />
        <Metric label="إجمالي الرصيد" value={formatNumber(metrics.totalQuantity)} icon={Package} tone="bg-blue-50 text-blue-700" />
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <SmallMetric label="وحدات تحتاج استكمال بيانات" value={metrics.incompleteUnitCount} icon={AlertTriangle} warning={metrics.incompleteUnitCount > 0} />
        <SmallMetric label="وحدات بلا صور" value={metrics.missingImageUnitCount} icon={ImageOff} warning={metrics.missingImageUnitCount > 0} />
        <SmallMetric label="مواقع ضمن نطاقك" value={metrics.locationCount} icon={ShieldCheck} />
      </section>
    </> : null}

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <SectionHeader title="أحدث حركات المخزون" to="/apps/inventory/operations/moves" showLink={canReadMoves} />
        {movesError ? <div className="p-4"><Alert>{movesError}</Alert></div> : movesLoading ? <LoadingSpinner title="جاري تحميل أحدث الحركات" /> : moves.length ? <div className="divide-y divide-slate-100">{moves.map((move) => <MovementRow key={`${move.recordSource}:${move.id}`} move={move} />)}</div> : <Empty message={canReadMoves ? 'لا توجد حركات مسجلة ضمن نطاقك.' : 'صلاحية عرض الحركات غير متاحة.'} />}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <SectionHeader title="وحدات تحتاج متابعة" to="/apps/inventory/unique-units?dataStatus=incomplete" showLink={can('inventory.read')} />
        {summaryLoading ? <LoadingSpinner title="جاري تحميل الوحدات" /> : summary?.attentionUnits?.length ? <div className="divide-y divide-slate-100">{summary.attentionUnits.map((unit) => <AttentionUnit key={unit.id} unit={unit} canOpen={can('inventory.read')} />)}</div> : !summaryError ? <Empty message="لا توجد وحدات تحتاج استكمال بيانات أو صور ضمن نطاقك." /> : null}
      </section>
    </div>
  </div>;
}

function Metric({ label, value, icon: Icon, tone }) { return <div className="rounded-xl border border-slate-200 bg-white p-4"><div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div><p className="mt-3 text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-3xl font-black text-slate-950">{value}</p></div>; }
function SmallMetric({ label, value, icon: Icon, warning = false }) { return <div className={`flex items-center gap-3 rounded-xl border p-4 ${warning ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'}`}><Icon className={`h-5 w-5 ${warning ? 'text-amber-700' : 'text-slate-500'}`} /><div><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-xl font-black text-slate-950">{Number(value || 0).toLocaleString('ar-EG')}</p></div></div>; }
function SectionHeader({ title, to, showLink }) { return <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4"><h2 className="font-black text-slate-950">{title}</h2>{showLink ? <Link to={to} className="inline-flex items-center gap-1 text-sm font-bold text-blue-700">عرض الكل <ArrowLeft className="h-3.5 w-3.5" /></Link> : null}</div>; }
function MovementRow({ move }) { return <div className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[90px_minmax(0,1fr)_100px_150px] sm:items-center"><Badge variant={move.movementType === 'receiving' || move.movementType === 'return' ? 'success' : move.movementType === 'reservation' || move.movementType === 'adjustment' ? 'warning' : 'default'}>{MOVE_LABELS[move.movementType] || move.sourceEventType}</Badge><div className="min-w-0"><p className="truncate font-black text-slate-900">{move.productName || 'منتج غير محدد'}</p><p className="truncate text-xs text-slate-500">{move.destinationLocationName || move.sourceLocationName || 'بدون موقع مسجل'}</p></div><span className="font-bold">{move.trackingUnitId ? move.trackingIdentity || 'Serial' : formatNumber(move.quantity)}</span><time className="text-xs font-semibold text-slate-500">{formatDate(move.occurredAt)}</time></div>; }
function AttentionUnit({ unit, canOpen }) { const content = <><div className="min-w-0"><p className="truncate text-sm font-black text-slate-950">{unit.productName}</p><p className="mt-1 truncate font-mono text-xs text-slate-500" dir="ltr">{unit.trackingNumber || unit.id}</p><p className="mt-1 text-xs text-slate-500">{unit.branchName} — {unit.locationName}</p></div><div className="flex flex-wrap gap-1">{unit.needsData ? <Badge variant="warning">بيانات ناقصة</Badge> : null}{unit.needsImage ? <Badge>بلا صور</Badge> : null}</div></>; return canOpen ? <Link to={`/apps/inventory/unique-units/${unit.id}?returnTo=${encodeURIComponent('/apps/inventory')}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50">{content}</Link> : <div className="flex items-center justify-between gap-3 px-4 py-3">{content}</div>; }
function Empty({ message }) { return <div className="px-4 py-12 text-center text-sm font-bold text-slate-500">{message}</div>; }
function Alert({ children, tone = 'danger' }) { return <div className={`rounded-xl border px-4 py-3 text-sm font-bold ${tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-700'}`}>{children}</div>; }
