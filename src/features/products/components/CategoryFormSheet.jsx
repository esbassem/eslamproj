import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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

const PRODUCT_TYPE_OPTIONS = [
  { value: 'goods', title: 'سلعة', description: 'منتج مخزني يمكن تحديد طريقة تتبعه' },
  { value: 'service', title: 'خدمة', description: 'لا تدخل المخزون ولا تقبل التتبع' },
  { value: 'consumable', title: 'مستهلك', description: 'يصرف أو يستهلك بسرعة بدون تتبع' },
];

const GOODS_TRACKING_OPTIONS = [
  { value: 'none', title: 'بدون تتبع', description: 'مخزون كمي عادي' },
  { value: 'serial', title: 'Serial / IMEI', description: 'كل وحدة برقم مستقل' },
  { value: 'lot', title: 'Lot / دفعات', description: 'تتبع بالباتشات أو الدفعات' },
];

function getInitialState(record) {
  return {
    name: record?.name ?? '',
    parentId: record?.parentId ?? '',
    defaultProductType: record?.defaultProductType ?? '',
    defaultTracking: record?.defaultTracking ?? 'none',
    displayPrefix: record?.displayPrefix ?? '',
    isActive: record?.isActive ?? true,
    defaultRequiresContract: record?.defaultRequiresContract ?? false,
    defaultRequiresOwnershipTransfer: record?.defaultRequiresOwnershipTransfer ?? false,
    defaultRequiresPostSaleDocuments: record?.defaultRequiresPostSaleDocuments ?? false,
    defaultRequiresLicense: record?.defaultRequiresLicense ?? false,
    attributeLinks: (record?.attributeLinks ?? []).map((link) => ({
      attributeId: link.attributeId ?? '',
      isRequired: Boolean(link.isRequired),
      displayOrder: Number(link.displayOrder) || 0,
    })),
    trackingIdentifierLinks: (record?.trackingIdentifierLinks ?? []).map((link) => ({
      identifierTypeId: link.identifierTypeId ?? '',
      isRequired: Boolean(link.isRequired),
      allowNotAvailable: Boolean(link.allowNotAvailable),
      sequence: Number(link.sequence) || 0,
    })),
  };
}

