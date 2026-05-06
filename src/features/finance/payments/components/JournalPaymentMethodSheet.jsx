import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetDismissButton,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { cn } from '@/core/utils/cn';

const defaultDraft = {
  journalId: '',
  paymentMethodId: '',
  paymentType: 'inbound',
  name: '',
  sequence: 10,
  requireReference: false,
  requireAttachment: false,
  isActive: true,
};

const paymentTypeOptions = [
  { value: 'inbound', label: 'وارد' },
  { value: 'outbound', label: 'صادر' },
];

export function JournalPaymentMethodSheet({
  open,
  onOpenChange,
  line,
  journals = [],
  methods = [],
  methodLines = [],
  isSaving,
  onSave,
}) {
  const [draft, setDraft] = useState(defaultDraft);
  const [formError, setFormError] = useState('');
  const isEditing = Boolean(line?.id);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(
      line
        ? {
            journalId: line.journalId ?? '',
            paymentMethodId: line.paymentMethodId ?? '',
            paymentType: line.paymentType ?? line.payment_type ?? 'inbound',
            name: line.name ?? '',
            sequence: line.sequence ?? 10,
            requireReference: line.requireReference ?? line.require_reference ?? false,
            requireAttachment: line.requireAttachment ?? line.require_attachment ?? false,
            isActive: line.isActive ?? line.active ?? true,
          }
        : {
            ...defaultDraft,
            journalId: journals[0]?.id ?? '',
            paymentMethodId: methods[0]?.id ?? '',
          },
    );
    setFormError('');
  }, [journals, line, methods, open]);

  const selectedJournal = useMemo(
    () => journals.find((journal) => journal.id === draft.journalId) ?? null,
    [draft.journalId, journals],
  );
  const selectedMethod = useMemo(
    () => methods.find((method) => method.id === draft.paymentMethodId) ?? null,
    [draft.paymentMethodId, methods],
  );

  const updateDraft = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFormError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!draft.journalId) {
      setFormError('اختر الجورنال المالي.');
      return;
    }

    if (!selectedJournal || selectedJournal.isActive === false || !['cash', 'bank'].includes(selectedJournal.type)) {
      setFormError('الجورنال المالي يجب أن يكون نشطًا ومن نوع نقدي أو بنكي.');
      return;
    }

    if (!draft.paymentMethodId) {
      setFormError('اختر طريقة الدفع.');
      return;
    }

    if (!selectedMethod || selectedMethod.isActive === false) {
      setFormError('طريقة الدفع يجب أن تكون نشطة.');
      return;
    }

    if (!['inbound', 'outbound'].includes(draft.paymentType)) {
      setFormError('اختر نوع حركة صحيح.');
      return;
    }

    if (!draft.name.trim()) {
      setFormError('اكتب اسم الربط.');
      return;
    }
    if (Number(draft.sequence) < 0) {
      setFormError('الترتيب يجب أن يكون رقمًا صحيحًا.');
      return;
    }

    const duplicate = methodLines.some(
      (item) =>
        item.id !== line?.id &&
        item.journalId === draft.journalId &&
        item.paymentMethodId === draft.paymentMethodId &&
        item.paymentType === draft.paymentType,
    );

    if (duplicate) {
      setFormError('هذا الربط موجود بالفعل لنفس الجورنال المالي وطريقة الدفع ونوع الحركة.');
      return;
    }

    const result = await onSave?.({
      id: line?.id,
      journalId: draft.journalId,
      paymentMethodId: draft.paymentMethodId,
      paymentType: draft.paymentType,
      name: draft.name.trim(),
      sequence: Number.isFinite(Number(draft.sequence)) ? Number(draft.sequence) : 10,
      requireReference: draft.requireReference,
      requireAttachment: draft.requireAttachment,
      isActive: draft.isActive,
    });

    if (result?.error) {
      setFormError(result.error);
      return;
    }

    onOpenChange?.(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-lg" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pr-6 pl-16">
          <SheetTitle>{isEditing ? 'تعديل ربط طريقة دفع' : 'ربط طريقة دفع بجورنال'}</SheetTitle>
          <SheetDescription>اربط طريقة دفع محاسبية نشطة بجورنال مالي نقدي أو بنكي نشط.</SheetDescription>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="journal-method-journal">الجورنال المالي</Label>
              <select
                id="journal-method-journal"
                className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm font-semibold text-slate-950 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                value={draft.journalId}
                onChange={(event) => updateDraft('journalId', event.target.value)}
              >
                <option value="">اختر الجورنال المالي</option>
                {journals.map((journal) => (
                  <option key={journal.id} value={journal.id}>
                    {journal.name} - {journal.type === 'cash' ? 'نقدي' : 'بنكي'}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="journal-method-payment-method">طريقة الدفع</Label>
              <select
                id="journal-method-payment-method"
                className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm font-semibold text-slate-950 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                value={draft.paymentMethodId}
                onChange={(event) => updateDraft('paymentMethodId', event.target.value)}
              >
                <option value="">اختر طريقة الدفع</option>
                {methods.map((method) => (
                  <option key={method.id} value={method.id}>
                    {method.name} - {method.paymentType === 'inbound' ? 'وارد' : 'صادر'}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="journal-method-type">نوع الحركة</Label>
              <select
                id="journal-method-type"
                className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm font-semibold text-slate-950 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                value={draft.paymentType}
                onChange={(event) => updateDraft('paymentType', event.target.value)}
              >
                {paymentTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="journal-method-name">اسم الربط</Label>
              <Input
                id="journal-method-name"
                value={draft.name}
                placeholder="مثال: نقدي وارد - الجورنال الرئيسي"
                onChange={(event) => updateDraft('name', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="journal-method-sequence">الترتيب</Label>
              <Input
                id="journal-method-sequence"
                type="number"
                min="0"
                value={draft.sequence}
                onChange={(event) => updateDraft('sequence', event.target.value)}
              />
            </div>

            <RequirementSwitch
              checked={draft.requireReference}
              label="المرجع مطلوب"
              description="يتطلب إدخال مرجع عند استخدام هذا الربط."
              onChange={(checked) => updateDraft('requireReference', checked)}
            />

            <RequirementSwitch
              checked={draft.requireAttachment}
              label="المرفق مطلوب"
              description="يتطلب إرفاق مستند عند استخدام هذا الربط."
              onChange={(checked) => updateDraft('requireAttachment', checked)}
            />

            <button
              type="button"
              role="switch"
              aria-checked={draft.isActive}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-right"
              onClick={() => updateDraft('isActive', !draft.isActive)}
            >
              <span>
                <span className="block text-sm font-semibold text-slate-950">الحالة</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {draft.isActive ? 'الربط متاح للاستخدام المحاسبي.' : 'الربط متوقف مؤقتًا.'}
                </span>
              </span>
              <span
                className={cn(
                  'relative h-7 w-12 shrink-0 rounded-full transition',
                  draft.isActive ? 'bg-emerald-600' : 'bg-slate-300',
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition',
                    draft.isActive ? 'right-6' : 'right-1',
                  )}
                />
              </span>
            </button>

            {formError ? (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                {formError}
              </div>
            ) : null}
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange?.(false)}>
              إلغاء
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'جار الحفظ...' : isEditing ? 'حفظ التعديل' : 'إضافة الربط'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function RequirementSwitch({ checked, label, description, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-right"
      onClick={() => onChange(!checked)}
    >
      <span>
        <span className="block text-sm font-semibold text-slate-950">{label}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
      </span>
      <span className={cn('relative h-7 w-12 shrink-0 rounded-full transition', checked ? 'bg-emerald-600' : 'bg-slate-300')}>
        <span
          className={cn(
            'absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition',
            checked ? 'right-6' : 'right-1',
          )}
        />
      </span>
    </button>
  );
}
