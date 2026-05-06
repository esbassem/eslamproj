import { useEffect, useState } from 'react';
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

const DATA_TYPE_OPTIONS = [
  { value: '', label: 'بدون تحديد' },
  { value: 'english_letter', label: 'حرف إنجليزي' },
  { value: 'arabic_letter', label: 'حرف عربي' },
  { value: 'numeric', label: 'رقم' },
];

const DEFAULT_SLOT_COUNT = 1;
const MAX_SLOT_COUNT = 24;

function buildSlots(count, existingSlots = []) {
  return Array.from({ length: count }, (_, index) => ({
    type: existingSlots[index]?.type ?? '',
  }));
}

function buildDefaultSlots(count, type) {
  return Array.from({ length: count }, () => ({ type }));
}

function getLegacyDataType(slots) {
  const specifiedSlots = slots.filter((slot) => slot.type);
  return specifiedSlots.length && specifiedSlots.every((slot) => slot.type === 'numeric') ? 'numeric' : 'text';
}

function getInitialState(record) {
  const hasSlotPattern = Boolean(record?.hasSlotPattern ?? record?.slots?.length);
  const slotCount = Number(record?.slotCount) || record?.slots?.length || DEFAULT_SLOT_COUNT;
  const slots = record?.slots?.length ? record.slots : buildSlots(slotCount);

  return {
    name: record?.name ?? '',
    code: record?.code ?? '',
    dataType: record?.dataType ?? 'text',
    hasSlotPattern,
    slotCount: slots.length || DEFAULT_SLOT_COUNT,
    defaultSlotType: '',
    slots,
    isActive: record?.isActive ?? true,
  };
}

export function TrackingIdentifierFormSheet({ open, onOpenChange, record, onSubmit, isSubmitting }) {
  const [formState, setFormState] = useState(() => getInitialState(record));
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (!open) return;
    setFormState(getInitialState(record));
    setFormError('');
  }, [open, record]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!formState.name.trim()) {
      setFormError('اسم التعريف مطلوب.');
      return;
    }

    if (!formState.code.trim()) {
      setFormError('كود التعريف مطلوب.');
      return;
    }

    const slotCount = Number(formState.slotCount);
    if (formState.hasSlotPattern && (!Number.isInteger(slotCount) || slotCount < 1 || slotCount > MAX_SLOT_COUNT)) {
      setFormError(`عدد الخانات يجب أن يكون بين 1 و ${MAX_SLOT_COUNT}.`);
      return;
    }

    const normalizedSlots = formState.hasSlotPattern ? buildSlots(slotCount, formState.slots) : [];
    const result = await onSubmit({
      ...formState,
      hasSlotPattern: Boolean(formState.hasSlotPattern),
      slots: normalizedSlots,
      dataType: getLegacyDataType(normalizedSlots),
      isActive: true,
    });
    if (result?.error) {
      setFormError(result.error);
    }
  };

  const handleSlotCountChange = (value) => {
    const count = Math.min(Math.max(Number(value) || DEFAULT_SLOT_COUNT, DEFAULT_SLOT_COUNT), MAX_SLOT_COUNT);
    setFormState((current) => ({
      ...current,
      slotCount: count,
      slots: buildSlots(count, current.slots).map((slot) => ({ type: slot.type || current.defaultSlotType || '' })),
    }));
  };

  const handleDefaultSlotTypeChange = (type) => {
    setFormState((current) => {
      const count = Number(current.slotCount) || DEFAULT_SLOT_COUNT;
      const nextSlots = buildDefaultSlots(count, type);
      return {
        ...current,
        defaultSlotType: type,
        slots: nextSlots,
        dataType: getLegacyDataType(nextSlots),
      };
    });
  };

  const handleSlotPatternToggle = (checked) => {
    setFormState((current) => ({
      ...current,
      hasSlotPattern: checked,
      slots: checked ? buildSlots(Number(current.slotCount) || DEFAULT_SLOT_COUNT, current.slots) : [],
    }));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-2xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>{record ? 'تعديل تعريف تتبع' : 'إضافة تعريف تتبع'}</SheetTitle>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="tracking-identifier-name">الاسم</Label>
              <Input
                id="tracking-identifier-name"
                value={formState.name}
                onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="tracking-identifier-code">الكود</Label>
              <Input
                id="tracking-identifier-code"
                dir="ltr"
                value={formState.code}
                onChange={(event) => setFormState((current) => ({ ...current, code: event.target.value }))}
              />
            </div>

            <div className="space-y-3 md:col-span-2">
              <label className="flex min-h-11 items-center gap-3 rounded-xl border border-border bg-white px-3 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={Boolean(formState.hasSlotPattern)}
                  onChange={(event) => handleSlotPatternToggle(event.target.checked)}
                />
                تحديد عدد الخانات ونوع كل خانة
              </label>
            </div>

            {formState.hasSlotPattern ? (
              <>
                <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="tracking-identifier-slot-count">عدد الخانات</Label>
                    <Input
                      id="tracking-identifier-slot-count"
                      type="number"
                      min="1"
                      max={MAX_SLOT_COUNT}
                      step="1"
                      value={formState.slotCount}
                      onChange={(event) => handleSlotCountChange(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="tracking-identifier-default-slot-type">افتراضي الخانات</Label>
                    <select
                      id="tracking-identifier-default-slot-type"
                      value={formState.defaultSlotType}
                      onChange={(event) => handleDefaultSlotTypeChange(event.target.value)}
                      className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    >
                      {DATA_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-3 md:col-span-2">
                  <SlotPreview slots={buildSlots(Number(formState.slotCount) || DEFAULT_SLOT_COUNT, formState.slots)} />
                </div>
              </>
            ) : null}

            {formError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 md:col-span-2">{formError}</div> : null}
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

function SlotPreview({ slots }) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3" dir="ltr">
      {slots.map((slot, index) => {
        const label = slot.type === 'numeric' ? '0' : slot.type === 'english_letter' ? 'A' : slot.type === 'arabic_letter' ? 'أ' : '';
        return (
          <span
            key={`tracking-identifier-slot-preview-${index}`}
            className="flex flex-col items-center gap-1"
            title={`الخانة ${index + 1}`}
          >
            <span className="text-[10px] font-black text-slate-400">{index + 1}</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-xs font-black text-slate-500 shadow-sm">
              {label}
            </span>
          </span>
        );
      })}
    </div>
  );
}
