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
  name: '',
  code: '',
  paymentType: 'inbound',
  notes: '',
  isSystem: false,
  isActive: true,
};

const paymentTypeOptions = [
  { value: 'inbound', label: 'وارد' },
  { value: 'outbound', label: 'صادر' },
];

export function PaymentMethodSheet({ open, onOpenChange, method, methods = [], isSaving, onSave }) {
  const [draft, setDraft] = useState(defaultDraft);
  const [formError, setFormError] = useState('');
  const isEditing = Boolean(method?.id);
  const isSystemMethod = Boolean(method?.isSystem ?? method?.is_system);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(
      method
        ? {
            name: method.name ?? '',
            code: method.code ?? '',
            paymentType: method.paymentType ?? method.payment_type ?? 'inbound',
            notes: method.notes ?? '',
            isSystem: method.isSystem ?? method.is_system ?? false,
            isActive: method.isActive ?? method.active ?? true,
          }
        : defaultDraft,
    );
    setFormError('');
  }, [method, open]);

  const normalizedCode = useMemo(() => draft.code.trim().toLowerCase(), [draft.code]);

  const updateDraft = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFormError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!draft.name.trim()) {
      setFormError('اكتب اسم طريقة الدفع.');
      return;
    }

    if (!normalizedCode) {
      setFormError('اكتب كود طريقة الدفع.');
      return;
    }

    if (!['inbound', 'outbound'].includes(draft.paymentType)) {
      setFormError('اختر نوع دفع صحيح.');
      return;
    }

    const duplicate = methods.some(
      (item) => item.id !== method?.id && item.code?.trim().toLowerCase() === normalizedCode,
    );

    if (duplicate) {
      setFormError('هذا الكود مستخدم بالفعل.');
      return;
    }

    const result = await onSave?.({
      id: method?.id,
      name: draft.name.trim(),
      code: normalizedCode,
      paymentType: draft.paymentType,
      notes: draft.notes.trim(),
      isSystem: draft.isSystem,
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
          <SheetTitle>{isEditing ? 'تعديل طريقة دفع' : 'إضافة طريقة دفع'}</SheetTitle>
          <SheetDescription>حدد بيانات طريقة الدفع المحاسبية كما ستظهر داخل إعدادات الدفع.</SheetDescription>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="payment-method-name">الاسم</Label>
              <Input
                id="payment-method-name"
                value={draft.name}
                placeholder="مثال: نقدي وارد"
                onChange={(event) => updateDraft('name', event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment-method-notes">ملاحظات</Label>
              <textarea
                id="payment-method-notes"
                className="min-h-24 w-full resize-none rounded-xl border border-border bg-white px-4 py-3 text-right text-sm font-medium text-slate-950 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                value={draft.notes}
                placeholder="ملاحظات داخلية اختيارية"
                onChange={(event) => updateDraft('notes', event.target.value)}
              />
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={draft.isSystem}
              disabled={isSystemMethod}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-right"
              onClick={() => updateDraft('isSystem', !draft.isSystem)}
            >
              <span>
                <span className="block text-sm font-semibold text-slate-950">طريقة نظامية</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {draft.isSystem ? 'سيتم تمييزها كطريقة نظامية داخل إعدادات الدفع.' : 'طريقة دفع عادية قابلة للإدارة.'}
                </span>
              </span>
              <span
                className={cn(
                  'relative h-7 w-12 shrink-0 rounded-full transition',
                  draft.isSystem ? 'bg-blue-600' : 'bg-slate-300',
                )}
              >
                <span
                  className={cn(
                    'absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition',
                    draft.isSystem ? 'right-6' : 'right-1',
                  )}
                />
              </span>
            </button>

            <div className="space-y-2">
              <Label htmlFor="payment-method-code">الكود</Label>
              <Input
                id="payment-method-code"
                dir="ltr"
                className="text-left"
                value={draft.code}
                placeholder="cash_in"
                disabled={isSystemMethod}
                onChange={(event) => updateDraft('code', event.target.value)}
              />
              <p className="text-xs leading-5 text-muted-foreground">يجب أن يكون الكود فريدًا وغير مكرر.</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="payment-method-type">نوع الدفع</Label>
              <select
                id="payment-method-type"
                className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm font-semibold text-slate-950 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                value={draft.paymentType}
                disabled={isSystemMethod}
                onChange={(event) => updateDraft('paymentType', event.target.value)}
              >
                {paymentTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

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
                  {draft.isActive ? 'طريقة الدفع المحاسبية متاحة للاستخدام.' : 'طريقة الدفع المحاسبية متوقفة مؤقتًا.'}
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
              {isSaving ? 'جار الحفظ...' : isEditing ? 'حفظ التعديل' : 'إضافة الطريقة'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