export function CategoryFormSheet({ open, onOpenChange, record, categories, attributes, trackingIdentifierTypes = [], onSubmit, isSubmitting }) {
  const [formState, setFormState] = useState(() => getInitialState(record));
  const [formError, setFormError] = useState('');
  const [currentStep, setCurrentStep] = useState(1);

  useEffect(() => {
    if (!open) return;
    setFormState(getInitialState(record));
    setFormError('');
    setCurrentStep(1);
  }, [open, record]);

  const availableCategories = useMemo(
    () => categories.filter((item) => item.id !== record?.id),
    [categories, record?.id],
  );

  const sortedAttributes = useMemo(
    () => [...attributes].sort((left, right) => String(left.name).localeCompare(String(right.name))),
    [attributes],
  );

  const sortedTrackingIdentifierTypes = useMemo(
    () => [...trackingIdentifierTypes]
      .filter((item) => item.isActive || formState.trackingIdentifierLinks.some((link) => link.identifierTypeId === item.id))
      .sort((left, right) => String(left.name).localeCompare(String(right.name))),
    [formState.trackingIdentifierLinks, trackingIdentifierTypes],
  );

  const handleLinkChange = (index, key, value) => {
    setFormState((current) => ({
      ...current,
      attributeLinks: current.attributeLinks.map((link, linkIndex) => (
        linkIndex === index ? { ...link, [key]: value } : link
      )),
    }));
  };

  const handleTrackingIdentifierLinkChange = (index, key, value) => {
    setFormState((current) => ({
      ...current,
      trackingIdentifierLinks: current.trackingIdentifierLinks.map((link, linkIndex) => (
        linkIndex === index ? { ...link, [key]: value } : link
      )),
    }));
  };

  const selectedGoodsTracking = GOODS_TRACKING_OPTIONS.find((option) => option.value === formState.defaultTracking)
    ?? GOODS_TRACKING_OPTIONS[0];

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formState.name.trim()) {
      setFormError('اسم التصنيف مطلوب.');
      return;
    }

    const normalizedLinks = formState.attributeLinks
      .filter((item) => item.attributeId)
      .map((item) => ({
        attributeId: item.attributeId,
        isRequired: Boolean(item.isRequired),
        displayOrder: Number(item.displayOrder) || 0,
      }));

    if (new Set(normalizedLinks.map((item) => item.attributeId)).size !== normalizedLinks.length) {
      setFormError('لا يمكن تكرار نفس الخاصية داخل التصنيف.');
      return;
    }

    const normalizedTrackingIdentifierLinks = formState.trackingIdentifierLinks
      .filter((item) => item.identifierTypeId)
      .map((item) => ({
        identifierTypeId: item.identifierTypeId,
        isRequired: Boolean(item.isRequired),
        allowNotAvailable: Boolean(item.allowNotAvailable),
        sequence: Number(item.sequence) || 0,
      }));

    if (new Set(normalizedTrackingIdentifierLinks.map((item) => item.identifierTypeId)).size !== normalizedTrackingIdentifierLinks.length) {
      setFormError('لا يمكن تكرار نفس تعريف التتبع داخل التصنيف.');
      return;
    }

    const result = await onSubmit({
      ...formState,
      attributeLinks: normalizedLinks,
      trackingIdentifierLinks: normalizedTrackingIdentifierLinks,
    });

    if (result?.error) {
      setFormError(result.error);
    }
  };

  const handleNextStep = () => {
    if (!formState.name.trim()) {
      setFormError('اسم التصنيف مطلوب.');
      return;
    }

    if (!formState.defaultProductType) {
      setFormError('اختر نوع المنتج الافتراضي أولًا.');
      return;
    }

    setFormError('');
    setCurrentStep(2);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto min-h-[88vh] max-h-[98vh] w-full max-w-5xl">
        {currentStep === 1 ? (
          <Button
            type="button"
            onClick={handleNextStep}
            className="absolute left-4 top-4 z-10 h-9 rounded-full px-4 text-sm"
          >
            التالي
          </Button>
        ) : null}
        {currentStep === 2 ? (
          <div className="absolute left-4 top-4 z-10 flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={() => setCurrentStep(1)} className="h-9 rounded-full px-4 text-sm">
              السابق
            </Button>
            <Button type="submit" form="category-form" disabled={isSubmitting} className="h-9 rounded-full px-4 text-sm">
              {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ'}
            </Button>
          </div>
        ) : null}
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
              <MiniStep number={1} active={currentStep === 1} done={currentStep > 1} />
              <div className="h-px w-5 bg-slate-200" />
              <MiniStep number={2} active={currentStep === 2} done={false} />
            </div>
            <SheetTitle>{record ? 'تعديل تصنيف' : 'إضافة تصنيف'}</SheetTitle>
          </div>
        </SheetHeader>

        <form id="category-form" className="flex h-full min-h-0 flex-col" onSubmit={handleSubmit}>
          <SheetBody className="min-h-0 space-y-5 overscroll-y-contain">
            {currentStep === 1 ? (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="category-name">اسم التصنيف</Label>
                    <Input
                      id="category-name"
                      value={formState.name}
                      onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="category-parent">التصنيف الأب</Label>
                    <select
                      id="category-parent"
                      className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={formState.parentId}
                      onChange={(event) => setFormState((current) => ({ ...current, parentId: event.target.value }))}
                    >
                      <option value="">بدون</option>
                      {availableCategories.map((category) => (
                        <option key={category.id} value={category.id}>{category.name}</option>
                      ))}
                    </select>
                  </div>

                  {record ? (
                    <div className="space-y-2">
                      <Label>الحالة</Label>
                      <label className="flex h-11 items-center gap-3 rounded-xl border border-border bg-white px-3 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={Boolean(formState.isActive)}
                          onChange={(event) => setFormState((current) => ({ ...current, isActive: event.target.checked }))}
                        />
                        نشط
                      </label>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="font-extrabold text-slate-950">نوع المنتج الافتراضي</div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {PRODUCT_TYPE_OPTIONS.map((option) => {
                      const active = formState.defaultProductType === option.value;
                      const isGoods = option.value === 'goods';
                      return (
                        <div key={option.value} className="relative">
                          {isGoods ? (
                            <DropdownMenu dir="rtl">
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  onClick={() => setFormState((current) => ({
                                    ...current,
                                    defaultProductType: 'goods',
                                    defaultTracking: current.defaultTracking || 'none',
                                  }))}
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
                                        {active ? selectedGoodsTracking.description : option.description}
                                      </div>
                                      {active ? (
                                        <div className="mt-2 inline-flex rounded-full bg-[rgb(2,27,76)]/10 px-2.5 py-1 text-[11px] font-bold text-[rgb(2,27,76)]">
                                          {selectedGoodsTracking.title}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="w-72">
                                <div className="mb-2 px-2 text-xs font-bold text-slate-500">اختر طريقة تتبع السلعة</div>
                                {GOODS_TRACKING_OPTIONS.map((trackingOption) => {
                                  const trackingActive = formState.defaultTracking === trackingOption.value;
                                  return (
                                    <DropdownMenuItem
                                      key={trackingOption.value}
                                      onSelect={() => {
                                        setFormState((current) => ({
                                          ...current,
                                          defaultProductType: 'goods',
                                          defaultTracking: trackingOption.value,
                                        }));
                                      }}
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
                              onClick={() => {
                                setFormState((current) => ({
                                  ...current,
                                  defaultProductType: option.value,
                                  defaultTracking: 'none',
                                }));
                              }}
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

                <div className="space-y-3">
                  <div className="font-extrabold text-slate-950">إعدادات ما بعد البيع الافتراضية</div>
                  <div className="grid gap-3 md:grid-cols-4">
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 cursor-pointer hover:border-slate-300 transition">
                      <input
                        type="checkbox"
                        checked={Boolean(formState.defaultRequiresContract)}
                        onChange={(event) => setFormState((current) => ({ ...current, defaultRequiresContract: event.target.checked }))}
                        className="h-4 w-4 accent-[rgb(2,27,76)]"
                      />
                      <span>يحتاج عقد</span>
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 cursor-pointer hover:border-slate-300 transition">
                      <input
                        type="checkbox"
                        checked={Boolean(formState.defaultRequiresOwnershipTransfer)}
                        onChange={(event) => setFormState((current) => ({ ...current, defaultRequiresOwnershipTransfer: event.target.checked }))}
                        className="h-4 w-4 accent-[rgb(2,27,76)]"
                      />
                      <span>يحتاج نقل ملكية</span>
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 cursor-pointer hover:border-slate-300 transition">
                      <input
                        type="checkbox"
                        checked={Boolean(formState.defaultRequiresPostSaleDocuments)}
                        onChange={(event) => setFormState((current) => ({ ...current, defaultRequiresPostSaleDocuments: event.target.checked }))}
                        className="h-4 w-4 accent-[rgb(2,27,76)]"
                      />
                      <span>يحتاج متابعة أوراق</span>
                    </label>
                    <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm font-semibold text-slate-700 cursor-pointer hover:border-slate-300 transition">
                      <input
                        type="checkbox"
                        checked={Boolean(formState.defaultRequiresLicense)}
                        onChange={(event) => setFormState((current) => ({ ...current, defaultRequiresLicense: event.target.checked }))}
                        className="h-4 w-4 accent-[rgb(2,27,76)]"
                      />
                      <span>يحتاج ترخيص</span>
                    </label>
                  </div>
                </div>
              </>
            ) : (
              <section className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-extrabold text-slate-950">الخصائص الافتراضية لهذا التصنيف</div>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setFormState((current) => ({
                      ...current,
                      attributeLinks: [...current.attributeLinks, { attributeId: '', isRequired: false, displayOrder: 0 }],
                    }))}
                  >
                    <Plus className="ml-1 h-4 w-4" />
                    إضافة خاصية
                  </Button>
                </div>

                {!formState.attributeLinks.length ? (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                    لا توجد خصائص مرتبطة بهذا التصنيف حاليًا.
                  </div>
                ) : (
                  <div className="mt-4 space-y-3">
                    {formState.attributeLinks.map((link, index) => {
                      const selectedAttribute = sortedAttributes.find((a) => a.id === link.attributeId);
                      const isCommercial = selectedAttribute?.behavior === 'commercial';
                      return (
                      <div key={`${record?.id ?? 'new'}-${index}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1.6fr)_140px_120px_44px]">
                        <div className="space-y-2">
                          <Label htmlFor={`category-attribute-${index}`}>الخاصية</Label>
                          <select
                            id={`category-attribute-${index}`}
                            className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                            value={link.attributeId}
                            onChange={(event) => handleLinkChange(index, 'attributeId', event.target.value)}
                          >
                            <option value="">اختر خاصية</option>
                            {sortedAttributes.map((attribute) => (
                              <option key={attribute.id} value={attribute.id}>{attribute.name}</option>
                            ))}
                          </select>
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor={`category-attribute-order-${index}`}>الترتيب</Label>
                          <Input
                            id={`category-attribute-order-${index}`}
                            type="number"
                            value={link.displayOrder}
                            onChange={(event) => handleLinkChange(index, 'displayOrder', event.target.value)}
                          />
                        </div>

                        {isCommercial ? (
                          <div className="space-y-2">
                            <Label>إجباري</Label>
                            <label className="flex h-11 items-center gap-3 rounded-xl border border-border bg-white px-3 text-sm font-semibold">
                              <input
                                type="checkbox"
                                checked={Boolean(link.isRequired)}
                                onChange={(event) => handleLinkChange(index, 'isRequired', event.target.checked)}
                              />
                              مطلوب
                            </label>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <Label>إجباري</Label>
                            <label className="flex h-11 items-center gap-3 rounded-xl border border-border bg-white px-3 text-sm font-semibold">
                              <input
                                type="checkbox"
                                checked={Boolean(link.isRequired)}
                                onChange={(event) => handleLinkChange(index, 'isRequired', event.target.checked)}
                              />
                              مطلوب
                            </label>
                          </div>
                        )}

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => setFormState((current) => ({
                              ...current,
                              attributeLinks: current.attributeLinks.filter((_, linkIndex) => linkIndex !== index),
                            }))}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600 transition hover:bg-red-100"
                            title="حذف الخاصية"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                )}

                <section className="space-y-4 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                    <div>
                      <div className="font-extrabold text-slate-950">Tracking Identifiers</div>
                      <div className="mt-1 text-xs font-semibold text-slate-500">حقول تعريف وحدات التتبع التي ستظهر عند إدخال المخزون.</div>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setFormState((current) => ({
                        ...current,
                        trackingIdentifierLinks: [...current.trackingIdentifierLinks, { identifierTypeId: '', isRequired: false, allowNotAvailable: false, sequence: 0 }],
                      }))}
                    >
                      <Plus className="ml-1 h-4 w-4" />
                      إضافة تعريف
                    </Button>
                  </div>

                  {!formState.trackingIdentifierLinks.length ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                      لا توجد تعريفات تتبع مرتبطة بهذا التصنيف حاليًا.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {formState.trackingIdentifierLinks.map((link, index) => (
                        <div key={`tracking-identifier-${record?.id ?? 'new'}-${index}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(0,1.6fr)_120px_120px_170px_44px]">
                          <div className="space-y-2">
                            <Label htmlFor={`category-tracking-identifier-${index}`}>التعريف</Label>
                            <select
                              id={`category-tracking-identifier-${index}`}
                              className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                              value={link.identifierTypeId}
                              onChange={(event) => handleTrackingIdentifierLinkChange(index, 'identifierTypeId', event.target.value)}
                            >
                              <option value="">اختر تعريف</option>
                              {sortedTrackingIdentifierTypes.map((item) => (
                                <option key={item.id} value={item.id}>{item.name}</option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`category-tracking-identifier-sequence-${index}`}>الترتيب</Label>
                            <Input
                              id={`category-tracking-identifier-sequence-${index}`}
                              type="number"
                              value={link.sequence}
                              onChange={(event) => handleTrackingIdentifierLinkChange(index, 'sequence', event.target.value)}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label>إجباري</Label>
                            <label className="flex h-11 items-center gap-3 rounded-xl border border-border bg-white px-3 text-sm font-semibold">
                              <input
                                type="checkbox"
                                checked={Boolean(link.isRequired)}
                                onChange={(event) => handleTrackingIdentifierLinkChange(index, 'isRequired', event.target.checked)}
                              />
                              مطلوب
                            </label>
                          </div>

                          <div className="space-y-2">
                            <Label>لا يوجد</Label>
                            <label className="flex h-11 items-center gap-3 rounded-xl border border-border bg-white px-3 text-sm font-semibold">
                              <input
                                type="checkbox"
                                checked={Boolean(link.allowNotAvailable)}
                                onChange={(event) => handleTrackingIdentifierLinkChange(index, 'allowNotAvailable', event.target.checked)}
                              />
                              السماح باختيار لا يوجد
                            </label>
                          </div>

                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => setFormState((current) => ({
                                ...current,
                                trackingIdentifierLinks: current.trackingIdentifierLinks.filter((_, linkIndex) => linkIndex !== index),
                              }))}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-red-200 bg-red-50 text-red-600 transition hover:bg-red-100"
                              title="حذف التعريف"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </section>
            )}

            {formError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}
          </SheetBody>

        </form>
      </SheetContent>
    </Sheet>
  );
}

function MiniStep({ number, active, done }) {
  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
        active
          ? 'bg-[rgb(2,27,76)] text-white'
          : done
            ? 'bg-[rgb(2,27,76)]/10 text-[rgb(2,27,76)]'
            : 'bg-white text-slate-500'
      }`}
    >
      {done ? '✓' : number}
    </span>
  );
}
