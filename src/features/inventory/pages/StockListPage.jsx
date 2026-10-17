import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Layers, Plus, Search } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { PageHeader } from '@/core/ui/page-header';
import { getCanonicalBreadcrumbs } from '@/core/navigation/platformNavigation';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { AddStockDialog } from '@/features/inventory/components/AddStockDialog';
import { TransferInventoryDialog } from '@/features/inventory/components/TransferInventoryDialog';
import { inventoryService } from '@/features/inventory/api/inventory.api';
import { canShowReceivingAction } from '@/features/inventory/receivingUi.model';
import { useStock } from '@/features/inventory/hooks/useStock';
import { productCategoryService } from '@/features/products/api/products.api';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const PAGE_SIZE = 25;

export function StockListPage() {
  const { tenant, tenantUser } = useWorkspace();
  const {
    can, canAccessBranch, canAccessStockLocation, resourceScope,
    isReady: authorizationReady,
  } = useAuthorization();
  const tenantId = tenant?.id;
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const [branchId, setBranchId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [locations, setLocations] = useState([]);
  const [categories, setCategories] = useState([]);
  const [filtersError, setFiltersError] = useState('');
  const defaultsApplied = useRef(false);
  const query = useMemo(() => ({
    branchId: branchId || null,
    locationId: locationId || null,
    categoryId: categoryId || null,
    search: deferredSearch,
    page,
    pageSize: PAGE_SIZE,
  }), [branchId, categoryId, deferredSearch, locationId, page]);
  const {
    stock, products, pagination, isLoading, isProductsLoading, error, reload,
  } = useStock(tenantId, query);
  const [addOpen, setAddOpen] = useState(false);
  const [transferItem, setTransferItem] = useState(null);
  const [receivingNotice, setReceivingNotice] = useState('');
  const canReceive = canShowReceivingAction({
    authorizationReady,
    canReceive: can('inventory.receive'),
  });
  const canTransfer = authorizationReady && can('inventory.transfer');
  const canReadStock = authorizationReady && (
    can('inventory.read') || can('inventory.availability') || canReceive || canTransfer
  );

  useEffect(() => {
    setPage(1);
  }, [deferredSearch]);

  useEffect(() => {
    let mounted = true;
    if (!tenantId || !authorizationReady) return undefined;
    setFiltersError('');
    Promise.all([
      inventoryService.listReceivingLocations({ tenantId }),
      productCategoryService.listCategories(tenantId),
    ]).then(([nextLocations, nextCategories]) => {
      if (!mounted) return;
      const authorizedLocations = nextLocations.filter((location) => (
        canAccessBranch(location.branchId) && canAccessStockLocation(location.id)
      ));
      setLocations(authorizedLocations);
      setCategories(nextCategories.filter((category) => category.isActive));

      if (!defaultsApplied.current) {
        const defaultLocation = authorizedLocations.find((location) => (
          location.id === resourceScope?.defaultStockLocationId
          && (!resourceScope?.defaultBranchId || location.branchId === resourceScope.defaultBranchId)
        ));
        if (defaultLocation) {
          setBranchId(defaultLocation.branchId);
          setLocationId(defaultLocation.id);
        } else if (resourceScope?.defaultBranchId
          && authorizedLocations.some((location) => location.branchId === resourceScope.defaultBranchId)) {
          setBranchId(resourceScope.defaultBranchId);
        }
        defaultsApplied.current = true;
      }
    }).catch((loadError) => {
      if (mounted) setFiltersError(loadError.message || 'تعذر تحميل نطاق المخزون.');
    });
    return () => { mounted = false; };
  }, [authorizationReady, canAccessBranch, canAccessStockLocation, resourceScope?.defaultBranchId, resourceScope?.defaultStockLocationId, tenantId]);

  useEffect(() => {
    defaultsApplied.current = false;
  }, [tenantId]);

  const branches = useMemo(() => {
    const values = new Map();
    locations.forEach((location) => values.set(location.branchId, location.branchName));
    return Array.from(values, ([id, name]) => ({ id, name })).sort((left, right) => left.name.localeCompare(right.name, 'ar'));
  }, [locations]);
  const visibleLocations = useMemo(
    () => locations.filter((location) => !branchId || location.branchId === branchId),
    [branchId, locations],
  );
  const pageCount = Math.max(1, Math.ceil(pagination.total / PAGE_SIZE));
  const selectedScope = locationId
    ? locations.find((location) => location.id === locationId)?.name
    : branchId
      ? branches.find((branch) => branch.id === branchId)?.name
      : 'كل الفروع والمواقع المصرح بها';

  const updateBranch = (value) => {
    setBranchId(value);
    setLocationId('');
    setPage(1);
  };
  const updateLocation = (value) => { setLocationId(value); setPage(1); };
  const updateCategory = (value) => { setCategoryId(value); setPage(1); };

  if (authorizationReady && !canReadStock) {
    return <Alert tone="warning">ليست لديك صلاحية عرض أرصدة المخزون.</Alert>;
  }

  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader
        title="أرصدة المخزون"
        description="الرصيد الكانوني المتاح والمحجوز والإجمالي ضمن الفروع والمواقع المصرح بها."
        breadcrumbs={getCanonicalBreadcrumbs('/apps/inventory/stock')}
        actions={canReceive ? (
          <Button
            type="button"
            disabled={isProductsLoading}
            onClick={() => { setReceivingNotice(''); setAddOpen(true); }}
            className="gap-2 rounded-lg bg-[#17324d] hover:opacity-95"
          >
            <Plus className="h-4 w-4" />
            إضافة مخزون
          </Button>
        ) : null}
      />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_210px_220px_210px]">
          <label className="relative">
            <span className="sr-only">البحث في المخزون</span>
            <Search className="absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pr-10"
              placeholder="اسم المنتج أو الكود أو Barcode"
            />
          </label>
          <FilterSelect ariaLabel="الفرع" value={branchId} onChange={updateBranch}>
            <option value="">كل الفروع المصرح بها</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </FilterSelect>
          <FilterSelect ariaLabel="موقع المخزون" value={locationId} onChange={updateLocation}>
            <option value="">كل المواقع المصرح بها</option>
            {visibleLocations.map((location) => <option key={location.id} value={location.id}>{location.branchName} — {location.name}</option>)}
          </FilterSelect>
          <FilterSelect ariaLabel="التصنيف" value={categoryId} onChange={updateCategory}>
            <option value="">كل التصنيفات</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </FilterSelect>
        </div>
        <p className="mt-3 text-xs font-bold text-slate-500">النطاق الحالي: {selectedScope}</p>
      </section>

      {filtersError ? <Alert>{filtersError}</Alert> : null}
      {error ? <Alert>{error}</Alert> : null}
      {receivingNotice ? <Alert tone="notice">{receivingNotice}</Alert> : null}

      {isLoading ? (
        <LoadingSpinner title="جاري تحميل أرصدة المخزون" />
      ) : !error && stock.length ? (
        <>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="grid grid-cols-[minmax(0,1.5fr)_120px_110px_110px_110px_140px] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 max-lg:hidden">
              <div>المنتج</div>
              <div>نوع التتبع</div>
              <div>المتاح</div>
              <div>المحجوز</div>
              <div>الإجمالي</div>
              <div className="text-left">إجراء</div>
            </div>
            <div className="divide-y divide-slate-100">
              {stock.map((item) => (
                <div key={item.product.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1.5fr)_120px_110px_110px_110px_140px] lg:items-center">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-extrabold text-slate-950">{item.product.displayName || item.product.name}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-500">
                      <span>{item.product.code || 'بدون كود'}</span>
                      {item.product.barcode ? <span dir="ltr">{item.product.barcode}</span> : null}
                    </div>
                  </div>
                  <div><Badge variant={item.product.tracking === 'serial' ? 'accent' : 'default'}>{item.product.tracking === 'serial' ? 'Serial' : 'Quantity'}</Badge></div>
                  <BalanceValue label="المتاح" value={item.availableQuantity} tone="text-emerald-700" />
                  <BalanceValue label="المحجوز" value={item.reservedQuantity} tone="text-amber-700" />
                  <BalanceValue label="الإجمالي" value={item.totalQuantity} tone="text-slate-900" />
                  {canTransfer ? <div className="flex gap-2 lg:justify-self-end">
                    <Button type="button" size="sm" className="gap-2 rounded-lg" onClick={() => setTransferItem(item)}>
                      <ArrowLeftRight className="h-4 w-4" />نقل
                    </Button>
                  </div> : <div />}
                </div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm font-bold text-slate-600">
            <span>{pagination.total.toLocaleString('ar-EG')} منتج</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} aria-label="الصفحة السابقة"><ChevronRight className="h-4 w-4" /></Button>
              <span>{page.toLocaleString('ar-EG')} / {pageCount.toLocaleString('ar-EG')}</span>
              <Button size="sm" variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)} aria-label="الصفحة التالية"><ChevronLeft className="h-4 w-4" /></Button>
            </div>
          </div>
        </>
      ) : !error ? <StockEmptyState hasFilters={Boolean(search || branchId || locationId || categoryId)} /> : null}

      {canReceive ? (
        <AddStockDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          tenantId={tenantId}
          userId={tenantUser?.id}
          products={products}
          onSaved={async (result) => {
            setReceivingNotice(result?.documentationNotice || `تم الاستلام بنجاح${result?.line_count ? ` (${result.line_count} وحدة/بند)` : ''}.`);
            await reload();
          }}
        />
      ) : null}
      {canTransfer ? <TransferInventoryDialog open={Boolean(transferItem)} onOpenChange={(nextOpen) => { if (!nextOpen) setTransferItem(null); }} tenantId={tenantId} item={transferItem} onSaved={reload} /> : null}
    </div>
  );
}

function FilterSelect({ ariaLabel, value, onChange, children }) {
  return <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-slate-200">{children}</select>;
}

function BalanceValue({ label, value, tone }) {
  return <div><span className="ml-2 text-xs font-bold text-slate-400 lg:hidden">{label}</span><span className={`text-sm font-black ${tone}`}>{Number(value).toLocaleString('ar-EG', { maximumFractionDigits: 4 })}</span></div>;
}

function Alert({ children, tone = 'danger' }) {
  const styles = tone === 'notice'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-red-200 bg-red-50 text-red-700';
  return <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${styles}`}>{children}</div>;
}

function StockEmptyState({ hasFilters }) {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center">
      <Layers className="h-10 w-10 text-slate-300" />
      <h3 className="mt-3 text-lg font-extrabold text-slate-950">{hasFilters ? 'لا توجد أرصدة مطابقة' : 'لا يوجد مخزون في نطاقك'}</h3>
      <p className="mt-1 text-sm font-semibold text-slate-500">{hasFilters ? 'جرّب تعديل البحث أو نطاق الفرع والموقع.' : 'يمكنك بدء الاستلام إذا كانت لديك الصلاحية.'}</p>
    </div>
  );
}
