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

function getInitialState(record) {
  return {
    attributeId: record?.attributeId ?? '',
    name: record?.name ?? '',
    code: record?.code ?? '',
    colorHex: record?.colorHex ?? '',
    imageUrl: record?.imageUrl ?? '',
    extraPrice: record?.extraPrice ?? 0,
    showInVariantName: record?.showInVariantName ?? true,
    sortOrder: record?.sortOrder ?? 0,
    isActive: record?.isActive ?? true,
  };
}

export function AttributeValueFormSheet({ open, onOpenChange, record, attributes, onSubmit, isSubmitting }) {
  const [formState, setFormState] = useState(() => getInitialState(record));
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFormState(getInitialState(record));
    setFormError('');
  }, [open, record]);

  const selectedAttribute = useMemo(
    () => attributes.find((attribute) => attribute.id === formState.attributeId) ?? null,
    [attributes, formState.attributeId],
  );

  const sortedAttributes = useMemo(
    () => [...attributes].sort((left, right) => String(left.name).localeCompare(String(right.name))),
    [attributes],
  );

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formState.attributeId) {
      setFormError('اختر الخاصية أولًا.');
      return;
    }

    if (!formState.name.trim()) {
      setFormError('اسم القيمة مطلوب.');
      return;
    }

    const result = await onSubmit({
      ...formState,
      colorHex: selectedAttribute?.displayType === 'color' ? formState.colorHex : '',
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
          <SheetTitle>{record ? 'تعديل قيمة خاصية' : 'إضافة قيمة خاصية'}</SheetTitle>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="attribute-value-attribute">الخاصية</Label>
                <select
                  id="attribute-value-attribute"
                  className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={formState.attributeId}
                  onChange={(event) => setFormState((current) => ({ ...current, attributeId: event.target.value }))}
                >
                  <option value="">اختر خاصية</option>
                  {sortedAttributes.map((attribute) => (
                    <option key={attribute.id} value={attribute.id}>{attribute.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="attribute-value-name">اسم القيمة</Label>
                <Input
                  id="attribute-value-name"
                  value={formState.name}
                  onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                />
              </div>

              {selectedAttribute?.displayType === 'color' ? (
                <div className="space-y-2">
                  <Label htmlFor="attribute-value-color-hex">لون العرض</Label>
                  <div className="flex items-center gap-3">
                    <input
                      id="attribute-value-color-hex"
                      type="color"
                      className="h-11 w-16 rounded-xl border border-border bg-white p-1"
                      value={formState.colorHex || '#000000'}
                      onChange={(event) => setFormState((current) => ({ ...current, colorHex: event.target.value }))}
                    />
                    <Input
                      value={formState.colorHex}
                      onChange={(event) => setFormState((current) => ({ ...current, colorHex: event.target.value }))}
                      placeholder="#000000"
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <section className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2">
              <ToggleCard
                label="تظهر في اسم النسخة"
                checked={Boolean(formState.showInVariantName)}
                onChange={(checked) => setFormState((current) => ({ ...current, showInVariantName: checked }))}
              />
              <ToggleCard
                label="الحالة"
                checked={Boolean(formState.isActive)}
                onChange={(checked) => setFormState((current) => ({ ...current, isActive: checked }))}
                checkboxLabel="نشط"
              />
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
