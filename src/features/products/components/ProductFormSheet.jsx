import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/core/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/core/ui/dropdown-menu';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';

const PRODUCT_TYPES = [
  { value: 'goods', label: 'سلعة', title: 'سلعة', description: 'منتج مخزني يمكن تحديد طريقة تتبعه' },
  { value: 'service', label: 'خدمة', title: 'خدمة', description: 'لا تدخل المخزون ولا تقبل التتبع' },
  { value: 'consumable', label: 'مستهلك', title: 'مستهلك', description: 'يصرف أو يستهلك بسرعة بدون تتبع' },
];

const TRACKING_TYPES = [
  { value: 'none', label: 'بدون تتبع', title: 'بدون تتبع', description: 'مخزون كمي عادي' },
  { value: 'serial', label: 'Serial / IMEI', title: 'Serial / IMEI', description: 'كل وحدة برقم مستقل' },
  { value: 'lot', label: 'Lot / دفعات', title: 'Lot / دفعات', description: 'تتبع بالباتشات أو الدفعات' },
];

function getInitialState(product) {
  const productType = product?.productType ?? 'goods';
  return {
    name: product?.name ?? '',
    categoryId: product?.categoryId ?? '',
    internalReference: product?.internalReference ?? '',
    barcode: product?.barcode ?? '',
    productType,
    tracking: productType === 'service' || productType === 'consumable' ? 'none' : product?.tracking ?? 'none',
    salePrice: product?.salePrice ?? 0,
    costPrice: product?.costPrice ?? 0,
    canBeSold: product?.canBeSold ?? true,
    canBePurchased: product?.canBePurchased ?? true,
    isActive: product?.isActive ?? true,
    requiresContract: product?.requiresContract ?? false,
    requiresOwnershipTransfer: product?.requiresOwnershipTransfer ?? false,
    requiresPostSaleDocuments: product?.requiresPostSaleDocuments ?? false,
    requiresLicense: product?.requiresLicense ?? false,
  };
}

function applySuggestedCategoryDefaults(state, category) {
  if (!category) return state;

  const nextProductType = category.defaultProductType || state.productType;
  const nextTracking = nextProductType === 'service' || nextProductType === 'consumable'
    ? 'none'
    : (category.defaultTracking ?? state.tracking ?? 'none');

  return {
    ...state,
    categoryId: category.id,
    productType: nextProductType,
    tracking: nextTracking,
    canBeSold: category.defaultCanBeSold ?? state.canBeSold,
    canBePurchased: category.defaultCanBePurchased ?? state.canBePurchased,
    isActive: category.defaultIsActive ?? state.isActive,
    requiresContract: category.defaultRequiresContract ?? state.requiresContract,
    requiresOwnershipTransfer: category.defaultRequiresOwnershipTransfer ?? state.requiresOwnershipTransfer,
    requiresPostSaleDocuments: category.defaultRequiresPostSaleDocuments ?? state.requiresPostSaleDocuments,
    requiresLicense: category.defaultRequiresLicense ?? state.requiresLicense,
  };
}

