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
  type: 'cash',
  branchId: '',
  defaultAccountId: '',
  incomingPaymentMethodDefaultId: '',
  outgoingPaymentMethodDefaultId: '',
  outstandingReceiptsAccountId: '',
  outstandingPaymentsAccountId: '',
  suspenseAccountId: '',
  profitAccountId: '',
  lossAccountId: '',
  isActive: true,
};

const journalTypeOptions = [
  { value: 'cash', label: 'نقدي' },
  { value: 'bank', label: 'بنكي' },
];

export function CashJournalSheet({
  open,
  onOpenChange,
  journal,
  journals = [],
  methods = [],
  isSaving,
  onSave,
}) {
  const [draft, setDraft] = useState(defaultDraft);
  const [formError, setFormError] = useState('');
  const isEditing = Boolean(journal?.id);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(
      journal
        ? {
            name: journal.name ?? '',
            code: journal.code ?? '',
            type: journal.type ?? 'cash',
            branchId: journal.branchId ?? journal.branch_id ?? '',
            defaultAccountId: journal.defaultAccountId ?? journal.default_account_id ?? '',
            incomingPaymentMethodDefaultId:
              journal.incomingPaymentMethodDefaultId ?? journal.incoming_payment_method_default_id ?? '',
            outgoingPaymentMethodDefaultId:
              journal.outgoingPaymentMethodDefaultId ?? journal.outgoing_payment_method_default_id ?? '',
            outstandingReceiptsAccountId:
              journal.outstandingReceiptsAccountId ?? journal.outstanding_receipts_account_id ?? '',
            outstandingPaymentsAccountId:
              journal.outstandingPaymentsAccountId ?? journal.outstanding_payments_account_id ?? '',
            suspenseAccountId: journal.suspenseAccountId ?? journal.suspense_account_id ?? '',
            profitAccountId: journal.profitAccountId ?? journal.profit_account_id ?? '',
            lossAccountId: journal.lossAccountId ?? journal.loss_account_id ?? '',
            isActive: journal.isActive ?? journal.active ?? true,
          }
        : defaultDraft,
    );
    setFormError('');
  }, [journal, open]);

  const normalizedCode = useMemo(() => draft.code.trim().toLowerCase(), [draft.code]);
  const inboundMethods = useMemo(
    () => methods.filter((method) => method.paymentType === 'inbound' && method.isActive !== false),
    [methods],
  );
  const outboundMethods = useMemo(
    () => methods.filter((method) => method.paymentType === 'outbound' && method.isActive !== false),
    [methods],
  );

  const updateDraft = (key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFormError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!draft.name.trim()) {
      setFormError('اكتب اسم الجورنال المالي.');
      return;
    }

    if (!normalizedCode) {
      setFormError('اكتب كود الجورنال المالي.');
      return;
    }

    if (!['cash', 'bank'].includes(draft.type)) {
      setFormError('نوع الجورنال يجب أن يكون نقدي أو بنكي فقط.');
      return;
    }

    const duplicate = journals.some(
      (item) => item.id !== journal?.id && item.code?.trim().toLowerCase() === normalizedCode,
    );

    if (duplicate) {
      setFormError('هذا الكود مستخدم بالفعل داخل نفس الشركة.');
      return;
    }

    const result = await onSave?.({
      id: journal?.id,
      name: draft.name.trim(),
      code: normalizedCode,
      type: draft.type,
      branchId: draft.branchId || null,
      defaultAccountId: draft.defaultAccountId,
      incomingPaymentMethodDefaultId: draft.incomingPaymentMethodDefaultId || null,
      outgoingPaymentMethodDefaultId: draft.outgoingPaymentMethodDefaultId || null,
      outstandingReceiptsAccountId: draft.outstandingReceiptsAccountId || null,
      outstandingPaymentsAccountId: draft.outstandingPaymentsAccountId || null,
      suspenseAccountId: draft.suspenseAccountId || null,
      profitAccountId: draft.profitAccountId || null,
      lossAccountId: draft.lossAccountId || null,
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
      <SheetContent side="right" className="w-full max-w-xl" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pr-6 pl-16">
          <SheetTitle>{isEditing ? 'تعديل جورنال مالي' : 'إضافة جورنال مالي'}</SheetTitle>
          <SheetDescription>أدخل بيانات جورنال نقدي أو بنكي يمكن استخدامه لاحقًا في عمليات الدفع المحاسبية.</SheetDescription>
        </SheetHeader>

        <form className="flex h-full flex-col" onSubmit={handleSubmit}>
          <SheetBody className="space-y-5">
            <FieldSet title="بيانات الجورنال">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id="cash-journal-name" label="الاسم" value={draft.name} onChange={(value) => updateDraft('name', value)} placeholder="مثال: الجورنال الرئيسي" />
                <TextField id="cash-journal-code" label="الكود" value={draft.code} onChange={(value) => updateDraft('code', value)} placeholder="main_cash" ltr />
                <div className="space-y-2">
                  <Label htmlFor="cash-journal-type">النوع</Label>
                  <select
                    id="cash-journal-type"
                    className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm font-semibold text-slate-950 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                    value={draft.type}
                    onChange={(event) => updateDraft('type', event.target.value)}
                  >
                    {journalTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <TextField id="cash-journal-branch" label="معرف الفرع" value={draft.branchId} onChange={(value) => updateDraft('branchId', value)} placeholder="اختياري" ltr />
                <TextField id="cash-journal-account" label="معرف الحساب الافتراضي" value={draft.defaultAccountId} onChange={(value) => updateDraft('defaultAccountId', value)} placeholder="default_account_id" ltr />
              </div>
            </FieldSet>

            <FieldSet title="الإعدادات الافتراضية للمدفوعات">
              <div className="grid gap-4 sm:grid-cols-2">
                <MethodSelect
                  id="incoming-payment-method"
                  label="طريقة الدفع الواردة الافتراضية"
                  value={draft.incomingPaymentMethodDefaultId}
                  methods={inboundMethods}
                  onChange={(value) => updateDraft('incomingPaymentMethodDefaultId', value)}
                />
                <MethodSelect
                  id="outgoing-payment-method"
                  label="طريقة الدفع الصادرة الافتراضية"
                  value={draft.outgoingPaymentMethodDefaultId}
                  methods={outboundMethods}
                  onChange={(value) => updateDraft('outgoingPaymentMethodDefaultId', value)}
                />
              </div>
            </FieldSet>

            <FieldSet title="حسابات المعالجة">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField id="outstanding-receipts" label="حساب المقبوضات المعلقة" value={draft.outstandingReceiptsAccountId} onChange={(value) => updateDraft('outstandingReceiptsAccountId', value)} placeholder="outstanding_receipts_account_id" ltr />
                <TextField id="outstanding-payments" label="حساب المدفوعات المعلقة" value={draft.outstandingPaymentsAccountId} onChange={(value) => updateDraft('outstandingPaymentsAccountId', value)} placeholder="outstanding_payments_account_id" ltr />
                <TextField id="suspense-account" label="حساب التعليق" value={draft.suspenseAccountId} onChange={(value) => updateDraft('suspenseAccountId', value)} placeholder="suspense_account_id" ltr />
                <TextField id="profit-account" label="حساب الأرباح" value={draft.profitAccountId} onChange={(value) => updateDraft('profitAccountId', value)} placeholder="profit_account_id" ltr />
                <TextField id="loss-account" label="حساب الخسائر" value={draft.lossAccountId} onChange={(value) => updateDraft('lossAccountId', value)} placeholder="loss_account_id" ltr />
              </div>
            </FieldSet>

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
                  {draft.isActive ? 'الجورنال المالي متاح للاستخدام.' : 'الجورنال المالي متوقف مؤقتًا دون حذفه.'}
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
              {isSaving ? 'جار الحفظ...' : isEditing ? 'حفظ التعديل' : 'إضافة الجورنال المالي'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function FieldSet({ title, children }) {
  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
      <h3 className="text-sm font-bold text-slate-950">{title}</h3>
      {children}
    </section>
  );
}

function TextField({ id, label, value, onChange, placeholder, ltr = false }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        dir={ltr ? 'ltr' : 'rtl'}
        className={ltr ? 'text-left' : undefined}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function MethodSelect({ id, label, value, methods, onChange }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm font-semibold text-slate-950 outline-none transition focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">بدون طريقة افتراضية</option>
        {methods.map((method) => (
          <option key={method.id} value={method.id}>
            {method.name}
          </option>
        ))}
      </select>
    </div>
  );
}
