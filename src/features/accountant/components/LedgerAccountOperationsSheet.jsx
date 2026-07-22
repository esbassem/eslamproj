import { useEffect, useState } from 'react';
import { ChevronRight, History, Landmark, Loader2 } from 'lucide-react';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { accountantService } from '@/features/accountant/services/accountant.service';

function formatCurrency(value) {
  return `${Number(value ?? 0).toLocaleString('ar-EG')} ج.م`;
}

export function LedgerAccountOperationsSheet({ account, tenantId, onOpenChange }) {
  const [operations, setOperations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!account?.id || !tenantId) {
      setOperations([]);
      setError('');
      return undefined;
    }

    let mounted = true;
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
  }, [account?.id, tenantId]);

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
                {isLoading ? '...' : formatCurrency(currentBalance)}
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
                <p className="mt-1 truncate text-xs font-black text-slate-900">{formatCurrency(currentBalance)}</p>
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
              <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem] gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[10px] font-black text-slate-500">
                <span>العملية</span><span className="text-left">مدين</span><span className="text-left">دائن</span><span className="text-left">الرصيد</span>
              </div>
              <div className="divide-y divide-slate-100">
                {operationsWithBalance.map((operation) => (
                  <div key={operation.id} className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_6.5rem] items-center gap-2 px-4 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-black text-slate-900">{operation.label || 'عملية محاسبية'}</p>
                      <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{operation.dateLabel || 'بدون تاريخ'}{operation.reference ? ` · ${operation.reference}` : ''}</p>
                    </div>
                    <p className="truncate text-left text-[11px] font-black text-emerald-700">{operation.debit ? formatCurrency(operation.debit) : '—'}</p>
                    <p className="truncate text-left text-[11px] font-black text-red-600">{operation.credit ? formatCurrency(operation.credit) : '—'}</p>
                    <p className="truncate text-left text-[11px] font-black text-slate-950">{formatCurrency(operation.runningBalance)}</p>
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
      </SheetContent>
    </Sheet>
  );
}
