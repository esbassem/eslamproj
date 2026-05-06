import { useEffect, useState } from 'react';
import { Button } from '@/core/ui/button';
import { cn } from '@/core/utils/cn';

const ruleFields = [
  {
    key: 'allow_partial_payments',
    label: 'السماح بالدفع الجزئي',
    description: 'يمكن تسجيل أكثر من دفعة على نفس الفاتورة حتى اكتمال المبلغ.',
  },
  {
    key: 'allow_overpayments',
    label: 'السماح بالدفع الزائد',
    description: 'يسمح بتحصيل مبلغ أكبر من المتبقي عند الحاجة لتسوية لاحقة.',
  },
  {
    key: 'require_cash_journal',
    label: 'يشترط اختيار جورنال مالي',
    description: 'كل دفعة يجب أن ترتبط بجورنال نقدي أو بنكي واضح.',
  },
  {
    key: 'allow_payment_on_posted_invoice',
    label: 'السماح بتسجيل الدفع على فاتورة مُرحّلة',
    description: 'يسمح بتسجيل الدفع على الفواتير التي تم ترحيلها محاسبيًا.',
  },
  {
    key: 'require_note_on_cancel',
    label: 'إلزام ملاحظات عند الإلغاء',
    description: 'أي إلغاء دفعة يحتاج سببًا مكتوبًا للمراجعة.',
  },
  {
    key: 'allow_payment_without_invoice',
    label: 'السماح بتسجيل دفعة بدون فاتورة',
    description: 'يمكن تسجيل دفعة محاسبية قبل ربطها بفاتورة محددة.',
  },
  {
    key: 'post_payments_immediately',
    label: 'ترحيل الدفعات مباشرة عند الحفظ',
    description: 'ترحيل الدفعة محاسبيًا فور حفظها بدل تركها كمسودة.',
  },
  {
    key: 'allow_edit_posted_payment',
    label: 'السماح بتعديل الدفعات المُرحّلة',
    description: 'إتاحة تعديل بيانات الدفعة بعد ترحيلها محاسبيًا.',
  },
];

export function PaymentRuleForm({ rules, isLoading, isSaving, error, onSave }) {
  const [draftRules, setDraftRules] = useState(rules || {});
  const [status, setStatus] = useState('');

  useEffect(() => {
    setDraftRules(rules || {});
    setStatus('');
  }, [rules]);

  const handleSave = async (event) => {
    event.preventDefault();
    const payload = ruleFields.reduce((nextRules, field) => {
      nextRules[field.key] = Boolean(draftRules[field.key]);
      return nextRules;
    }, {});
    const result = await onSave?.(payload);
    setStatus(result?.error ? result.error : 'تم حفظ القواعد العامة.');
  };

  return (
    <form className="space-y-5" onSubmit={handleSave}>
      <div>
        <h2 className="text-xl font-bold text-slate-950">القواعد العامة</h2>
        <p className="mt-1 text-sm text-muted-foreground">إعدادات مركزية تتحكم في سياسات الدفع المحاسبية داخل الفواتير وحساب العميل.</p>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-8 text-center text-sm font-medium text-slate-600">
          جار تحميل القواعد العامة...
        </div>
      ) : (
        <div className="space-y-3">
          {ruleFields.map((field) => (
            <SwitchRow
              key={field.key}
              checked={Boolean(draftRules[field.key])}
              label={field.label}
              description={field.description}
              disabled={isSaving}
              onChange={(checked) => setDraftRules((current) => ({ ...current, [field.key]: checked }))}
            />
          ))}
        </div>
      )}

      {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}

      {status ? <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600">{status}</div> : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={isLoading || isSaving || !rules}>
          {isSaving ? 'جار الحفظ...' : 'حفظ القواعد العامة'}
        </Button>
      </div>
    </form>
  );
}

function SwitchRow({ checked, label, description, disabled, onChange }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="font-semibold text-slate-950">{label}</div>
        <div className="mt-1 text-sm leading-6 text-muted-foreground">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition duration-200 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-60',
          checked ? 'bg-emerald-600' : 'bg-slate-300',
        )}
        onClick={() => onChange(!checked)}
      >
        <span
          className={cn(
            'absolute top-1 h-5 w-5 rounded-full bg-white shadow-sm transition duration-200',
            checked ? 'right-6' : 'right-1',
          )}
        />
      </button>
    </div>
  );
}
