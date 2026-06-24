import { useEffect, useRef, useState } from 'react';
import { UploadCloud, X } from 'lucide-react';
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
  parentId: null,
  contactType: 'person',
  functionTitle: '',
  nationalId: '',
  identityCardFrontFile: null,
  identityCardBackFile: null,
  address: '',
  notes: '',
  isCustomer: true,
  isSupplier: false,
  isCompany: false,
  companyType: '',
  receivableAccount: '',
  payableAccount: '',
};

const NATIONAL_ID_LENGTH = 14;

function normalizeInitialValues(initialValues) {
  if (!initialValues) return EMPTY_FORM;

  return {
    name: initialValues.name ?? '',
    phone: initialValues.phone ?? '',
    parentId: initialValues.parentId ?? initialValues.parent_id ?? null,
    contactType: initialValues.contactType ?? initialValues.contact_type ?? 'person',
    functionTitle: initialValues.functionTitle ?? initialValues.function_title ?? '',
    nationalId: initialValues.nationalId ?? initialValues.national_id ?? '',
    identityCardFrontFile: null,
    identityCardBackFile: null,
    address: initialValues.address ?? '',
    notes: initialValues.notes ?? '',
    isCustomer: initialValues.isCustomer ?? (Number(initialValues.customerRank ?? 0) > 0),
    isSupplier: initialValues.isSupplier ?? (Number(initialValues.supplierRank ?? 0) > 0),
    isCompany: initialValues.isCompany ?? initialValues.is_company ?? false,
    companyType: initialValues.companyType ?? initialValues.company_type ?? '',
    receivableAccount: initialValues.receivableAccount ?? '',
    payableAccount: initialValues.payableAccount ?? '',
  };
}

function validateImageFile(file) {
  return !file || file.type?.startsWith('image/');
}

