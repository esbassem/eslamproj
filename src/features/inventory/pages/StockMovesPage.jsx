import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ChevronLeft, ChevronRight, History, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { PageHeader } from '@/core/ui/page-header';
import { getCanonicalBreadcrumbs } from '@/core/navigation/platformNavigation';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { inventoryService } from '@/features/inventory/api/inventory.api';

const PAGE_SIZE = 25;
const MOVEMENT_TYPES = [
  { value: '', label: 'كل أنواع الحركات' },
  { value: 'receiving', label: 'استلام' },
  { value: 'transfer', label: 'تحويل' },
  { value: 'reservation', label: 'حجز وتحرير' },
  { value: 'delivery', label: 'تسليم' },
  { value: 'return', label: 'مرتجع' },
  { value: 'adjustment', label: 'تسوية' },
  { value: 'opening', label: 'رصيد افتتاحي' },
];
const EVENT_LABELS = {
  received: 'استلام', receive: 'استلام', in: 'إضافة مخزون',
  transferred: 'تحويل', transfer: 'تحويل',
  reserved: 'حجز', reserve: 'حجز', reservation_released: 'تحرير حجز', release: 'تحرير حجز',
  delivered: 'تسليم', out: 'صرف / تسليم', delivery_corrected: 'تصحيح تسليم',
  returned: 'مرتجع', return: 'مرتجع', return_review_released: 'اعتماد مرتجع',
  return_review_release_corrected: 'تصحيح اعتماد مرتجع', return_corrected: 'تصحيح مرتجع',
  adjustment_posted: 'تسوية جرد', adjustment_reversed: 'عكس تسوية', adjustment: 'تسوية', inventory: 'تسوية مخزون',
  receipt_corrected: 'تصحيح استلام', opening_adopted: 'رصيد افتتاحي',
};
const STATE_LABELS = {
  posted: 'مرحّلة', committed: 'منفذة', received: 'مستلمة', active: 'نشطة',
  partially_delivered: 'تسليم جزئي', completed: 'مكتملة', released: 'محررة',
  returned: 'مرتجعة', partially_returned: 'مرتجع جزئي', confirmed: 'مؤكدة', cancelled: 'ملغاة',
};

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export function StockMovesPage() {
  const { can, isReady: authorizationReady } = useAuthorization();
  const [searchParams, setSearchParams] = useSearchParams();
  const [result, setResult] = useState({ items: [], locations: [], total: 0, page: 1, pageSize: PAGE_SIZE });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const search = searchParams.get('q') || '';
  const deferredSearch = useDeferredValue(search.trim());
  const branchId = searchParams.get('branch') || '';
  const locationId = searchParams.get('location') || '';
  const movementType = searchParams.get('type') || '';
  const dateFrom = searchParams.get('from') || '';
  const dateTo = searchParams.get('to') || '';
  const page = Math.max(Number(searchParams.get('page')) || 1, 1);
  const canRead = authorizationReady && (can('inventory.read') || can('inventory.availability'));

  useEffect(() => {
    let mounted = true;
    if (!canRead) return undefined;
    setIsLoading(true);
    setError('');
    inventoryService.listStockMovements({
      search: deferredSearch, branchId, locationId, movementType,
      dateFrom, dateTo, page, pageSize: PAGE_SIZE,
    }).then((nextResult) => {
      if (mounted) setResult(nextResult);
    }).catch((loadError) => {
      if (mounted) {
        setResult((current) => ({ ...current, items: [], total: 0 }));
        setError(loadError.message || 'تعذر تحميل حركات المخزون.');
      }
    }).finally(() => { if (mounted) setIsLoading(false); });
    return () => { mounted = false; };
  }, [branchId, canRead, dateFrom, dateTo, deferredSearch, locationId, movementType, page]);

  const branches = useMemo(() => {
    const values = new Map(result.locations.map((location) => [location.branchId, location.branchName]));
    return Array.from(values, ([id, name]) => ({ id, name }));
  }, [result.locations]);
  const locations = useMemo(
    () => result.locations.filter((location) => !branchId || location.branchId === branchId),
    [branchId, result.locations],
  );
  const pageCount = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const hasFilters = Boolean(search || branchId || locationId || movementType || dateFrom || dateTo);

  const updateFilter = (key, value, { resetLocation = false } = {}) => {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value); else params.delete(key);
    params.delete('page');
    if (resetLocation) params.delete('location');
    setSearchParams(params, { replace: true });
  };
  const updatePage = (nextPage) => {
    const params = new URLSearchParams(searchParams);
    if (nextPage > 1) params.set('page', String(nextPage)); else params.delete('page');
    setSearchParams(params);
  };

  if (!authorizationReady) {
    return <LoadingSpinner title="جاري التحقق من صلاحية حركات المخزون" />;
  }
  if (authorizationReady && !canRead) {
    return <Alert tone="warning">ليست لديك صلاحية عرض حركات المخزون.</Alert>;
  }

  return <div className="space-y-5" dir="rtl">
    <PageHeader
      title="حركات المخزون"
      description="السجل التشغيلي لحركات المخزون ضمن الفروع والمواقع المصرح بها."
      breadcrumbs={getCanonicalBreadcrumbs('/apps/inventory/operations/moves')}
    />

    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="grid gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <label className="relative lg:col-span-2 xl:col-span-2">
          <span className="sr-only">البحث في حركات المخزون</span>
          <Search className="absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
          <Input value={search} onChange={(event) => updateFilter('q', event.target.value)} className="pr-10" placeholder="المنتج أو الكود أو هوية التتبع" />
        </label>
        <FilterSelect label="الفرع" value={branchId} onChange={(value) => updateFilter('branch', value, { resetLocation: true })}>
          <option value="">كل الفروع المصرح بها</option>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </FilterSelect>
        <FilterSelect label="الموقع" value={locationId} onChange={(value) => updateFilter('location', value)}>
          <option value="">كل المواقع المصرح بها</option>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.branchName} — {location.name}</option>)}
        </FilterSelect>
        <FilterSelect label="نوع الحركة" value={movementType} onChange={(value) => updateFilter('type', value)}>
          {MOVEMENT_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </FilterSelect>
        <div className="grid grid-cols-2 gap-2 xl:col-span-1">
          <DateInput label="من" value={dateFrom} onChange={(value) => updateFilter('from', value)} />
          <DateInput label="إلى" value={dateTo} onChange={(value) => updateFilter('to', value)} />
        </div>
      </div>
      {hasFilters ? <div className="mt-3 flex justify-end"><Button type="button" size="sm" variant="ghost" onClick={() => setSearchParams({}, { replace: true })}>مسح الفلاتر</Button></div> : null}
    </section>

    {error ? <Alert>{error}</Alert> : null}
    {isLoading ? <LoadingSpinner title="جاري تحميل حركات المخزون" /> : !error && result.items.length ? <>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[150px_minmax(180px,1.4fr)_125px_minmax(160px,1fr)_minmax(160px,1fr)_150px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 max-xl:hidden">
          <div>التاريخ والنوع</div><div>المنتج</div><div>الوحدة / الكمية</div><div>المصدر</div><div>الوجهة</div><div>المرجع</div>
        </div>
        <div className="divide-y divide-slate-100">{result.items.map((move) => <MovementRow key={`${move.recordSource}-${move.id}`} move={move} />)}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm font-bold text-slate-600">
        <span>{result.total.toLocaleString('ar-EG')} حركة</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => updatePage(page - 1)} aria-label="الصفحة السابقة"><ChevronRight className="h-4 w-4" /></Button>
          <span>{page.toLocaleString('ar-EG')} / {pageCount.toLocaleString('ar-EG')}</span>
          <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => updatePage(page + 1)} aria-label="الصفحة التالية"><ChevronLeft className="h-4 w-4" /></Button>
        </div>
      </div>
    </> : !error ? <EmptyState hasFilters={hasFilters} /> : null}
  </div>;
}

