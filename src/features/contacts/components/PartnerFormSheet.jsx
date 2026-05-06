import { useEffect, useState } from 'react';
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

const EMPTY_FORM = {
  name: '',
  phone: '',
  nationalId: '',
  address: '',
  notes: '',
  isCustomer: true,
  isSupplier: false,
  receivableAccount: '',
  payableAccount: '',
};

function normalizeInitialValues(initialValues) {
  if (!initialValues) return EMPTY_FORM;

  return {
    name: initialValues.name ?? '',
    phone: initialValues.phone ?? '',
    nationalId: initialValues.nationalId ?? initialValues.national_id ?? '',
    address: initialValues.address ?? '',
    notes: initialValues.notes ?? '',
    isCustomer: initialValues.isCustomer ?? (Number(initialValues.customerRank ?? 0) > 0),
    isSupplier: initialValues.isSupplier ?? (Number(initialValues.supplierRank ?? 0) > 0),
    receivableAccount: initialValues.receivableAccount ?? '',
    payableAccount: initialValues.payableAccount ?? '',
  };
}

export function PartnerFormSheet({
  open,
  onOpenChange,
  initialValues,
  onSubmit,
  isSubmitting = false,
  side = 'bottom',
  hideTypeFields = false,
  hideAccountingFields = false,
  hideFooterNote = false,
  hideCancelButton = false,
  accentHeader = false,
  submitInHeader = false,
  hideDismissButton = false,
  inlineSubmit = false,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(normalizeInitialValues(initialValues));
    setError('');
  }, [open, initialValues]);

  const isEditMode = Boolean(initialValues?.id);
  const shouldShowFooter = (!submitInHeader && !inlineSubmit) || !hideFooterNote || !hideCancelButton;

  const handleChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.name.trim()) {
      setError('اسم جهة الاتصال مطلوب.');
      return;
    }

    const isCustomer = hideTypeFields ? true : form.isCustomer;
    const isSupplier = hideTypeFields ? false : form.isSupplier;

    if (!isCustomer && !isSupplier) {
      setError('يجب تحديد الجهة كعميل أو مورد على الأقل.');
      return;
    }

    const result = await onSubmit({
      ...form,
      isCustomer,
      isSupplier,
      customerRank: isCustomer ? 1 : 0,
      supplierRank: isSupplier ? 1 : 0,
    });

    if (!result?.ok) {
      setError(result?.error || 'تعذر حفظ جهة الاتصال.');
      return;
    }

    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side={side} className={side === 'bottom' ? 'max-h-[88vh]' : 'max-w-md'}>
        <SheetHeader className={accentHeader ? 'border-b-0 bg-[linear-gradient(135deg,#0f172a_0%,#155e75_100%)] px-7 py-6 text-white shadow-[0_20px_42px_-34px_rgba(15,23,42,0.9)]' : undefined}>
          <SheetTitle className={accentHeader ? 'text-2xl font-black tracking-tight text-white' : undefined}>
            {isEditMode ? 'تعديل جهة الاتصال' : 'إضافة جهة اتصال'}
          </SheetTitle>
          <SheetDescription className={accentHeader ? 'max-w-[18rem] text-sm font-semibold leading-6 text-cyan-50/80' : undefined}>
            أدخل بيانات العميل الأساسية لإضافته إلى عملية البيع.
          </SheetDescription>
          {submitInHeader ? (
            <Button
              type="submit"
              form="partner-form"
              disabled={isSubmitting}
              className="absolute left-5 top-5 h-10 rounded-xl bg-white px-5 text-sm font-black text-slate-950 shadow-[0_16px_30px_-18px_rgba(255,255,255,0.9)] hover:bg-cyan-50"
            >
              {isSubmitting ? 'جار الحفظ...' : isEditMode ? 'حفظ' : 'إضافة'}
            </Button>
          ) : null}
          {!hideDismissButton && <SheetDismissButton className={accentHeader ? 'border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white' : undefined} />}
        </SheetHeader>

        <SheetBody className={accentHeader ? 'bg-slate-50 px-7 py-6' : undefined}>
          <form id="partner-form" className="space-y-5" onSubmit={handleSubmit}>
            {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="partner-name">الاسم</Label>
                <Input id="partner-name" value={form.name} onChange={handleChange('name')} placeholder="اسم الجهة" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="partner-phone">الهاتف</Label>
                <Input id="partner-phone" value={form.phone} onChange={handleChange('phone')} placeholder="01000000000" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="partner-national-id">الرقم القومي</Label>
                <Input
                  id="partner-national-id"
                  value={form.nationalId}
                  onChange={handleChange('nationalId')}
                  placeholder="الرقم القومي للعميل"
                  inputMode="numeric"
                  dir="ltr"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="partner-address">العنوان</Label>
                <Input id="partner-address" value={form.address} onChange={handleChange('address')} placeholder="المدينة - الشارع" />
              </div>
            </div>

            {!hideTypeFields && (
              <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-2">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={form.isCustomer} onChange={handleChange('isCustomer')} />
                  هل عميل؟
                </label>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input type="checkbox" checked={form.isSupplier} onChange={handleChange('isSupplier')} />
                  هل مورد؟
                </label>
              </div>
            )}

            {!hideAccountingFields && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="partner-receivable">حساب العملاء (محاسبي)</Label>
                  <Input
                    id="partner-receivable"
                    value={form.receivableAccount}
                    onChange={handleChange('receivableAccount')}
                    placeholder="Account Code"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="partner-payable">حساب الموردين (محاسبي)</Label>
                  <Input
                    id="partner-payable"
                    value={form.payableAccount}
                    onChange={handleChange('payableAccount')}
                    placeholder="Account Code"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="partner-notes">ملاحظات</Label>
              <textarea
                id="partner-notes"
                value={form.notes}
                onChange={handleChange('notes')}
                rows={4}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-100"
                placeholder="أي ملاحظات إضافية"
              />
            </div>

            {inlineSubmit && (
              <Button type="submit" className="h-11 w-full rounded-xl bg-[#155e75] font-black text-white shadow-[0_18px_32px_-24px_rgba(21,94,117,0.9)] hover:bg-[#0f4f63]" disabled={isSubmitting}>
                {isSubmitting ? 'جار الحفظ...' : isEditMode ? 'حفظ التعديل' : 'إضافة'}
              </Button>
            )}
          </form>
        </SheetBody>

        {shouldShowFooter && (
          <SheetFooter>
            {hideFooterNote ? null : (
              <div className="text-xs text-slate-500">
                {hideAccountingFields ? 'يمكنك تعديل بيانات العميل لاحقاً من صفحة العملاء.' : 'يمكنك تعديل الحسابات المحاسبية لاحقاً من صفحة القيود.'}
              </div>
            )}
            {!submitInHeader && !inlineSubmit && (
              <div className="flex items-center gap-2">
                {!hideCancelButton && (
                  <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                    إلغاء
                  </Button>
                )}
                <Button type="submit" form="partner-form" disabled={isSubmitting}>
                  {isSubmitting ? 'جار الحفظ...' : isEditMode ? 'حفظ التعديل' : 'إضافة'}
                </Button>
              </div>
            )}
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
