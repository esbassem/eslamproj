import { useState } from 'react';
import { Landmark, MoreHorizontal, Plus, Power } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { CashJournalSheet } from '@/features/finance/payments/components/CashJournalSheet';

const journalTypeLabels = {
  cash: 'نقدي',
  bank: 'بنكي',
};

const journalToneClasses = {
  cash: {
    icon: 'bg-emerald-50 text-emerald-700',
    border: 'border-emerald-100',
  },
  bank: {
    icon: 'bg-sky-50 text-sky-700',
    border: 'border-sky-100',
  },
};

export function JournalsTab({ journals, methods, isLoading, isSaving, error, onSave, onToggle }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedJournal, setSelectedJournal] = useState(null);
  const [status, setStatus] = useState('');

  const openCreateSheet = () => {
    setSelectedJournal(null);
    setStatus('');
    setSheetOpen(true);
  };

  const openEditSheet = (journal) => {
    setSelectedJournal(journal);
    setStatus('');
    setSheetOpen(true);
  };

  const handleSave = async (payload) => {
    const result = await onSave?.(payload);

    if (!result?.error) {
      setStatus(payload.id ? 'تم حفظ تعديل الجورنال المالي.' : 'تمت إضافة الجورنال المالي.');
    }

    return result;
  };

  const handleToggle = async (journal, isActive) => {
    const result = await onToggle?.(journal.id, isActive);

    if (result?.error) {
      setStatus(result.error);
      return;
    }

    setStatus(isActive ? 'تم تفعيل الجورنال المالي.' : 'تم تعطيل الجورنال المالي دون حذفه.');
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-950">الجورنالات المالية</h2>
          <p className="mt-1 text-sm text-muted-foreground">إدارة جورنالات النقد والبنوك المستخدمة في عمليات الدفع المحاسبية.</p>
        </div>
        <Button type="button" variant="secondary" onClick={openCreateSheet}>
          <Plus className="h-4 w-4" />
          إضافة جورنال مالي
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
          جار تحميل الجورنالات المالية...
        </div>
      ) : null}

      {!isLoading && !journals.length ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
          <h3 className="text-base font-semibold text-slate-950">لا توجد جورنالات مالية بعد</h3>
          <p className="mt-2 text-sm text-muted-foreground">أضف جورنال نقدي أو بنكي لاستخدامه في إعدادات الدفع.</p>
          <Button type="button" className="mt-5" onClick={openCreateSheet}>
            <Plus className="h-4 w-4" />
            إضافة جورنال مالي
          </Button>
        </div>
      ) : null}

      {!isLoading && journals.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {journals.map((journal) => {
            const tone = journalToneClasses[journal.type] ?? journalToneClasses.cash;

            return (
              <section key={journal.id} className={`rounded-2xl border bg-white p-5 shadow-sm ${tone.border}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className={`rounded-xl p-3 ${tone.icon}`}>
                      <Landmark className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-slate-950">{journal.name}</h3>
                        <Badge variant="accent">{journalTypeLabels[journal.type] || journal.type}</Badge>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-600" dir="ltr">
                        {journal.code || 'بدون كود'}
                      </p>
                    </div>
                  </div>
                  <Badge variant={journal.isActive ? 'success' : 'warning'}>
                    {journal.isActive ? 'نشط' : 'غير نشط'}
                  </Badge>
                </div>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <InfoPill label="معرف الفرع" value={journal.branchId || 'بدون فرع'} />
                  <InfoPill label="الحساب الافتراضي" value={journal.defaultAccountId || 'غير محدد'} />
                  <InfoPill label="طريقة واردة افتراضية" value={journal.incomingPaymentMethodDefaultId || 'غير محدد'} />
                  <InfoPill label="طريقة صادرة افتراضية" value={journal.outgoingPaymentMethodDefaultId || 'غير محدد'} />
                  <InfoPill label="حساب المقبوضات المعلقة" value={journal.outstandingReceiptsAccountId || 'غير محدد'} />
                  <InfoPill label="حساب المدفوعات المعلقة" value={journal.outstandingPaymentsAccountId || 'غير محدد'} />
                  <InfoPill label="حساب التعليق" value={journal.suspenseAccountId || 'غير محدد'} />
                  <InfoPill label="حساب الأرباح" value={journal.profitAccountId || 'غير محدد'} />
                  <InfoPill label="حساب الخسائر" value={journal.lossAccountId || 'غير محدد'} />
                  <InfoPill label="جاهز للدفع" value={journal.isActive ? 'نعم' : 'يحتاج تفعيل'} />
                  <InfoPill label="النوع" value={journalTypeLabels[journal.type] || journal.type} />
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" size="sm" onClick={() => openEditSheet(journal)}>
                    <MoreHorizontal className="h-4 w-4" />
                    تعديل
                  </Button>
                  <Button
                    type="button"
                    variant="soft"
                    size="sm"
                    disabled={isSaving}
                    onClick={() => handleToggle(journal, !journal.isActive)}
                  >
                    <Power className="h-4 w-4" />
                    {journal.isActive ? 'تعطيل' : 'تفعيل'}
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      <CashJournalSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        journal={selectedJournal}
        journals={journals}
        methods={methods}
        isSaving={isSaving}
        onSave={handleSave}
      />
    </div>
  );
}

function InfoPill({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className="text-sm font-semibold text-slate-950">{value}</span>
    </div>
  );
}