function MovementRow({ move }) {
  const serial = move.trackingUnitId && move.trackingMode === 'serial';
  return <article className="grid gap-3 px-4 py-4 xl:grid-cols-[150px_minmax(180px,1.4fr)_125px_minmax(160px,1fr)_minmax(160px,1fr)_150px] xl:items-center">
    <div><MoveBadge type={move.movementType} label={EVENT_LABELS[move.sourceEventType] || move.sourceEventType} /><p className="mt-2 text-xs font-semibold text-slate-500">{formatDate(move.occurredAt)}</p></div>
    <div className="min-w-0"><p className="truncate text-sm font-black text-slate-950">{move.productName || '-'}</p><p className="mt-1 truncate text-xs font-semibold text-slate-500">{move.productCode || move.productBarcode || 'بدون كود'}</p></div>
    <div>{serial ? <Link to={`/apps/inventory/unique-units/${move.trackingUnitId}`} className="inline-flex max-w-full items-center gap-1 font-mono text-sm font-bold text-blue-700"><span className="truncate" dir="ltr">{move.trackingIdentity || 'Serial'}</span><ArrowLeft className="h-3.5 w-3.5 flex-none" /></Link> : <p className="text-sm font-black">{Number(move.quantity).toLocaleString('ar-EG', { maximumFractionDigits: 4 })}</p>}</div>
    <LocationValue label="المصدر" branch={move.sourceBranchName} location={move.sourceLocationName} />
    <LocationValue label="الوجهة" branch={move.destinationBranchName} location={move.destinationLocationName} />
    <div className="min-w-0 text-xs"><p className="truncate font-bold text-slate-700" title={move.referenceId || ''}>{move.referenceId || 'بدون مرجع'}</p><p className="mt-1 truncate text-slate-500">{move.referenceType || move.recordSource}</p>{move.operationState ? <Badge className="mt-2" variant="default">{STATE_LABELS[move.operationState] || move.operationState}</Badge> : null}{move.routePath ? <Link to={move.routePath} className="mt-2 inline-flex items-center gap-1 font-bold text-blue-700">فتح العملية <ArrowLeft className="h-3.5 w-3.5" /></Link> : null}</div>
  </article>;
}
function MoveBadge({ type, label }) { const variant = type === 'receiving' || type === 'return' ? 'success' : type === 'reservation' || type === 'adjustment' ? 'warning' : 'default'; return <Badge variant={variant}>{label}</Badge>; }
function LocationValue({ label, branch, location }) { return <div className="min-w-0"><span className="ml-2 text-xs font-bold text-slate-400 xl:hidden">{label}</span>{location ? <><p className="truncate text-sm font-bold text-slate-800">{location}</p><p className="mt-1 truncate text-xs text-slate-500">{branch || '-'}</p></> : <span className="text-sm text-slate-400">—</span>}</div>; }
function FilterSelect({ label, value, onChange, children }) { return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-slate-200">{children}</select>; }
function DateInput({ label, value, onChange }) { return <label className="relative"><span className="absolute right-2 top-3.5 text-[10px] font-bold text-slate-400">{label}</span><Input type="date" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="pr-7 text-xs" /></label>; }
function Alert({ children, tone = 'danger' }) { const style = tone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-700'; return <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${style}`}>{children}</div>; }
function EmptyState({ hasFilters }) { return <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center"><History className="h-10 w-10 text-slate-300" /><h3 className="mt-3 text-lg font-black text-slate-950">{hasFilters ? 'لا توجد حركات مطابقة' : 'لا توجد حركات في نطاقك'}</h3><p className="mt-1 text-sm font-semibold text-slate-500">{hasFilters ? 'جرّب تعديل البحث أو الفلاتر.' : 'ستظهر الحركات المسجلة فعليًا عند توفرها.'}</p><ArrowDownToLine className="mt-4 h-5 w-5 text-slate-300" /></div>; }
