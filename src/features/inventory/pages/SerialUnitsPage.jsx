import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Eye, Hash, Search } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { inventoryService } from '@/features/inventory/api/inventory.api';
import { CompleteTrackingUnitWizard } from '@/features/inventory/components/CompleteTrackingUnitWizard';
import { useSerialUnits } from '@/features/inventory/hooks/useSerialUnits';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const PAGE_SIZE = 20;
const STATUS_OPTIONS = [
  { value: 'all', label: 'كل الحالات' }, { value: 'in_stock', label: 'متاحة' },
  { value: 'reserved', label: 'محجوزة' }, { value: 'sold', label: 'مباعة' },
];
const DATA_STATUS_OPTIONS = [
  { value: 'all', label: 'كل القطع' }, { value: 'complete', label: 'مكتملة' },
  { value: 'incomplete', label: 'غير مكتملة' }, { value: 'needs_review', label: 'تحتاج مراجعة' },
];

export function SerialUnitsPage() {
  const { tenant } = useWorkspace();
  const tenantId = tenant?.id;
  const [filters, setFilters] = useState({ productId: 'all', status: 'all', dataStatus: 'all', search: '' });
  const [page, setPage] = useState(1);
  const [completionUnit, setCompletionUnit] = useState(null);
  const [details, setDetails] = useState({ open: false, unit: null, data: null, loading: false, error: '' });
  const { serialUnits, products, isLoading, error, reload } = useSerialUnits(tenantId, filters);
  const filteredUnits = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    if (!query) return serialUnits;
    return serialUnits.filter((unit) => `${unit.trackingNumber} ${unit.chassisNumber} ${unit.engineNumber} ${unit.attributesText} ${unit.product?.name || ''} ${unit.product?.code || ''}`.toLowerCase().includes(query));
  }, [filters.search, serialUnits]);
  const pageCount = Math.max(1, Math.ceil(filteredUnits.length / PAGE_SIZE));
  const visibleUnits = filteredUnits.slice((Math.min(page, pageCount) - 1) * PAGE_SIZE, Math.min(page, pageCount) * PAGE_SIZE);

  const updateFilter = (key, value) => { setPage(1); setFilters((current) => ({ ...current, [key]: value })); };
  const openDetails = async (unit) => {
    setDetails({ open: true, unit, data: null, loading: true, error: '' });
    try {
      const data = await inventoryService.getTrackingUnitDetails({ tenantId, trackingUnitId: unit.id });
      setDetails({ open: true, unit, data, loading: false, error: '' });
    } catch (loadError) {
      setDetails({ open: true, unit, data: null, loading: false, error: loadError.message || 'تعذر تحميل تفاصيل القطعة.' });
    }
  };

  return <div className="space-y-5" dir="rtl">
    <header><h1 className="text-2xl font-black text-slate-950">القطع الفريدة</h1><p className="mt-1 text-sm font-semibold text-slate-500">كل وحدة فعلية ذات رقم شاسيه أو هوية مستقلة، مرتبطة بتعريف المنتج.</p></header>
    <div className="grid gap-2 lg:grid-cols-[minmax(240px,1fr)_220px_180px_180px]">
      <label className="relative"><Search className="absolute right-3 top-3.5 h-4 w-4 text-slate-400" /><Input value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} className="pr-10" placeholder="ابحث بالمنتج أو رقم القطعة..." /></label>
      <Select value={filters.productId} onChange={(value) => updateFilter('productId', value)}><option value="all">كل المنتجات</option>{products.filter((product) => product.tracking === 'serial').map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</Select>
      <Select value={filters.status} onChange={(value) => updateFilter('status', value)}>{STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
      <Select value={filters.dataStatus} onChange={(value) => updateFilter('dataStatus', value)}>{DATA_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>
    </div>
    {error ? <Alert>{error}</Alert> : null}
    {isLoading ? <LoadingSpinner title="جاري تحميل القطع الفريدة" /> : visibleUnits.length ? <>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="grid grid-cols-[minmax(180px,1.3fr)_170px_150px_120px_130px_110px_80px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 max-xl:hidden"><div>المنتج والخصائص</div><div>رقم الشاسيه</div><div>رقم الموتور</div><div>الحالة</div><div>الموقع الحالي</div><div>تاريخ الإنشاء</div><div>تفاصيل</div></div>
        <div className="divide-y divide-slate-100">{visibleUnits.map((unit) => <div key={unit.id} className="grid gap-3 px-4 py-4 xl:grid-cols-[minmax(180px,1.3fr)_170px_150px_120px_130px_110px_80px] xl:items-center">
          <div><p className="truncate text-sm font-black text-slate-950">{unit.isIncomplete ? 'قطعة غير مكتملة' : unit.product?.name || '-'}</p><p className="mt-1 truncate text-xs text-slate-500" title={unit.attributesText}>{unit.attributesText || unit.product?.code || 'بدون خصائص'}</p></div>
          <span className="font-mono text-sm font-bold" dir="ltr">{unit.chassisNumber || unit.trackingNumber}</span><span className="font-mono text-sm font-bold" dir="ltr">{unit.engineNumber || '-'}</span><StatusBadge status={unit.status} />
          <span className="text-sm text-slate-500">غير محدد</span><span className="text-sm text-slate-500">{unit.createdAt ? new Date(unit.createdAt).toLocaleDateString('ar-EG') : '-'}</span>
          <div className="flex gap-2"><Button type="button" size="sm" variant="secondary" onClick={() => openDetails(unit)}><Eye className="h-4 w-4" /></Button>{unit.isIncomplete ? <Button type="button" size="sm" variant="secondary" onClick={() => setCompletionUnit(unit)}>استكمال</Button> : null}</div>
        </div>)}</div>
      </div>
      <div className="flex items-center justify-between text-sm font-bold text-slate-600"><span>{filteredUnits.length.toLocaleString('ar-EG')} قطعة</span><div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}><ChevronRight className="h-4 w-4" /></Button><span>{Math.min(page, pageCount)} / {pageCount}</span><Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronLeft className="h-4 w-4" /></Button></div></div>
    </> : <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center"><Hash className="h-10 w-10 text-slate-300" /><h3 className="mt-3 text-lg font-black">لا توجد قطع مطابقة</h3></div>}
    <TrackingUnitDetails details={details} onOpenChange={(open) => setDetails((current) => ({ ...current, open }))} />
    <CompleteTrackingUnitWizard open={Boolean(completionUnit)} onOpenChange={(open) => { if (!open) setCompletionUnit(null); }} tenantId={tenantId} unit={completionUnit} onCompleted={reload} />
  </div>;
}

function TrackingUnitDetails({ details, onOpenChange }) {
  const unit = details.unit;
  return <Sheet open={details.open} onOpenChange={onOpenChange}><SheetContent side="left" className="max-w-xl" dir="rtl"><SheetDismissButton /><SheetHeader><SheetTitle>تفاصيل القطعة الفريدة</SheetTitle></SheetHeader><SheetBody className="space-y-5">
    {details.loading ? <LoadingSpinner title="جاري تحميل التفاصيل" /> : details.error ? <Alert>{details.error}</Alert> : unit ? <>
      <div className="grid gap-3 sm:grid-cols-2"><Detail label="المنتج" value={unit.product?.name || '-'} /><Detail label="رقم القطعة" value={unit.trackingNumber} ltr /><Detail label="الحالة" value={STATUS_OPTIONS.find((option) => option.value === unit.status)?.label || unit.status} /><Detail label="الموقع الحالي" value="غير محدد في النظام" /></div>
      <DetailsBlock title="أرقام التعريف" rows={details.data?.identifiers} /><DetailsBlock title="الخصائص" rows={details.data?.attributes} />
    </> : null}
  </SheetBody></SheetContent></Sheet>;
}
function DetailsBlock({ title, rows = [] }) { return <section><h3 className="mb-2 font-black">{title}</h3><div className="divide-y divide-slate-100 rounded-xl border border-slate-200">{rows.length ? rows.map((row) => <div key={`${row.id}-${row.value}`} className="flex justify-between gap-4 px-3 py-2 text-sm"><span className="font-bold text-slate-500">{row.name}</span><span className="font-black">{row.value}</span></div>) : <p className="p-3 text-sm text-slate-500">لا توجد بيانات.</p>}</div></section>; }
function Detail({ label, value, ltr }) { return <div className="rounded-xl border border-slate-200 p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 font-black" dir={ltr ? 'ltr' : undefined}>{value}</p></div>; }
function Select({ value, onChange, children }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-slate-200">{children}</select>; }
function StatusBadge({ status }) { const label = STATUS_OPTIONS.find((option) => option.value === status)?.label || status; return <div><Badge variant={status === 'in_stock' ? 'success' : status === 'reserved' ? 'warning' : 'default'}>{label}</Badge></div>; }
function Alert({ children }) { return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{children}</div>; }
