import { useMemo, useState } from 'react';
import { Landmark, MoreHorizontal, Plus, Power } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { JournalPaymentMethodSheet } from '@/features/finance/payments/components/JournalPaymentMethodSheet';

const journalTypeLabels = {
  cash: 'نقدي',
  bank: 'بنكي',
};

const paymentTypeLabels = {
  inbound: 'وارد',
  outbound: 'صادر',
};

export function JournalMethodsTab({ journals, methods, methodLines, isLoading, isSaving, error, onSave, onToggle }) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedLine, setSelectedLine] = useState(null);
  const [status, setStatus] = useState('');

  const linesByJournalId = useMemo(() => {
    const journalsById = new Map(journals.map((journal) => [journal.id, journal]));
    const methodsById = new Map(methods.map((method) => [method.id, method]));

    return methodLines.reduce((groups, line) => {
      const journal = journalsById.get(line.journalId);
      const method = methodsById.get(line.paymentMethodId);

      if (!journal || !method) {
        return groups;
      }

      const current = groups.get(journal.id) ?? [];
      current.push({ ...line, journal, method });
      current.sort((first, second) => (first.sequence ?? 10) - (second.sequence ?? 10));
      groups.set(journal.id, current);
      return groups;
    }, new Map());
  }, [journals, methodLines, methods]);

  const openCreateSheet = () => {
    setSelectedLine(null);
    setStatus('');
    setSheetOpen(true);
  };

  const openEditSheet = (line) => {
    setSelectedLine(line);
    setStatus('');
    setSheetOpen(true);
  };

  const handleSave = async (payload) => {
    const result = await onSave?.(payload);

    if (!result?.error) {
      setStatus(payload.id ? 'تم حفظ تعديل الربط.' : 'تمت إضافة الربط.');
    }

    return result;
  };

  const handleToggle = async (line, isActive) => {
    const result = await onToggle?.(line.id, isActive);

    if (result?.error) {
      setStatus(result.error);
      return;
    }

    setStatus(isActive ? 'تم تفعيل الربط.' : 'تم تعطيل الربط.');
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-950">ربط طرق الدفع بالجورنالات</h2>
          <p className="mt-1 text-sm text-muted-foreground">إدارة طرق الدفع المتاحة داخل كل جورنال مالي حسب اتجاه الحركة.</p>
        </div>
        <Button type="button" variant="secondary" onClick={openCreateSheet}>
          <Plus className="h-4 w-4" />
          ربط جديد
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
          جار تحميل ربط طرق الدفع بالجورنالات...
        </div>
      ) : null}

      {!isLoading && (!journals.length || !methods.length) ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center">
          <h3 className="text-base font-semibold text-slate-950">لا توجد بيانات كافية للربط</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            تأكد من وجود جورنال مالي نشط وطريقة دفع محاسبية نشطة قبل إضافة الربط.
          </p>
        </div>
      ) : null}

      {!isLoading && journals.length && methods.length ? (
        <div className="space-y-4">
          {journals.map((journal) => {
            const lines = linesByJournalId.get(journal.id) ?? [];

            return (
              <section key={journal.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-teal-50 p-3 text-teal-700">
                      <Landmark className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-slate-950">{journal.name}</h3>
                        <Badge variant="accent">{journalTypeLabels[journal.type] || journal.type}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground" dir="ltr">
                        {journal.code || 'بدون كود'}
                      </p>
                    </div>
                  </div>
                  <Badge variant={lines.length ? 'success' : 'warning'}>
                    {lines.length ? `${lines.length} ربط` : 'لا يوجد ربط'}
                  </Badge>
                </div>

                <div className="mt-5 overflow-hidden rounded-xl border border-slate-200">
                  {lines.length ? (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px] text-right text-sm">
                        <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                          <tr>
                            <th className="px-4 py-3">الاسم الظاهر</th>
                            <th className="px-4 py-3">طريقة الدفع</th>
                            <th className="px-4 py-3">النوع</th>
                            <th className="px-4 py-3">الترتيب</th>
                            <th className="px-4 py-3">المرجع</th>
                            <th className="px-4 py-3">المرفق</th>
                            <th className="px-4 py-3">الحالة</th>
                            <th className="px-4 py-3">إجراءات</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {lines.map((line) => (
                            <tr key={line.id}>
                              <td className="px-4 py-3 font-semibold text-slate-950">{line.name}</td>
                              <td className="px-4 py-3 text-slate-600">{line.method?.name}</td>
                              <td className="px-4 py-3 text-slate-600">{paymentTypeLabels[line.paymentType] || line.paymentType}</td>
                              <td className="px-4 py-3 text-slate-600">{line.sequence ?? 10}</td>
                              <td className="px-4 py-3 text-slate-600">{line.requireReference ? 'مطلوب' : 'غير مطلوب'}</td>
                              <td className="px-4 py-3 text-slate-600">{line.requireAttachment ? 'مطلوب' : 'غير مطلوب'}</td>
                              <td className="px-4 py-3">
                                <Badge variant={line.isActive ? 'success' : 'warning'}>
                                  {line.isActive ? 'مفعل' : 'معطل'}
                                </Badge>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex flex-wrap gap-2">
                                  <Button type="button" variant="secondary" size="sm" onClick={() => openEditSheet(line)}>
                                    <MoreHorizontal className="h-4 w-4" />
                                    تعديل
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="soft"
                                    size="sm"
                                    disabled={isSaving}
                                    onClick={() => handleToggle(line, !line.isActive)}
                                  >
                                    <Power className="h-4 w-4" />
                                    {line.isActive ? 'تعطيل' : 'تفعيل'}
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm font-medium text-slate-500">
                      لا توجد طرق دفع مربوطة بهذا الجورنال.
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      <JournalPaymentMethodSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        line={selectedLine}
        journals={journals}
        methods={methods}
        methodLines={methodLines}
        isSaving={isSaving}
        onSave={handleSave}
      />
    </div>
  );
}