function NationalIdBoxes({ value, onChange }) {
  const inputRefs = useRef([]);
  const digits = String(value || '').replace(/\D/g, '').slice(0, NATIONAL_ID_LENGTH).padEnd(NATIONAL_ID_LENGTH, ' ').split('');

  const updateDigit = (index, nextValue) => {
    const nextDigit = nextValue.replace(/\D/g, '').slice(-1);
    const nextDigits = [...digits].map((digit) => (digit === ' ' ? '' : digit));
    nextDigits[index] = nextDigit;
    onChange(nextDigits.join('').slice(0, NATIONAL_ID_LENGTH));

    if (nextDigit && index < NATIONAL_ID_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index) => (event) => {
    if (event.key === 'Backspace' && !digits[index].trim() && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (index) => (event) => {
    event.preventDefault();
    const pastedDigits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, NATIONAL_ID_LENGTH - index);

    if (!pastedDigits) return;

    const nextDigits = [...digits].map((digit) => (digit === ' ' ? '' : digit));
    pastedDigits.split('').forEach((digit, digitIndex) => {
      nextDigits[index + digitIndex] = digit;
    });

    onChange(nextDigits.join('').slice(0, NATIONAL_ID_LENGTH));
    inputRefs.current[Math.min(index + pastedDigits.length, NATIONAL_ID_LENGTH - 1)]?.focus();
  };

  return (
    <div className="w-full overflow-x-auto rounded-xl border border-slate-200 bg-white px-2 py-2" dir="ltr">
      <div className="flex w-max flex-nowrap gap-0.5">
        {digits.map((digit, index) => (
          <div key={index} className={`flex items-center ${index === 5 || index === 10 ? 'ml-2' : ''}`}>
            <input
              ref={(element) => {
                inputRefs.current[index] = element;
              }}
              value={digit.trim()}
              onChange={(event) => updateDigit(index, event.target.value)}
              onKeyDown={handleKeyDown(index)}
              onPaste={handlePaste(index)}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={1}
              aria-label={`رقم ${index + 1} من الرقم القومي`}
              className="h-7 w-5 shrink-0 rounded border border-slate-400 bg-slate-50 text-center font-mono text-sm font-black leading-none text-slate-950 outline-none transition focus:border-slate-800 focus:bg-white focus:ring-2 focus:ring-slate-200"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function IdentityImagePicker({ id, title, file, onChange, onClear }) {
  const [previewUrl, setPreviewUrl] = useState('');

  useEffect(() => {
    if (!file) {
      setPreviewUrl('');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-dashed border-slate-300 bg-slate-50 transition hover:border-slate-400 hover:bg-white">
      <label htmlFor={id} className="block cursor-pointer">
        <div className="relative aspect-[16/10]">
          {previewUrl ? (
            <img src={previewUrl} alt={title} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm">
                <UploadCloud className="h-5 w-5" />
              </div>
              <span className="mt-3 text-sm font-black text-slate-900">{title}</span>
              <span className="mt-1 text-xs font-bold text-slate-500">اضغط لاختيار صورة</span>
            </div>
          )}
        </div>
      </label>
      {file ? (
        <>
          <div className="border-t border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">
            <span className="block truncate">{file.name}</span>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="absolute left-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/95 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-950"
            aria-label={`إزالة ${title}`}
          >
            <X className="h-4 w-4" />
          </button>
        </>
      ) : null}
      <input id={id} type="file" accept="image/*" className="sr-only" onChange={onChange} />
    </div>
  );
}

export function PartnerFormSheet({
  open,
  onOpenChange,
  initialValues,
  onSubmit,
  isSubmitting = false,
  side = 'bottom',
  hideTypeFields = false,
  hideCompanyFields = false,
  hideNotesField = false,
  hideAccountingFields = false,
  hideFooterNote = false,
  hideCancelButton = false,
  accentHeader = false,
  submitInHeader = false,
  hideDismissButton = false,
  inlineSubmit = false,
  parentPartner = null,
  childContactMode = false,
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(normalizeInitialValues(initialValues));
    setError('');
  }, [open, initialValues]);

  const isEditMode = Boolean(initialValues?.id);
  const isChildContactMode = childContactMode || Boolean(parentPartner);
  const shouldShowFooter = (!submitInHeader && !inlineSubmit) || !hideFooterNote || !hideCancelButton;

  const handleChange = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleFileChange = (field) => (event) => {
    const file = event.target.files?.[0] || null;
    setForm((current) => ({ ...current, [field]: file }));
  };

  const clearFile = (field) => {
    setForm((current) => ({ ...current, [field]: null }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!form.name.trim()) {
      setError('اسم جهة الاتصال مطلوب.');
      return;
    }

    if (!validateImageFile(form.identityCardFrontFile) || !validateImageFile(form.identityCardBackFile)) {
      setError('يمكن رفع صور فقط في صور البطاقة.');
      return;
    }

    const isCustomer = isChildContactMode ? false : hideTypeFields ? true : form.isCustomer;
    const isSupplier = isChildContactMode ? false : hideTypeFields ? false : form.isSupplier;
    const parentId = parentPartner?.id || form.parentId || null;
    const isCompany = isChildContactMode ? false : form.isCompany;
    const contactType = isChildContactMode ? 'contact' : isCompany ? 'company' : parentId ? 'contact' : 'person';

    const result = await onSubmit({
      ...form,
      parentId,
      contactType,
      isCompany,
      companyType: isCompany ? form.companyType : '',
      functionTitle: form.functionTitle,
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
            {isChildContactMode ? (isEditMode ? 'تعديل جهة اتصال تابعة' : 'إضافة جهة اتصال تابعة') : isEditMode ? 'تعديل جهة الاتصال' : 'إضافة جهة اتصال'}
          </SheetTitle>
          <SheetDescription className={accentHeader ? 'max-w-[18rem] text-sm font-semibold leading-6 text-cyan-50/80' : undefined}>
            {isChildContactMode && parentPartner?.name ? `تابعة لـ ${parentPartner.name}` : 'أدخل بيانات جهة الاتصال الأساسية.'}
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
              {isChildContactMode && parentPartner?.name ? (
                <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-bold text-blue-800 md:col-span-2">
                  جهة تابعة لـ {parentPartner.name}
                </div>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="partner-name">الاسم</Label>
                <Input id="partner-name" value={form.name} onChange={handleChange('name')} placeholder="اسم الجهة" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="partner-phone">الهاتف</Label>
                <Input id="partner-phone" value={form.phone} onChange={handleChange('phone')} placeholder="01000000000" />
              </div>

              {isChildContactMode ? (
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="partner-function-title">الوظيفة/الدور</Label>
                  <Input
                    id="partner-function-title"
                    value={form.functionTitle}
                    onChange={handleChange('functionTitle')}
                    placeholder="مسؤول أوراق، محاسب، مبيعات، مدير"
                  />
                </div>
              ) : hideCompanyFields ? null : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="partner-company-type">طبيعة الجهة</Label>
                    <Input
                      id="partner-company-type"
                      value={form.companyType}
                      onChange={handleChange('companyType')}
                      placeholder="شركة، معرض، تاجر، مورد"
                    />
                  </div>
                  <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={form.isCompany} onChange={handleChange('isCompany')} />
                    شركة / جهة اعتبارية
                  </label>
                </>
              )}

              {!isChildContactMode && (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="partner-national-id">الرقم القومي</Label>
                <NationalIdBoxes
                  value={form.nationalId}
                  onChange={(nationalId) => setForm((current) => ({ ...current, nationalId }))}
                />
              </div>
              )}

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="partner-address">العنوان</Label>
                <Input id="partner-address" value={form.address} onChange={handleChange('address')} placeholder="المدينة - الشارع" />
              </div>

              {!isChildContactMode && (
              <div className="space-y-2 md:col-span-2">
                <Label>صورة البطاقة</Label>
                <div className="grid gap-3 md:grid-cols-2">
                  <IdentityImagePicker
                    id="partner-identity-front"
                    title="الوجه"
                    file={form.identityCardFrontFile}
                    onChange={handleFileChange('identityCardFrontFile')}
                    onClear={() => clearFile('identityCardFrontFile')}
                  />
                  <IdentityImagePicker
                    id="partner-identity-back"
                    title="الضهر"
                    file={form.identityCardBackFile}
                    onChange={handleFileChange('identityCardBackFile')}
                    onClear={() => clearFile('identityCardBackFile')}
                  />
                </div>
              </div>
              )}
            </div>

            {!hideTypeFields && !isChildContactMode && (
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

            {!hideAccountingFields && !isChildContactMode && (
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

            {!hideNotesField ? (
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
            ) : null}

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
