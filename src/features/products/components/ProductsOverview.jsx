import { useEffect, useMemo, useState } from 'react';
import {
  Eye,
  PackageSearch,
  Pencil,
  Plus,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import {
  productAttributeService,
  productAttributeValueService,
  productCategoryService,
  productTrackingIdentifierService,
  productsService,
} from '@/features/products/api/products.api';
import { AttributeFormSheet } from '@/features/products/components/AttributeFormSheet';
import { AttributeValueFormSheet } from '@/features/products/components/AttributeValueFormSheet';
import { CategoryFormSheet } from '@/features/products/components/CategoryFormSheet';
import { ProductDetailsSheet } from '@/features/products/components/ProductDetailsSheet';
import { ProductFormSheet } from '@/features/products/components/ProductFormSheet';
import { TrackingIdentifierFormSheet } from '@/features/products/components/TrackingIdentifierFormSheet';
import { useProductsData } from '@/features/products/hooks/useProductsData';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export const PRODUCT_VIEWS = {
  products: 'products',
  attributes: 'attributes',
  values: 'values',
  trackingIdentifiers: 'trackingIdentifiers',
};

const TRACKING_TYPES = [
  { value: 'none', label: 'بدون تتبع' },
  { value: 'serial', label: 'سيريال' },
  { value: 'lot', label: 'دفعات' },
];

function byId(records) {
  return new Map(records.map((record) => [record.id, record]));
}

function formatMoney(value) {
  return new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(new Date(value));
}

function labelFrom(options, value, fallback = '-') {
  return options.find((option) => option.value === value)?.label ?? fallback;
}

function matchesBoolean(value, filter) {
  if (filter === 'all') return true;
  return String(Boolean(value)) === filter;
}

function getProductSearchText(product) {
  return [product.name, product.internalReference, product.barcode].filter(Boolean).join(' ').toLowerCase();
}

export function ProductsOverview({ initialView = PRODUCT_VIEWS.products }) {
  const { tenant } = useWorkspace();
  const tenantId = tenant?.id;
  const {
    products,
    categories,
    attributes,
    attributeValues,
    trackingIdentifierTypes,
    isLoading,
    error,
    reload,
  } = useProductsData(tenantId);
  const [activeView, setActiveView] = useState(initialView);
  const [productFilters, setProductFilters] = useState({
    search: '',
    categoryId: 'all',
    productType: 'all',
    isActive: 'all',
  });
  const [productSheet, setProductSheet] = useState({ open: false, product: null });
  const [detailsSheet, setDetailsSheet] = useState({ open: false, product: null, details: null, loading: false });
  const [recordSheet, setRecordSheet] = useState({ open: false, type: '', record: null });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState(null);
  const categoriesById = useMemo(() => byId(categories), [categories]);
  const attributesById = useMemo(() => byId(attributes), [attributes]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    setActiveView(initialView);
  }, [initialView]);

  const showToast = (message, tone = 'danger') => {
    setToast({ message, tone });
  };

  const filteredProducts = useMemo(() => {
    const search = productFilters.search.trim().toLowerCase();

    return products.filter((product) => {
      if (search && !getProductSearchText(product).includes(search)) return false;
      if (productFilters.categoryId !== 'all' && product.categoryId !== productFilters.categoryId) return false;
      if (productFilters.productType !== 'all' && product.productType !== productFilters.productType) return false;
      if (!matchesBoolean(product.isActive, productFilters.isActive)) return false;
      return true;
    });
  }, [productFilters, products]);

  const handleProductSubmit = async (payload) => {
    if (!tenantId) return { error: 'لا يوجد tenant نشط.' };

    setIsSubmitting(true);
    setToast(null);

    try {
      if (productSheet.product) {
        await productsService.updateProduct({ id: productSheet.product.id, payload });
      } else {
        await productsService.createProduct({ tenantId, payload });
      }

      setProductSheet({ open: false, product: null });
      await reload();
      return null;
    } catch (submitError) {
      return { error: submitError.message || 'تعذر حفظ المنتج.' };
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleProduct = async (product) => {
    setToast(null);
    setIsSubmitting(true);

    try {
      await productsService.toggleProduct(product.id, !product.isActive);
      await reload();
    } catch (toggleError) {
      showToast(toggleError.message || 'تعذر تغيير حالة المنتج.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteProduct = async (product) => {
    if (!window.confirm(`حذف المنتج "${product.name}"؟`)) {
      return;
    }

    setToast(null);
    setIsSubmitting(true);

    try {
      await productsService.deleteProduct(product.id);
      await reload();
      showToast('تم حذف المنتج.', 'success');
    } catch (deleteError) {
      showToast(deleteError.message || 'تعذر حذف المنتج.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleViewProduct = async (product) => {
    if (!tenantId) return;

    setDetailsSheet({ open: true, product, details: null, loading: true });

    try {
      const details = await productsService.getProductDetails({ tenantId, productId: product.id });
      setDetailsSheet({ open: true, product, details, loading: false });
    } catch {
      setDetailsSheet({ open: true, product, details: null, loading: false });
    }
  };

  const handleRecordSubmit = async (payload) => {
    if (!tenantId) return { error: 'لا يوجد tenant نشط.' };

    setIsSubmitting(true);
    setToast(null);

    try {
      if (recordSheet.type === 'category') {
        await productCategoryService.saveCategory({ tenantId, id: recordSheet.record?.id, payload });
      }
      if (recordSheet.type === 'attribute') {
        await productAttributeService.saveAttribute({ tenantId, id: recordSheet.record?.id, payload });
      }
      if (recordSheet.type === 'value') {
        await productAttributeValueService.saveValue({ tenantId, id: recordSheet.record?.id, payload });
      }
      if (recordSheet.type === 'trackingIdentifier') {
        await productTrackingIdentifierService.saveType({ tenantId, id: recordSheet.record?.id, payload });
      }

      setRecordSheet({ open: false, type: '', record: null });
      await reload();
      return null;
    } catch (submitError) {
      return { error: submitError.message || 'تعذر الحفظ.' };
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleRecord = async (type, record) => {
    setToast(null);
    setIsSubmitting(true);

    try {
      if (type === 'category') await productCategoryService.toggleCategory(record.id, !record.isActive);
      if (type === 'attribute') await productAttributeService.toggleAttribute(record.id, !record.isActive);
      if (type === 'value') await productAttributeValueService.toggleValue(record.id, !record.isActive);
      if (type === 'trackingIdentifier') await productTrackingIdentifierService.toggleType({ tenantId, id: record.id, isActive: !record.isActive });
      await reload();
    } catch (toggleError) {
      showToast(toggleError.message || 'تعذر تغيير الحالة.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteTrackingIdentifier = async (trackingIdentifier) => {
    if (!tenantId) return;

    if (!window.confirm(`حذف تعريف التتبع "${trackingIdentifier.name}"؟`)) {
      return;
    }

    setToast(null);
    setIsSubmitting(true);

    try {
      await productTrackingIdentifierService.deleteType({ tenantId, id: trackingIdentifier.id });
      await reload();
      showToast('تم حذف تعريف التتبع.', 'success');
    } catch (deleteError) {
      showToast(deleteError.message || 'تعذر حذف تعريف التتبع.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteCategory = async (category) => {
    if (!tenantId) return;

    const hasProducts = products.some((product) => product.categoryId === category.id);
    const hasChildren = categories.some((item) => item.parentId === category.id);

    if (hasProducts) {
      showToast('لا يمكن حذف التصنيف لأنه يحتوي على منتجات. انقل المنتجات لتصنيف آخر أولًا.');
      return;
    }

    if (hasChildren) {
      showToast('لا يمكن حذف التصنيف لأنه يحتوي على تصنيفات فرعية.');
      return;
    }

    if (!window.confirm(`حذف تصنيف "${category.name}"؟`)) {
      return;
    }

    setToast(null);
    setIsSubmitting(true);

    try {
      await productCategoryService.deleteCategory(category.id);
      setProductFilters((current) => (current.categoryId === category.id ? { ...current, categoryId: 'all' } : current));
      await reload();
    } catch (deleteError) {
      showToast(deleteError.message || 'تعذر حذف التصنيف.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteAttribute = async (attribute) => {
    if (!window.confirm(`حذف الخاصية "${attribute.name}"؟`)) {
      return;
    }

    setToast(null);
    setIsSubmitting(true);

    try {
      await productAttributeService.deleteAttribute(attribute.id);
      await reload();
      showToast('تم حذف الخاصية.', 'success');
    } catch (deleteError) {
      showToast(deleteError.message || 'تعذر حذف الخاصية.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)]" dir="rtl">
      <div className="relative p-6">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {isLoading ? (
          <LoadingSpinner title="جاري تحميل المنتجات" className="min-h-[calc(100vh-7rem)]" />
        ) : activeView === PRODUCT_VIEWS.products ? (
          <ProductsView
            products={filteredProducts}
            allProducts={products}
            filters={productFilters}
            setFilters={setProductFilters}
            categories={categories}
            categoriesById={categoriesById}
            onAdd={() => setProductSheet({ open: true, product: null })}
            onAddCategory={() => setRecordSheet({ open: true, type: 'category', record: null })}
            onEditCategory={(category) => setRecordSheet({ open: true, type: 'category', record: category })}
            onDeleteCategory={handleDeleteCategory}
            onEdit={(product) => setProductSheet({ open: true, product })}
            onView={handleViewProduct}
            onToggle={handleToggleProduct}
            onDelete={handleDeleteProduct}
            disabled={isSubmitting}
          />
        ) : activeView === PRODUCT_VIEWS.attributes ? (
          <AttributesView
            attributes={attributes}
            onAdd={() => setRecordSheet({ open: true, type: 'attribute', record: null })}
            onEdit={(record) => setRecordSheet({ open: true, type: 'attribute', record })}
            onToggle={(record) => handleToggleRecord('attribute', record)}
            onDelete={handleDeleteAttribute}
            disabled={isSubmitting}
          />
        ) : activeView === PRODUCT_VIEWS.values ? (
          <AttributeValuesView
            values={attributeValues}
            attributesById={attributesById}
            onAdd={() => setRecordSheet({ open: true, type: 'value', record: null })}
            onEdit={(record) => setRecordSheet({ open: true, type: 'value', record })}
            onToggle={(record) => handleToggleRecord('value', record)}
            disabled={isSubmitting}
          />
        ) : (
          <TrackingIdentifiersView
            trackingIdentifiers={trackingIdentifierTypes}
            onAdd={() => setRecordSheet({ open: true, type: 'trackingIdentifier', record: null })}
            onEdit={(record) => setRecordSheet({ open: true, type: 'trackingIdentifier', record })}
            onToggle={(record) => handleToggleRecord('trackingIdentifier', record)}
            onDelete={handleDeleteTrackingIdentifier}
            disabled={isSubmitting}
          />
        )}
      </div>

      <ProductFormSheet
        open={productSheet.open}
        onOpenChange={(open) => setProductSheet((current) => ({ ...current, open }))}
        tenantId={tenantId}
        product={productSheet.product}
        categories={categories}
        onSubmit={handleProductSubmit}
        isSubmitting={isSubmitting}
      />

      <CategoryFormSheet
        open={recordSheet.open && recordSheet.type === 'category'}
        onOpenChange={(open) => setRecordSheet((current) => ({ ...current, open: open && current.type === 'category' }))}
        record={recordSheet.type === 'category' ? recordSheet.record : null}
        categories={categories}
        attributes={attributes}
        trackingIdentifierTypes={trackingIdentifierTypes}
        onSubmit={handleRecordSubmit}
        isSubmitting={isSubmitting}
      />

      <AttributeFormSheet
        open={recordSheet.open && recordSheet.type === 'attribute'}
        onOpenChange={(open) => setRecordSheet((current) => ({ ...current, open: open && current.type === 'attribute' }))}
        record={recordSheet.type === 'attribute' ? recordSheet.record : null}
        categories={categories}
        onSubmit={handleRecordSubmit}
        isSubmitting={isSubmitting}
      />

      <ProductDetailsSheet
        open={detailsSheet.open}
        onOpenChange={(open) => setDetailsSheet((current) => ({ ...current, open }))}
        details={detailsSheet.details}
        isLoading={detailsSheet.loading}
      />

      {recordSheet.type === 'value' ? (
        <AttributeValueFormSheet
          open={recordSheet.open}
          onOpenChange={(open) => setRecordSheet((current) => ({ ...current, open }))}
          record={recordSheet.record}
          attributes={attributes}
          onSubmit={handleRecordSubmit}
          isSubmitting={isSubmitting}
        />
      ) : null}

      {recordSheet.type === 'trackingIdentifier' ? (
        <TrackingIdentifierFormSheet
          open={recordSheet.open}
          onOpenChange={(open) => setRecordSheet((current) => ({ ...current, open }))}
          record={recordSheet.record}
          onSubmit={handleRecordSubmit}
          isSubmitting={isSubmitting}
        />
      ) : null}

      <FloatingNotice notice={toast} onClose={() => setToast(null)} />
    </div>
  );
}

function ProductsView({
  products,
  allProducts,
  filters,
  setFilters,
  categories,
  categoriesById,
  onAdd,
  onAddCategory,
  onEditCategory,
  onDeleteCategory,
  onEdit,
  onView,
  onToggle,
  onDelete,
  disabled,
}) {
  const categoryCounts = useMemo(() => {
    return allProducts.reduce((counts, product) => {
      const key = product.categoryId || 'uncategorized';
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map());
  }, [allProducts]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="كل المنتجات"
        description="عرض وإدارة المنتجات والتصنيفات المرتبطة بها"
        count={products.length}
        actionLabel="إضافة منتج"
        onAction={onAdd}
      />

      <div className="border-b-2 border-slate-200 pb-5">
        <CategoryStrip
          categories={categories}
          counts={categoryCounts}
          activeCategoryId={filters.categoryId}
          onSelect={(value) => setFilters((current) => ({ ...current, categoryId: value }))}
          onAddCategory={onAddCategory}
          onEditCategory={onEditCategory}
          onDeleteCategory={onDeleteCategory}
        />
      </div>

      {!products.length ? (
        <TableWrap
          empty
          emptyTitle="لا توجد منتجات مطابقة"
          emptyDescription="غيّر التصنيف أو أضف منتجًا جديدًا ليظهر هنا."
          actionLabel="إضافة منتج"
          onAction={onAdd}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="grid grid-cols-[minmax(0,1.8fr)_160px_190px_120px_170px] gap-3 border-b-2 border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500 max-lg:hidden">
            <div>المنتج</div>
            <div>التصنيف</div>
            <div>التشغيل</div>
            <div>الحالة</div>
            <div className="text-left">إجراءات</div>
          </div>

          <div className="divide-y divide-slate-100">
            {products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                categoryName={categoriesById.get(product.categoryId)?.name ?? 'بدون تصنيف'}
                onView={() => onView(product)}
                onEdit={() => onEdit(product)}
                onToggle={() => onToggle(product)}
                onDelete={() => onDelete(product)}
                disabled={disabled}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CategoryStrip({ categories, counts, activeCategoryId, onSelect, onAddCategory, onEditCategory, onDeleteCategory, tone = 'light' }) {
  const isDark = tone === 'dark';
  const totalCount = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);

  return (
    <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-6">
        <CategoryCard
          title="الكل"
          count={totalCount}
          active={activeCategoryId === 'all'}
          tone={tone}
          onClick={() => onSelect('all')}
        />

        {categories.map((category) => (
          <CategoryCard
            key={category.id}
            title={category.name}
            count={counts.get(category.id) ?? 0}
            active={activeCategoryId === category.id}
            muted={!category.isActive}
            tone={tone}
            onClick={() => onSelect(category.id)}
            onEdit={activeCategoryId === category.id ? () => onEditCategory?.(category) : null}
            onDelete={activeCategoryId === category.id ? () => onDeleteCategory?.(category) : null}
          />
        ))}

      <button
        type="button"
        onClick={onAddCategory}
        className={`flex min-h-[68px] items-center justify-center rounded-lg border border-dashed px-3 text-xs font-bold transition ${
          isDark
            ? 'border-white/14 bg-white/8 text-white hover:border-white/24 hover:bg-white/12'
            : 'border-slate-300 bg-slate-50 text-slate-600 hover:border-[rgb(2,27,76)] hover:bg-white hover:text-[rgb(2,27,76)]'
        }`}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <Plus className="h-4 w-4" />
          <span>إضافة تصنيف</span>
        </div>
      </button>
    </div>
  );
}

function CategoryCard({ title, count, active = false, muted = false, onClick, onEdit, onDelete, tone = 'light' }) {
  const isDark = tone === 'dark';

  return (
    <div
      className={`relative min-h-[68px] rounded-lg border px-3 py-2.5 transition ${
        isDark
          ? active
            ? 'border-white bg-white text-[rgb(2,27,76)] shadow-sm'
            : 'border-white/12 bg-white/6 text-white hover:border-white/22 hover:bg-white/10'
          : active
            ? 'border-[rgb(2,27,76)] bg-[rgb(2,27,76)] text-white shadow-sm'
            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
      } ${muted && !active ? 'opacity-70' : ''}`}
    >
      {onEdit || onDelete ? (
        <div className="absolute left-1.5 top-1.5 flex items-center gap-1">
          {onEdit ? (
            <button
              type="button"
              onClick={onEdit}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition ${
                active
                  ? isDark
                    ? 'bg-[rgb(2,27,76)]/8 text-[rgb(2,27,76)] hover:bg-[rgb(2,27,76)]/14'
                    : 'bg-white/12 text-white hover:bg-white/20'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-[rgb(2,27,76)]'
              }`}
              title="تعديل التصنيف"
            >
              <Pencil className="h-3 w-3" />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition ${
                active
                  ? isDark
                    ? 'bg-red-50 text-red-600 hover:bg-red-100'
                    : 'bg-white/12 text-white hover:bg-red-500'
                  : 'bg-red-50 text-red-600 hover:bg-red-100'
              }`}
              title="حذف التصنيف"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          ) : null}
        </div>
      ) : null}

      <button type="button" onClick={onClick} className="flex h-full w-full flex-col items-start justify-between text-right">
        <span
          className={`line-clamp-1 pl-14 text-xs font-bold ${
            isDark ? (active ? 'text-[rgb(2,27,76)]' : 'text-white') : active ? 'text-white' : 'text-slate-950'
          }`}
        >
          {title}
        </span>
        <div className="flex w-full items-end justify-between gap-3">
          <span
            className={`text-[10px] font-medium ${
              isDark
                ? active
                  ? 'text-[rgb(2,27,76)]/70'
                  : 'text-white/72'
                : active
                  ? 'text-white/80'
                  : 'text-slate-500'
            }`}
          >
            عدد المنتجات
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
              isDark
                ? active
                  ? 'bg-[rgb(2,27,76)]/8 text-[rgb(2,27,76)]'
                  : 'bg-white/10 text-white/90'
                : active
                  ? 'bg-white/12 text-white'
                  : 'bg-slate-100 text-[rgb(2,27,76)]'
            }`}
          >
            {count}
          </span>
        </div>
      </button>
    </div>
  );
}

function ProductRow({ product, categoryName, onView, onEdit, onToggle, onDelete, disabled }) {
  return (
    <div className="grid gap-4 px-4 py-4 transition hover:bg-slate-50/70 lg:grid-cols-[minmax(0,1.8fr)_160px_190px_120px_170px] lg:items-center">
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-slate-950">{product.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span dir="ltr">{product.internalReference || 'بدون مرجع'}</span>
          <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:inline-flex" />
          <span dir="ltr">{product.barcode || 'بدون باركود'}</span>
          <span className="hidden h-1 w-1 rounded-full bg-slate-300 sm:inline-flex" />
          <span>{formatDate(product.createdAt)}</span>
        </div>
      </div>

      <div className="text-sm text-slate-600">{categoryName}</div>
      <div className="flex flex-wrap gap-1.5">
        <ProductTypeBadge product={product} />
        <TrackingBadge tracking={product.tracking} />
        {product.canBeSold ? <Badge variant="success">يباع</Badge> : null}
        {product.canBePurchased ? <Badge variant="accent">يشترى</Badge> : null}
      </div>
      <div><StatusBadge active={product.isActive} /></div>
      <div className="lg:justify-self-end">
        <RowActions
          disabled={disabled}
          onView={onView}
          onEdit={onEdit}
          onToggle={onToggle}
          onDelete={onDelete}
          active={product.isActive}
        />
      </div>
    </div>
  );
}

function AttributesView({ attributes, onAdd, onEdit, onToggle, onDelete, disabled }) {
  return (
    <SimpleListView
      title="الخصائص"
      description="مثل اللون، السعة، المقاس. يتم ربطها بالتصنيفات وتظهر لاحقًا فقط أثناء إدخال المخزون."
      count={attributes.length}
      actionLabel="إضافة خاصية"
      onAdd={onAdd}
      emptyTitle="لا توجد خصائص بعد"
      headers={['الاسم', 'السلوك', 'العرض', 'مرتبطة بتصنيفات', 'الحالة', 'إجراءات']}
      rows={attributes.map((attribute) => [
        <div className="space-y-1">
          <StrongText>{attribute.name}</StrongText>
          <div className="text-xs font-semibold text-slate-500">
            {attribute.createsVariant ? 'تنشئ Variant' : 'لا تنشئ Variant'}
            {attribute.showInVariantName ? ' • تظهر في الاسم' : ''}
          </div>
        </div>,
        labelFrom([
          { value: 'variant', label: 'Variant' },
          { value: 'commercial', label: 'Commercial' },
          { value: 'informational', label: 'Informational' },
        ], attribute.behavior, '-'),
        labelFrom([
          { value: 'select', label: 'Select' },
          { value: 'buttons', label: 'Buttons' },
          { value: 'radio', label: 'Radio' },
          { value: 'color', label: 'Color' },
        ], attribute.displayType, '-'),
        String(attribute.categoryLinks?.length ?? 0),
        <StatusBadge active={attribute.isActive} />,
        <EditToggleActions
          disabled={disabled}
          active={attribute.isActive}
          onEdit={() => onEdit(attribute)}
          onToggle={() => onToggle(attribute)}
          onDelete={() => onDelete(attribute)}
        />,
      ])}
    />
  );
}

function AttributeValuesView({ values, attributesById, onAdd, onEdit, onToggle, disabled }) {
  return (
    <SimpleListView
      title="قيم الخصائص"
      description="القيم المرتبطة بكل خاصية مع السعر الإضافي والترتيب."
      count={values.length}
      actionLabel="إضافة قيمة"
      onAdd={onAdd}
      emptyTitle="لا توجد قيم خصائص بعد"
      headers={['الخاصية', 'القيمة', 'الكود', 'السعر الإضافي', 'الترتيب', 'الحالة', 'إجراءات']}
      rows={values.map((value) => [
        attributesById.get(value.attributeId)?.name ?? '-',
        <div className="flex items-center gap-2">
          {attributesById.get(value.attributeId)?.displayType === 'color' && value.colorHex ? (
            <span className="inline-flex h-5 w-5 rounded-full border border-slate-200" style={{ backgroundColor: value.colorHex }} />
          ) : null}
          <StrongText>{value.name}</StrongText>
        </div>,
        value.code || '-',
        formatMoney(value.extraPrice),
        value.sortOrder,
        <StatusBadge active={value.isActive} />,
        <EditToggleActions disabled={disabled} active={value.isActive} onEdit={() => onEdit(value)} onToggle={() => onToggle(value)} />,
      ])}
    />
  );
}

function TrackingIdentifiersView({ trackingIdentifiers, onAdd, onEdit, onToggle, onDelete, disabled }) {
  return (
    <SimpleListView
      title="تعريفات التتبع"
      description="تعريف حقول تتبع الوحدات مثل IMEI أو رقم الشاسيه وربطها لاحقًا بالتصنيفات."
      count={trackingIdentifiers.length}
      actionLabel="إضافة تعريف"
      onAdd={onAdd}
      emptyTitle="لا توجد تعريفات تتبع بعد"
      headers={['الاسم', 'الكود', 'نوع القيمة', 'الحالة', 'إجراءات']}
      rows={trackingIdentifiers.map((item) => [
        <StrongText>{item.name}</StrongText>,
        <span dir="ltr">{item.code || '-'}</span>,
        labelFrom([
          { value: 'text', label: 'نص' },
          { value: 'numeric', label: 'رقم' },
        ], item.dataType, '-'),
        <StatusBadge active={item.isActive} />,
        <EditToggleActions
          disabled={disabled}
          active={item.isActive}
          onEdit={() => onEdit(item)}
          onToggle={() => onToggle(item)}
          onDelete={() => onDelete(item)}
        />,
      ])}
    />
  );
}

function SimpleListView({ title, description, count, actionLabel, onAdd, headers, rows, emptyTitle }) {
  return (
    <div className="space-y-5">
      <SectionHeader title={title} description={description} count={count} actionLabel={actionLabel} onAction={onAdd} />
      <TableWrap empty={!rows.length} emptyTitle={emptyTitle} emptyDescription="ابدأ بإضافة سجل جديد من الزر بالأعلى.">
        <thead>
          <tr>{headers.map((header) => <Th key={header}>{header}</Th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-slate-100 last:border-b-0">
              {row.map((cell, cellIndex) => <Td key={cellIndex}>{cell}</Td>)}
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}

function SectionHeader({ title, description, count, controls, actionLabel, onAction, secondaryActionLabel, onSecondaryAction }) {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex flex-wrap items-center gap-3 xl:flex-1">
        {title ? (
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold text-slate-950">{title}</h2>
            {description ? <p className="mt-1 text-sm font-semibold text-slate-500">{description}</p> : null}
          </div>
        ) : null}
        {controls ? <div className="flex w-full flex-wrap items-center gap-3 xl:w-auto xl:flex-1">{controls}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 xl:justify-end">
        {count !== null && count !== undefined ? (
          <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-[rgb(2,27,76)]">{count}</div>
        ) : null}
        {secondaryActionLabel ? (
          <Button type="button" variant="secondary" onClick={onSecondaryAction} className="gap-2 rounded-lg">
            <Pencil className="h-4 w-4" />
            {secondaryActionLabel}
          </Button>
        ) : null}
        {actionLabel ? (
          <Button type="button" onClick={onAction} className="gap-2 rounded-lg bg-[rgb(2,27,76)] hover:opacity-95">
            <Plus className="h-4 w-4" />
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TableWrap({ children, empty, emptyTitle, emptyDescription, actionLabel, onAction }) {
  if (empty) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center">
        <div className="mx-auto flex min-h-64 max-w-md flex-col items-center justify-center">
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-[rgb(2,27,76)] shadow-sm">
            <PackageSearch className="h-8 w-8" />
          </div>
          <h3 className="mt-4 text-xl font-extrabold text-slate-950">{emptyTitle}</h3>
          {emptyDescription ? <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">{emptyDescription}</p> : null}
          {actionLabel ? (
            <Button type="button" onClick={onAction} className="mt-5 gap-2 rounded-lg bg-[rgb(2,27,76)] hover:opacity-95">
              <Plus className="h-4 w-4" />
              {actionLabel}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto bg-white">
      <table className="min-w-full text-right text-sm">{children}</table>
    </div>
  );
}

function Th({ children }) {
  return <th className="whitespace-nowrap border-b border-slate-200 px-4 py-3 text-xs font-bold text-muted-foreground">{children}</th>;
}

function Td({ children }) {
  return <td className="whitespace-nowrap px-4 py-3 align-middle text-sm text-slate-700">{children}</td>;
}

function StrongText({ children }) {
  return <span className="font-bold text-slate-950">{children}</span>;
}

function StatusBadge({ active }) {
  return active ? <Badge variant="success">نشط</Badge> : <Badge>غير نشط</Badge>;
}

function ProductTypeBadge({ product }) {
  if (product.productType === 'service') return <Badge variant="warning">خدمة</Badge>;
  if (product.productType === 'consumable') return <Badge variant="accent">مستهلك</Badge>;
  return <Badge variant="success">مخزني</Badge>;
}

function TrackingBadge({ tracking }) {
  if (tracking === 'serial') return <Badge variant="accent">{labelFrom(TRACKING_TYPES, tracking)}</Badge>;
  if (tracking === 'lot') return <Badge variant="warning">{labelFrom(TRACKING_TYPES, tracking)}</Badge>;
  return <Badge>كمية</Badge>;
}

function RowActions({ onView, onEdit, onToggle, onDelete, active, disabled }) {
  return (
    <div className="flex items-center gap-2">
      <IconButton disabled={disabled} label="عرض" onClick={onView}><Eye className="h-4 w-4" /></IconButton>
      <IconButton disabled={disabled} label="تعديل" onClick={onEdit}><Pencil className="h-4 w-4" /></IconButton>
      <IconButton disabled={disabled} label={active ? 'تعطيل' : 'تفعيل'} onClick={onToggle}>{active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}</IconButton>
      <IconButton disabled={disabled} label="حذف" onClick={onDelete}><Trash2 className="h-4 w-4" /></IconButton>
    </div>
  );
}

function EditToggleActions({ onEdit, onToggle, onDelete, active, disabled }) {
  return (
    <div className="flex items-center gap-2">
      <IconButton disabled={disabled} label="تعديل" onClick={onEdit}><Pencil className="h-4 w-4" /></IconButton>
      <IconButton disabled={disabled} label={active ? 'تعطيل' : 'تفعيل'} onClick={onToggle}>{active ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}</IconButton>
      {onDelete ? <IconButton disabled={disabled} label="حذف" onClick={onDelete}><Trash2 className="h-4 w-4" /></IconButton> : null}
    </div>
  );
}

function IconButton({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-[rgb(2,27,76)] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Alert({ children, tone }) {
  const classes = tone === 'danger' ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-[rgb(2,27,76)]';
  return <div className={`mb-4 rounded-lg border px-4 py-3 text-sm font-semibold ${classes}`}>{children}</div>;
}

function FloatingNotice({ notice, onClose }) {
  if (!notice) return null;

  const classes =
    notice.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-800';

  return (
    <div className="fixed bottom-5 left-5 z-50 max-w-sm" dir="rtl">
      <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-semibold shadow-[0_18px_50px_-30px_rgba(15,23,42,0.45)] ${classes}`}>
        <span className="leading-6">{notice.message}</span>
        <button
          type="button"
          onClick={onClose}
          className="mr-2 rounded-md px-2 text-base leading-5 opacity-70 transition hover:bg-white/70 hover:opacity-100"
          aria-label="إغلاق الإشعار"
        >
          ×
        </button>
      </div>
    </div>
  );
}
