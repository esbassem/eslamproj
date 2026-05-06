import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDismissButton,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';

const BEHAVIOR_OPTIONS = [
  {
    value: 'variant',
    title: 'خاصية عادية',
    description: 'تنشئ نسخة وتظهر في الاسم',
  },
  {
    value: 'commercial',
    title: 'خاصية تجارية',
    description: 'تنشئ نسخة وتظهر في الاسم وتفعل الفلاتر',
  },
  {
    value: 'informational',
    title: 'معلومة فقط',
    description: 'لا تنشئ نسخة ولا تظهر في الاسم',
  },
];

function getBehaviorFlags(behavior) {
  if (!behavior) {
    return {
      behavior: '',
      createsVariant: false,
      showInVariantName: false,
      showInPosFilter: false,
      isFilterable: false,
    };
  }

  if (behavior === 'informational') {
    return {
      behavior: 'informational',
      createsVariant: false,
      showInVariantName: false,
      showInPosFilter: false,
      isFilterable: false,
    };
  }

  if (behavior === 'commercial') {
    return {
      behavior: 'commercial',
      createsVariant: true,
      showInVariantName: true,
      showInPosFilter: true,
      isFilterable: true,
    };
  }

  return {
    behavior: 'variant',
    createsVariant: true,
    showInVariantName: true,
    showInPosFilter: false,
    isFilterable: false,
  };
}

function getInitialState(record) {
  const behaviorFlags = getBehaviorFlags(record ? record.behavior : '');

  return {
    name: record?.name ?? '',
    behavior: behaviorFlags.behavior,
    createsVariant: behaviorFlags.createsVariant,
    showInVariantName: behaviorFlags.showInVariantName,
    displayType: record?.displayType ?? 'select',
    showInPosFilter: behaviorFlags.showInPosFilter,
    isFilterable: behaviorFlags.isFilterable,
    useInSku: record?.useInSku ?? false,
    sortOrder: record?.sortOrder ?? 0,
    isActive: record?.isActive ?? true,
    categoryIds: record?.categoryIds ?? [],
  };
}

export function AttributeFormSheet({ open, onOpenChange, record, categories, onSubmit, isSubmitting }) {
  const [formState, setFormState] = useState(() => getInitialState(record));
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFormState(getInitialState(record));
    setFormError('');
  }, [open, record]);

  const handleBehaviorChange = (event) => {
    const nextFlags = getBehaviorFlags(event.target.value);
    setFormState((current) => ({
      ...current,
      behavior: nextFlags.behavior,
      createsVariant: nextFlags.createsVariant,
      showInVariantName: nextFlags.showInVariantName,
      showInPosFilter: nextFlags.showInPosFilter,
      isFilterable: nextFlags.isFilterable,
    }));
  };

  const sortedCategories = useMemo(
    () => [...categories].sort((left, right) => String(left.name).localeCompare(String(right.name))),
    [categories],
  );

  const toggleCategory = (categoryId) => {
    setFormState((current) => {
      const selected = new Set(current.categoryIds ?? []);
      if (selected.has(categoryId)) {
        selected.delete(categoryId);
      } else {
        selected.add(categoryId);
      }

      return {
        ...current,
        categoryIds: [...selected],
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formState.name.trim()) {
      setFormError('اسم الخاصية مطلوب.');
      return;
    }

    if (!formState.behavior) {
      setFormError('نوع السلوك مطلوب.');
      return;
    }

    const result = await onSubmit({
      ...formState,
      categoryIds: [...new Set((formState.categoryIds ?? []).filter(Boolean))],
    });

    if (result?.error) {
      setFormError(result.error);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-4xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>{record ? 'تعديل خاصية' : 'إضافة خاصية'}</SheetTitle>
        </SheetHeader>

        <form className="flex h-full min-h-0 flex-col" onSubmit={handleSubmit}>
          <SheetBody className="min-h-0 space-y-5 overscroll-y-contain">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="attribute-name">اسم الخاصية</Label>
                <Input
                  id="attribute-name"
                  value={formState.name}
                  onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>نوع السلوك</Label>
                <div className="grid gap-3 md:grid-cols-3">
                  {BEHAVIOR_OPTIONS.map((option) => {
                    const active = formState.behavior === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => handleBehaviorChange({ target: { value: option.value } })}
                        className={`rounded-2xl border p-4 text-right transition ${
                          active
                            ? 'border-[rgb(2,27,76)] bg-[rgb(2,27,76)] text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-extrabold">{option.title}</div>
                            <div className={`mt-1 text-sm font-semibold ${active ? 'text-white/80' : 'text-slate-500'}`}>
                              {option.description}
                            </div>
                          </div>
                          <span
                            className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${
                              active ? 'border-white/25 bg-white/10 text-white' : 'border-slate-200 bg-slate-50 text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

            </div>

            {record ? (
              <section className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2">
                <ToggleCard
                  label="الحالة"
                  checked={Boolean(formState.isActive)}
                  onChange={(checked) => setFormState((current) => ({ ...current, isActive: checked }))}
                  checkboxLabel="نشط"
                />
              </section>
            ) : null}

            <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="font-extrabold text-slate-950">تظهر تلقائيًا مع التصنيفات</div>
              <div className="mt-1 text-sm font-semibold text-slate-500">
                اختر التصنيفات التي يجب أن تظهر معها هذه الخاصية أثناء إدخال المخزون.
              </div>

              {!sortedCategories.length ? (
                <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                  لا توجد تصنيفات بعد.
                </div>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {sortedCategories.map((category) => {
                    const active = (formState.categoryIds ?? []).includes(category.id);
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => toggleCategory(category.id)}
                        className={`rounded-2xl border px-4 py-4 text-right transition ${
                          active
                            ? 'border-[rgb(2,27,76)] bg-[rgb(2,27,76)] text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-extrabold">{category.name}</div>
                            <div className={`mt-1 text-xs font-semibold ${active ? 'text-white/75' : 'text-slate-500'}`}>
                              {category.isActive ? 'تصنيف نشط' : 'تصنيف غير نشط'}
                            </div>
                          </div>
                          <span
                            className={`inline-flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold ${
                              active ? 'border-white/25 bg-white/10 text-white' : 'border-slate-200 bg-slate-50 text-slate-500'
                            }`}
                          >
                            {active ? '✓' : ''}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {formError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'جارٍ الحفظ...' : 'حفظ'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ToggleCard({ label, checked, onChange, checkboxLabel = 'مفعل' }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <label className="flex h-11 items-center gap-3 rounded-xl border border-border bg-white px-3 text-sm font-semibold">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        {checkboxLabel}
      </label>
    </div>
  );
}
