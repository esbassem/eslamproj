import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { PaymentMethodCard } from '@/features/finance/payments/components/PaymentMethodCard';
import { PaymentMethodSheet } from '@/features/finance/payments/components/PaymentMethodSheet';

export function PaymentMethodsTab({ methods, isLoading, isSaving, error, onSave, onToggle }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState(null);
  const [status, setStatus] = useState('');

  const openCreateSheet = () => {
    setSelectedMethod(null);
    setStatus('');
    setSheetOpen(true);
  };

  const openEditSheet = (method) => {
    setSelectedMethod(method);
    setStatus('');
    setSheetOpen(true);
  };

  const handleSave = async (payload) => {
    const result = await onSave?.(payload);

    if (!result?.error) {
      setStatus(payload.id ? 'تم حفظ تعديل طريقة الدفع المحاسبية.' : 'تمت إضافة طريقة الدفع المحاسبية.');
    }

    return result;
  };

  const handleToggle = async (method, isActive) => {
    const result = await onToggle?.(method.id, isActive);

    if (result?.error) {
      setStatus(result.error);
      return;
    }

    setStatus(isActive ? 'تم تفعيل طريقة الدفع المحاسبية.' : 'تم تعطيل طريقة الدفع المحاسبية.');
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-950">طرق الدفع</h2>
          <p className="mt-1 text-sm text-muted-foreground">إدارة طرق الدفع المحاسبية للحركات الواردة والصادرة.</p>
        </div>
        <Button type="button" variant="secondary" onClick={openCreateSheet}>
          <Plus className="h-4 w-4" />
          إضافة طريقة دفع
        </Button>
      </div>

      {status ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600">
          {status}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}

      {isLoading ? (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm font-medium text-slate-600">
          جار تحميل طرق الدفع المحاسبية...
        </div>
      ) : null}

      {!isLoading && !methods.length ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
          <h3 className="text-base font-semibold text-slate-950">لا توجد طرق دفع بعد</h3>
          <p className="mt-2 text-sm text-muted-foreground">أضف طريقة دفع محاسبية لاستخدامها في الربط مع الجورنالات المالية.</p>
          <Button type="button" className="mt-5" onClick={openCreateSheet}>
            <Plus className="h-4 w-4" />
            إضافة طريقة دفع
          </Button>
        </div>
      ) : null}

      {!isLoading && methods.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {methods.map((method) => (
            <PaymentMethodCard
              key={method.id}
              method={method}
              isSaving={isSaving}
              onEdit={openEditSheet}
              onToggle={handleToggle}
            />
          ))}
        </div>
      ) : null}

      <PaymentMethodSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        method={selectedMethod}
        methods={methods}
        isSaving={isSaving}
        onSave={handleSave}
      />
    </div>
  );
}