export function ProductFormSheet({
  open,
  onOpenChange,
  product,
  categories,
  onSubmit,
  isSubmitting,
  side = 'bottom',
}) {
  const [formState, setFormState] = useState(() => getInitialState(product));
  const [formError, setFormError] = useState('');
  const [isProductTypeSuggested, setIsProductTypeSuggested] = useState(false);
  const [isOperationEditing, setIsOperationEditing] = useState(false);
  const [pendingCategoryChange, setPendingCategoryChange] = useState(null);
  const inventoryNote = useMemo(() => getInventoryNote(formState), [formState]);
  const categoryAttributesPreview = useMemo(
    () => getInheritedCategoryAttributes(categories, formState.categoryId),
    [categories, formState.categoryId],
  );
  const selectedProductType = PRODUCT_TYPES.find((option) => option.value === formState.productType) ?? PRODUCT_TYPES[0];
  const selectedTracking = TRACKING_TYPES.find((option) => option.value === formState.tracking) ?? TRACKING_TYPES[0];
  const operationDescription = getOperationDescription({
    formState,
    productType: selectedProductType,
    tracking: selectedTracking,
  });

  useEffect(() => {
    if (!open) return;
    setFormState(getInitialState(product));
    setFormError('');
    setIsProductTypeSuggested(false);
    setIsOperationEditing(false);
  }, [open, product]);

  const handleChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setFormState((current) => {
      if (field === 'productType') {
        setIsProductTypeSuggested(false);
        if (value === 'service' || value === 'consumable') {
          return { ...current, productType: value, tracking: 'none' };
        }
      }

      return { ...current, [field]: value };
    });
  };

  const handleCategoryChange = (event) => {
    const categoryId = event.target.value;
    const category = categories.find((item) => item.id === categoryId);
    const suggestedType = category?.defaultProductType || '';

    if (!category) {
      setIsProductTypeSuggested(false);
      setIsOperationEditing(false);
      setFormState((current) => ({ ...current, categoryId }));
      return;
    }

    // If product was previously saved with a different category, show confirmation
    if (product?.id && product?.categoryId && product.categoryId !== categoryId) {
      setPendingCategoryChange({ categoryId, category });
      return;
    }

    setIsProductTypeSuggested(Boolean(suggestedType));
    setIsOperationEditing(false);
    setFormState((current) => applySuggestedCategoryDefaults({ ...current, categoryId }, category));
  };

  const handleConfirmCategoryChange = (applyDefaults) => {
    if (!pendingCategoryChange) return;

    const { categoryId, category } = pendingCategoryChange;
    setIsProductTypeSuggested(Boolean(category.defaultProductType));
    setIsOperationEditing(false);

    if (applyDefaults) {
      setFormState((current) => applySuggestedCategoryDefaults({ ...current, categoryId }, category));
    } else {
      setFormState((current) => ({ ...current, categoryId }));
    }

    setPendingCategoryChange(null);
  };

  const handleProductTypeSelect = (productType) => {
    setIsProductTypeSuggested(false);
    setFormState((current) => ({
      ...current,
      productType,
      tracking: productType === 'goods' ? current.tracking || 'none' : 'none',
    }));
  };

  const handleTrackingSelect = (tracking) => {
    setIsProductTypeSuggested(false);
    setFormState((current) => ({
      ...current,
      productType: 'goods',
      tracking,
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formState.name.trim()) {
      setFormError('اسم المنتج مطلوب.');
      return;
    }

    const result = await onSubmit({
      ...formState,
      tracking: formState.productType === 'service' || formState.productType === 'consumable' ? 'none' : formState.tracking,
      attributesJsonb: [],
    });

    if (result?.error) {
      setFormError(result.error);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={side}
        dir="rtl"
        className={side === 'right' ? 'w-full max-w-[720px] border-l border-slate-200 bg-white' : 'mx-auto h-[92vh] w-full max-w-4xl'}
      >
        <Button
          type="submit"
          form="product-form"
          disabled={isSubmitting}
          className="absolute left-4 top-4 h-9 rounded-full px-4 text-sm"
        >
          {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ'}
        </Button>
        <SheetHeader>
          <SheetTitle>{product ? 'تعديل منتج' : 'إضافة منتج'}</SheetTitle>
        </SheetHeader>

        <form id="product-form" className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <SheetBody className={side === 'right' ? 'min-h-0 flex-1 space-y-5 px-5 py-5 sm:px-7' : 'min-h-0 space-y-5'}>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="اسم المنتج">
                <Input value={formState.name} onChange={handleChange('name')} />
              </Field>
              <Field label="التصنيف">
                <>
                  <Select
                    value={formState.categoryId}
                    onChange={handleCategoryChange}
                    options={categories.map((item) => ({ value: item.id, label: item.name }))}
                  />
                  {formState.categoryId ? (
                    <p className="text-sm font-semibold leading-6 text-slate-600">
                      {operationDescription}
                      <button
                        type="button"
                        onClick={() => setIsOperationEditing((current) => !current)}
                        className="mr-2 font-extrabold text-[rgb(2,27,76)] underline-offset-4 transition hover:underline"
                      >
                        {isOperationEditing ? 'تم' : 'تعديل'}
                      </button>
                    </p>
                  ) : null}
                </>
              </Field>
            </div>

            {formState.categoryId ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="font-extrabold text-slate-950">سيتم طلب هذه الخصائص عند إدخال المخزون:</div>
                {categoryAttributesPreview.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {categoryAttributesPreview.map((attribute) => (
                      <span
                        key={attribute.attributeId}
                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700"
                      >
                        {attribute.attributeName}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-2 text-sm font-semibold text-slate-500">لا توجد خصائص مرتبطة بهذا التصنيف حاليًا.</div>
                )}
              </div>
            ) : null}

            {isOperationEditing ? (
              <FormSection>
                <div className="space-y-3 md:col-span-2">
                  <div className="font-extrabold text-slate-950">نوع المنتج</div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {PRODUCT_TYPES.map((option) => {
                      const active = formState.productType === option.value;
                      const isGoods = option.value === 'goods';
                      return (
                        <div key={option.value} className="relative">
                          {isGoods ? (
                            <DropdownMenu dir="rtl">
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => handleProductTypeSelect('goods')}
                                  className={`w-full rounded-2xl border px-3 py-3 text-right transition ${
                                    active
                                      ? 'border-[rgb(2,27,76)] bg-[linear-gradient(180deg,rgba(2,27,76,0.05),rgba(2,27,76,0.015))] text-slate-950 shadow-[0_20px_45px_-30px_rgba(2,27,76,0.45)]'
                                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <span
                                      className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition ${
                                        active
                                          ? 'border-[rgb(2,27,76)] bg-[rgb(2,27,76)] text-white'
                                          : 'border-slate-300 bg-white text-transparent'
                                      }`}
                                    >
                                      ✓
                                    </span>

                                    <div className="min-w-0">
                                      <div className={`text-sm font-extrabold ${active ? 'text-[rgb(2,27,76)]' : 'text-slate-950'}`}>{option.title}</div>
                                      <div className={`mt-1 text-xs font-semibold leading-5 ${active ? 'text-slate-700' : 'text-slate-500'}`}>
                                        {active ? selectedTracking.description : option.description}
                                      </div>
                                      {active ? (
                                        <div className="mt-2 inline-flex rounded-full bg-[rgb(2,27,76)]/10 px-2.5 py-1 text-[11px] font-bold text-[rgb(2,27,76)]">
                                          {selectedTracking.title}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="w-72">
                                <div className="mb-2 px-2 text-xs font-bold text-slate-500">اختر طريقة تتبع السلعة</div>
                                {TRACKING_TYPES.map((trackingOption) => {
                                  const trackingActive = formState.tracking === trackingOption.value;
                                  return (
                                    <DropdownMenuItem
                                      key={trackingOption.value}
                                      onSelect={() => handleTrackingSelect(trackingOption.value)}
                                      className={`flex items-start justify-start gap-2.5 px-3 py-2.5 ${
                                        trackingActive ? 'bg-[rgb(2,27,76)] text-white hover:bg-[rgb(2,27,76)] focus:bg-[rgb(2,27,76)]' : ''
                                      }`}
                                    >
                                      <span
                                        className={`mt-0.5 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                                          trackingActive
                                            ? 'border-white/30 bg-white/10 text-white'
                                            : 'border-slate-300 bg-white text-transparent'
                                        }`}
                                      >
                                        ✓
                                      </span>
                                      <span className="min-w-0 text-right">
                                        <span className="block text-xs font-extrabold">{trackingOption.title}</span>
                                        <span className={`mt-0.5 block text-[11px] font-semibold leading-5 ${trackingActive ? 'text-white/80' : 'text-slate-500'}`}>
                                          {trackingOption.description}
                                        </span>
                                      </span>
                                    </DropdownMenuItem>
                                  );
                                })}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleProductTypeSelect(option.value)}
                              className={`w-full rounded-2xl border px-3 py-3 text-right transition ${
                                active
                                  ? 'border-[rgb(2,27,76)] bg-[linear-gradient(180deg,rgba(2,27,76,0.05),rgba(2,27,76,0.015))] text-slate-950 shadow-[0_20px_45px_-30px_rgba(2,27,76,0.45)]'
                                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-start gap-3">
                                <span
                                  className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition ${
                                    active
                                      ? 'border-[rgb(2,27,76)] bg-[rgb(2,27,76)] text-white'
                                      : 'border-slate-300 bg-white text-transparent'
                                  }`}
                                >
                                  ✓
                                </span>

                                <div className="min-w-0">
                                  <div className={`text-sm font-extrabold ${active ? 'text-[rgb(2,27,76)]' : 'text-slate-950'}`}>{option.title}</div>
                                  <div className={`mt-1 text-xs font-semibold leading-5 ${active ? 'text-slate-700' : 'text-slate-500'}`}>
                                    {option.description}
                                  </div>
                                </div>
                              </div>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-2 md:col-span-2 md:grid-cols-3">
                  <Checkbox label="يباع" checked={formState.canBeSold} onChange={handleChange('canBeSold')} />
                  <Checkbox label="يشترى" checked={formState.canBePurchased} onChange={handleChange('canBePurchased')} />
                  <Checkbox label="نشط" checked={formState.isActive} onChange={handleChange('isActive')} />
                </div>
                <div className={`rounded-xl border px-4 py-3 text-sm font-semibold md:col-span-2 ${inventoryNote.className}`}>
                  {inventoryNote.text}
                </div>
              </FormSection>
            ) : null}

            {formState.categoryId || formState.requiresContract || formState.requiresOwnershipTransfer || formState.requiresPostSaleDocuments || formState.requiresLicense ? (
              <FormSection>
                <div className="space-y-3 md:col-span-2">
                  <div className="font-extrabold text-slate-950">إجراءات ما بعد البيع</div>
                  <div className="grid gap-3 md:grid-cols-4">
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 cursor-pointer hover:border-slate-300 transition">
                      <input
                        type="checkbox"
                        checked={Boolean(formState.requiresContract)}
                        onChange={handleChange('requiresContract')}
                        className="h-4 w-4 accent-[rgb(2,27,76)]"
                      />
                      <span>يحتاج عقد</span>
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 cursor-pointer hover:border-slate-300 transition">
                      <input
                        type="checkbox"
                        checked={Boolean(formState.requiresOwnershipTransfer)}
                        onChange={handleChange('requiresOwnershipTransfer')}
                        className="h-4 w-4 accent-[rgb(2,27,76)]"
                      />
                      <span>يحتاج نقل ملكية</span>
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 cursor-pointer hover:border-slate-300 transition">
                      <input
                        type="checkbox"
                        checked={Boolean(formState.requiresPostSaleDocuments)}
                        onChange={handleChange('requiresPostSaleDocuments')}
                        className="h-4 w-4 accent-[rgb(2,27,76)]"
                      />
                      <span>يحتاج متابعة أوراق</span>
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 cursor-pointer hover:border-slate-300 transition">
                      <input
                        type="checkbox"
                        checked={Boolean(formState.requiresLicense)}
                        onChange={handleChange('requiresLicense')}
                        className="h-4 w-4 accent-[rgb(2,27,76)]"
                      />
                      <span>يحتاج ترخيص</span>
                    </label>
                  </div>
                </div>
              </FormSection>
            ) : null}

            {formError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}
          </SheetBody>
        </form>

        {pendingCategoryChange && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="mx-4 rounded-2xl border border-slate-200 bg-white p-6 max-w-sm w-full space-y-4 shadow-lg">
              <div>
                <h3 className="text-lg font-extrabold text-slate-950">تغيير التصنيف</h3>
                <p className="mt-2 text-sm text-slate-600">هل تريد تطبيق إعدادات التصنيف الجديد على المنتج؟</p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => handleConfirmCategoryChange(false)}
                  className="flex-1 h-9 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                >
                  الاحتفاظ بالإعدادات الحالية
                </button>
                <button
                  type="button"
                  onClick={() => handleConfirmCategoryChange(true)}
                  className="flex-1 h-9 rounded-lg bg-[rgb(2,27,76)] text-sm font-semibold text-white hover:bg-[rgb(2,27,76)]/90 transition"
                >
                  تطبيق الإعدادات الجديدة
                </button>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function getInventoryNote(formState) {
  if (formState.productType === 'service') {
    return {
      text: 'هذا المنتج خدمة ولن يدخل المخزون',
      className: 'border-amber-200 bg-amber-50 text-amber-800',
    };
  }

  if (formState.productType === 'consumable') {
    return {
      text: 'هذا المنتج المستهلك يُعامل حاليًا مثل منتج عادي بالمخزون الكمي',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    };
  }

  if (formState.tracking === 'serial') {
    return {
      text: 'هذا المنتج متتبع بالسيريال / IMEI ويجب تسجيل الوحدات قبل البيع',
      className: 'border-teal-200 bg-teal-50 text-teal-800',
    };
  }

  if (formState.tracking === 'lot') {
    return {
      text: 'هذا المنتج متتبع بالدفعات، ودعم الدفعات التشغيلي الكامل يحتاج تفعيلًا لاحقًا في المخزون',
      className: 'border-amber-200 bg-amber-50 text-amber-800',
    };
  }

  return {
    text: 'هذا المنتج يُدار بالمخزون الكمي',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  };
}

function getOperationDescription({ formState, productType, tracking }) {
  const trackingText = formState.productType === 'goods' ? ` بتتبع ${tracking.title}` : '';
  const saleText = formState.canBeSold ? 'متاح للبيع' : 'غير متاح للبيع';
  const purchaseText = formState.canBePurchased ? 'والشراء' : 'وغير متاح للشراء';
  const statusText = formState.isActive ? 'نشط' : 'غير نشط';

  return `سيتم إنشاء المنتج كـ ${productType.title}${trackingText}، ${saleText} ${purchaseText}، وحالته ${statusText}.`;
}

function FormSection({ title, children }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      {title ? <div className="font-extrabold text-slate-950">{title}</div> : null}
      <div className={`${title ? 'mt-3' : ''} grid gap-4 md:grid-cols-2`}>{children}</div>
    </section>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 accent-[rgb(2,27,76)]" />
      <span>{label}</span>
    </label>
  );
}

function Select({ value, onChange, options, allowEmpty = true, disabled = false, disabledOptions = [] }) {
  return (
    <select
      className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      value={value}
      onChange={onChange}
      disabled={disabled}
    >
      {allowEmpty ? <option value="">بدون</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={disabledOptions.includes(option.value)}>{option.label}</option>
      ))}
    </select>
  );
}

function getInheritedCategoryAttributes(categories, categoryId) {
  if (!categoryId) return [];

  const categoriesById = new Map((categories ?? []).map((category) => [category.id, category]));
  const hierarchy = [];
  const visited = new Set();
  let currentId = categoryId;

  while (currentId && !visited.has(currentId)) {
    const category = categoriesById.get(currentId);
    if (!category) break;

    hierarchy.push(category);
    visited.add(currentId);
    currentId = category.parentId ?? null;
  }

  return hierarchy.reduce((accumulator, category) => {
    for (const link of category.attributeLinks ?? []) {
      if (accumulator.some((item) => item.attributeId === link.attributeId)) continue;
      accumulator.push(link);
    }
    return accumulator;
  }, []);
}
