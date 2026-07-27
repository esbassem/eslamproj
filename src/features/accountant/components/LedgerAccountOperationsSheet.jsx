import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronRight, History, Landmark, Loader2, Trash2, X } from 'lucide-react';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { accountantService } from '@/features/accountant/services/accountant.service';
import { ledgerDeletionService } from '@/features/accountant/services/ledgerDeletion.service';

function formatCurrency(value) {
  return `${Number(value ?? 0).toLocaleString('ar-EG')} ج.م`;
}

function formatAccountBalance(value) {
  const balance = Number(value || 0);
  if (balance < 0) return `${formatCurrency(Math.abs(balance))} دائن`;
  if (balance > 0) return `${formatCurrency(balance)} مدين`;
  return formatCurrency(0);
}

function getCounterpartDescription(line) {
  const account = [line?.accountCode, line?.accountName].filter(Boolean).join(' — ');
  const party = line?.partnerName ? `الطرف: ${line.partnerName}` : '';
  const amount = Number(line?.debit || 0) > 0
    ? `مدين ${formatCurrency(line.debit)}`
    : Number(line?.credit || 0) > 0
      ? `دائن ${formatCurrency(line.credit)}`
      : '';
  return [account, party, amount].filter(Boolean).join(' · ');
}

export function LedgerAccountOperationsSheet({ account, tenantId, onOpenChange }) {
  const [operations, setOperations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [deletePreviewOperation, setDeletePreviewOperation] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [reloadSignal, setReloadSignal] = useState(0);

  useEffect(() => {
    if (!account?.id || !tenantId) {
      setOperations([]);
      setError('');
      setDeletePreviewOperation(null);
      setDeleteError('');
      return undefined;
    }

    let mounted = true;
    setDeletePreviewOperation(null);
    setDeleteError('');
    setIsLoading(true);
    setError('');
    accountantService.listAccountOperations({ tenantId, accountId: account.id })
      .then((records) => {
        if (mounted) setOperations(records);
      })
      .catch((loadError) => {
        if (!mounted) return;
        setOperations([]);
        setError(loadError.message || 'تعذر تحميل عمليات الحساب.');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [account?.id, reloadSignal, tenantId]);

  const openDeleteDialog = (operation) => {
    setDeleteError('');
    setDeletePreviewOperation(operation);
  };

  const closeDeleteDialog = () => {
    if (isDeleting) return;
    setDeleteError('');
    setDeletePreviewOperation(null);
  };

  const handleDeleteOperation = async () => {
    if (!deletePreviewOperation?.moveId || isDeleting) return;

    setIsDeleting(true);
    setDeleteError('');
    try {
      await ledgerDeletionService.deleteAccountMove({
        tenantId,
        moveId: deletePreviewOperation.moveId,
      });
      setDeletePreviewOperation(null);
      setReloadSignal((current) => current + 1);
    } catch (deleteOperationError) {
      setDeleteError(deleteOperationError?.message || 'لم تكتمل عملية الحذف، ولم يتم تغيير أي بيانات.');
    } finally {
      setIsDeleting(false);
    }
  };

  const currentBalance = operations.reduce((total, operation) => (
    total + Number(operation.debit || 0) - Number(operation.credit || 0)
  ), 0);
  const totalDebit = operations.reduce((total, operation) => total + Number(operation.debit || 0), 0);
  const totalCredit = operations.reduce((total, operation) => total + Number(operation.credit || 0), 0);
  let runningBalance = currentBalance;
  const operationsWithBalance = operations.map((operation) => {
    const operationWithBalance = { ...operation, runningBalance };
    runningBalance -= Number(operation.debit || 0) - Number(operation.credit || 0);
    return operationWithBalance;
  });

  return (
    <Sheet open={Boolean(account)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-full border-l-0 bg-white p-0 sm:max-w-2xl" dir="rtl">
        <SheetHeader className="border-b border-slate-200 px-5 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <SheetClose className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200 focus:outline-none focus:ring-4 focus:ring-slate-200" aria-label="رجوع" title="رجوع">
              <ChevronRight className="h-5 w-5" />
            </SheetClose>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700">
              <Landmark className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="truncate text-lg font-black">{account?.name || 'عمليات الحساب'}</SheetTitle>
              <p className="mt-0.5 truncate text-xs font-bold text-slate-500">
                {account?.code || '--'} · {account?.account_type || 'حساب محاسبي'}
              </p>
            </div>
            <div className="shrink-0 text-left">
              <p className="text-[10px] font-bold text-slate-500">الرصيد الحالي</p>
              <p className={`mt-0.5 text-sm font-black ${currentBalance < 0 ? 'text-red-600' : 'text-slate-950'}`}>
                {isLoading ? '...' : formatAccountBalance(currentBalance)}
              </p>
            </div>
          </div>
        </SheetHeader>

        <SheetBody className="px-5 pb-6 pt-4">
          {!isLoading && !error ? (
            <div className="mb-4 grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-emerald-50 px-3 py-2.5 text-center">
                <p className="text-[9px] font-black text-emerald-600">إجمالي المدين</p>
                <p className="mt-1 truncate text-xs font-black text-emerald-800">{formatCurrency(totalDebit)}</p>
              </div>
              <div className="rounded-xl bg-red-50 px-3 py-2.5 text-center">
                <p className="text-[9px] font-black text-red-500">إجمالي الدائن</p>
                <p className="mt-1 truncate text-xs font-black text-red-700">{formatCurrency(totalCredit)}</p>
              </div>
              <div className="rounded-xl bg-slate-100 px-3 py-2.5 text-center">
                <p className="text-[9px] font-black text-slate-500">الرصيد</p>
                <p className="mt-1 truncate text-xs font-black text-slate-900">{formatAccountBalance(currentBalance)}</p>
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm font-black text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري تحميل عمليات الحساب...
            </div>
          ) : error ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>
          ) : operationsWithBalance.length ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem_2.25rem] gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[10px] font-black text-slate-500">
                <span>العملية</span><span className="text-left">مدين</span><span className="text-left">دائن</span><span className="text-left">الرصيد</span><span aria-hidden="true" />
              </div>
              <div className="divide-y divide-slate-100">
                {operationsWithBalance.map((operation) => (
                  <div key={operation.id} className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem_2.25rem] items-center gap-2 px-4 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-slate-900">{operation.label || 'عملية محاسبية'}</p>
                      <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{operation.dateLabel || 'بدون تاريخ'}{operation.reference ? ` · ${operation.reference}` : ''}</p>
                      {operation.partyName ? (
                        <p className="mt-1 truncate text-[10px] font-black text-blue-700" title={operation.partyName}>
                          العميل / الطرف: {operation.partyName}
                        </p>
                      ) : null}
                      {operation.counterpartLines?.slice(0, 2).map((counterpartLine) => {
                        const description = getCounterpartDescription(counterpartLine);
                        return (
                          <p key={counterpartLine.id} className="mt-0.5 truncate text-[10px] font-bold text-violet-600" title={description}>
                            القيد المقابل: {description}
                          </p>
                        );
                      })}
                      {operation.counterpartLines?.length > 2 ? (
                        <p className="mt-0.5 text-[9px] font-black text-slate-400">
                          + {operation.counterpartLines.length - 2} سطر مقابل إضافي
                        </p>
                      ) : null}
                    </div>
                    <p className="truncate text-left text-[11px] font-black text-emerald-700">{operation.debit ? formatCurrency(operation.debit) : '—'}</p>
                    <p className="truncate text-left text-[11px] font-black text-red-600">{operation.credit ? formatCurrency(operation.credit) : '—'}</p>
                    <p className="truncate text-left text-[11px] font-black text-slate-950">{formatAccountBalance(operation.runningBalance)}</p>
                    <button
                      type="button"
                      onClick={() => openDeleteDialog(operation)}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-300 transition hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100"
                      aria-label={`معاينة حذف ${operation.label || 'القيد'}`}
                      title="حذف"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
              <History className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-3 text-sm font-black text-slate-700">لا توجد عمليات مسجلة على هذا الحساب.</p>
            </div>
          )}
        </SheetBody>

        {deletePreviewOperation ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/35 p-5 backdrop-blur-[2px]">
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              onClick={closeDeleteDialog}
              aria-label="إغلاق نافذة الحذف"
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-operation-preview-title"
              className="relative z-10 max-h-[calc(100%-2rem)] w-full max-w-sm overflow-y-auto rounded-2xl border border-white/80 bg-white shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
                    <AlertTriangle className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 id="delete-operation-preview-title" className="text-sm font-black text-slate-950">حذف القيد</h3>
                    <p className="mt-0.5 truncate text-[11px] font-bold text-slate-500">
                      {deletePreviewOperation.label || 'عملية محاسبية'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDeleteDialog}
                  disabled={isDeleting}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="إغلاق"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-5 py-5">
                <p className="text-sm font-black leading-6 text-slate-800">سيُلغى أثر العملية كأنها لم تُنشأ</p>
                <div className="mt-3 overflow-hidden rounded-xl border border-red-100 bg-red-50/60">
                  <div className="border-b border-red-100 px-4 py-3">
                    <p className="text-[10px] font-black text-red-500">القيد المحدد</p>
                    <p className="mt-1 truncate text-xs font-black text-slate-900">
                      {deletePreviewOperation.reference || deletePreviewOperation.moveId || 'بدون مرجع'}
                    </p>
                  </div>
                  <div className="space-y-3 px-4 py-3.5">
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      <div>
                        <p className="text-xs font-black text-slate-800">رأس القيد المحاسبي</p>
                        <p className="mt-0.5 text-[10px] font-bold leading-4 text-slate-500">السجل الرئيسي من جدول القيود account_moves.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      <div>
                        <p className="text-xs font-black text-slate-800">جميع سطور القيد</p>
                        <p className="mt-0.5 text-[10px] font-bold leading-4 text-slate-500">سطر الحساب الحالي والسطر المقابل من account_move_lines.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-red-500" />
                      <div>
                        <p className="text-xs font-black text-slate-800">روابط التسوية مع مديونية الفاتورة</p>
                        <p className="mt-0.5 text-[10px] font-bold leading-4 text-slate-500">أي روابط مرتبطة بالسطر المدين أو الدائن من account_partial_reconcile.</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                      <div>
                        <p className="text-xs font-black text-slate-800">إعادة حساب مديونية الفاتورة</p>
                        <p className="mt-0.5 text-[10px] font-bold leading-4 text-slate-500">تختفي الدفعة من سجل التحصيل ويُعاد احتساب المدفوع والمتبقي من القيود الباقية.</p>
                      </div>
                    </div>
                  </div>
                </div>
                <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2.5 text-[10px] font-black leading-4 text-emerald-700">
                  لن تُحذف الفاتورة نفسها، ولن يُحذف حساب العميل أو الحساب المقابل.
                </p>
                {deletePreviewOperation.moveType && !['payment', 'journal'].includes(deletePreviewOperation.moveType) ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10px] font-black leading-4 text-amber-700">
                    هذا قيد بيع أصلي، ولا يمكن حذفه من نافذة عمليات الحساب. يجب التعامل معه من مسار إلغاء الفاتورة.
                  </p>
                ) : deletePreviewOperation.paymentId ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[10px] font-black leading-4 text-amber-700">
                    هذا القيد مرتبط بسجل دفع رسمي، ويجب حذفه من شاشة المدفوعات.
                  </p>
                ) : (
                  <p className="mt-3 text-[10px] font-bold leading-4 text-slate-400">
                    تُنفذ كل الخطوات داخل معاملة واحدة؛ إذا فشلت أي خطوة فلن يُحذف أو يتغير أي شيء.
                  </p>
                )}
                {deleteError ? (
                  <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[10px] font-black leading-4 text-red-700">
                    {deleteError}
                  </p>
                ) : null}
                <div className="mt-5 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeDeleteDialog}
                    disabled={isDeleting}
                    className="h-9 rounded-xl bg-slate-100 px-4 text-xs font-black text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteOperation}
                    disabled={
                      isDeleting
                      || !deletePreviewOperation.moveId
                      || Boolean(deletePreviewOperation.paymentId)
                      || (deletePreviewOperation.moveType && !['payment', 'journal'].includes(deletePreviewOperation.moveType))
                    }
                    className="flex h-9 items-center gap-2 rounded-xl bg-red-600 px-4 text-xs font-black text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {isDeleting ? 'جار الحذف...' : 'حذف نهائي'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
