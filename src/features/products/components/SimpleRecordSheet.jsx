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

function initialState(fields, record) {
  return fields.reduce((state, field) => {
    state[field.name] = record?.[field.name] ?? field.defaultValue ?? (field.type === 'checkbox' ? true : '');
    return state;
  }, {});
}

export function SimpleRecordSheet({ open, onOpenChange, title, fields, record, onSubmit, isSubmitting }) {
  const [formState, setFormState] = useState(() => initialState(fields, record));
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (open) {
      setFormState(initialState(fields, record));
      setFormError('');
    }
  }, [fields, open, record]);

  const handleChange = (field) => (event) => {
    const value = field.type === 'checkbox' ? event.target.checked : event.target.value;
    setFormState((current) => ({ ...current, [field.name]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const requiredField = fields.find((field) => field.required && !String(formState[field.name] ?? '').trim());

    if (requiredField) {
      setFormError('يرجى تعبئة الحقول المطلوبة.');
      return;
    }

    const result = await onSubmit(formState);
    if (result?.error) {
      setFormError(result.error);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-h-[92vh] w-full max-w-3xl">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="grid gap-4 md:grid-cols-2">
            {fields.map((field) => (
              <div key={field.name} className={field.type === 'textarea' ? 'space-y-2 md:col-span-2' : 'space-y-2'}>
                <Label htmlFor={field.name}>{field.label}</Label>
                {field.type === 'select' ? (
                  <select
                    id={field.name}
                    className="h-11 w-full rounded-xl border border-border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={formState[field.name] ?? ''}
                    onChange={handleChange(field)}
                  >
                    <option value="">بدون</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.type === 'checkbox' ? (
                  <label className="flex h-11 items-center gap-3 rounded-xl border border-border bg-white px-3 text-sm font-semibold">
                    <input type="checkbox" checked={Boolean(formState[field.name])} onChange={handleChange(field)} />
                    {field.checkboxLabel ?? 'نشط'}
                  </label>
                ) : field.type === 'textarea' ? (
                  <textarea
                    id={field.name}
                    className="min-h-28 w-full rounded-xl border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={formState[field.name] ?? ''}
                    onChange={handleChange(field)}
                  />
                ) : (
                  <Input
                    id={field.name}
                    type={field.type ?? 'text'}
                    value={formState[field.name] ?? ''}
                    onChange={handleChange(field)}
                  />
                )}
              </div>
            ))}
            {formError ? <div className="md:col-span-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div> : null}
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
