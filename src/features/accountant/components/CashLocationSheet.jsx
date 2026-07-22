import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  History,
  Landmark,
  Loader2,
  Plus,
  WalletCards,
  X,
} from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
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

export function CashLocationSheet({ location, tenantId, onOpenChange, onOperationCreated }) {
  const [activeTab, setActiveTab] = useState('history');
  const [operations, setOperations] = useState([]);
  const [counterAccounts, setCounterAccounts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [direction, setDirection] = useState('in');
  const [counterAccountId, setCounterAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const loadSheetData = async () => {
    if (!tenantId || !location?.id) return;

    setIsLoading(true);
    setLoadError('');
    try {
      const [nextOperations, accounts] = await Promise.all([
        accountantService.listCashLocationOperations({ tenantId, accountId: location.id }),
        accountantService.listSettlementAccounts({ tenantId }),
      ]);
      setOperations(nextOperations);
      setCounterAccounts(accounts.filter((account) => account.id !== location.id));
    } catch (error) {
      setOperations([]);
      setCounterAccounts([]);
      setLoadError(error.message || 'تعذر تحميل بيانات الخزنة.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!location?.id) return;

    setActiveTab('history');
    setDirection('in');
    setCounterAccountId('');
    setAmount('');
    setNote('');
    setSubmitError('');
    loadSheetData();
  }, [location?.id, tenantId]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setSubmitError('');

    try {
      await accountantService.createCashLocationOperation({
        tenantId,
        cashAccountId: location.id,
        counterAccountId,
        direction,
        amount,
        note,
      });
      setAmount('');
      setNote('');
      setCounterAccountId('');
      await Promise.all([loadSheetData(), onOperationCreated?.(location.id)]);
      setActiveTab('history');
    } catch (error) {
      setSubmitError(error.message || 'تعذر تسجيل العملية.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Sheet open={Boolean(location)} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full max-w-full bg-white p-0 sm:max-w-[560px]" dir="rtl">
        <SheetHeader className="relative bg-slate-50 px-5 py-5 sm:px-7">
          <SheetClose className="absolute left-5 top-5 flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:text-slate-900">
            <X className="h-4 w-4" />
            <span className="sr-only">إغلاق</span>
          </SheetClose>
          <div className="flex items-center gap-3 pl-12">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              {location?.kind === 'main' ? <Landmark className="h-5 w-5" /> : <WalletCards className="h-5 w-5" />}
            </span>
            <div className="min-w-0">
              <SheetTitle className="truncate text-lg font-black">{location?.name || 'الخزنة'}</SheetTitle>
              <p className="mt-1 text-xs font-bold text-slate-500">
                الرصيد الحالي: <span className="text-slate-900">{formatCurrency(location?.balance || 0)}</span>
              </p>
            </div>
          </div>
        </SheetHeader>

        <div className="grid grid-cols-2 border-b border-slate-200 bg-white px-5 pt-3 sm:px-7">
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`flex items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-black transition ${
              activeTab === 'history' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <History className="h-4 w-4" />
            سجل الخزنة
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('new')}
            className={`flex items-center justify-center gap-2 border-b-2 px-3 py-3 text-sm font-black transition ${
              activeTab === 'new' ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            <Plus className="h-4 w-4" />
            إضافة عملية
          </button>
        </div>

        <SheetBody className="px-5 py-5 sm:px-7">
          {activeTab === 'new' ? (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <Label className="mb-2 block font-black">نوع العملية</Label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setDirection('in')}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-black transition ${
                      direction === 'in' ? 'border-emerald-300 bg-emerald-50 text-emerald-700 ring-2 ring-emerald-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <ArrowDownToLine className="h-4 w-4" />
                    وارد
                  </button>
                  <button
                    type="button"
                    onClick={() => setDirection('out')}
                    className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-black transition ${
                      direction === 'out' ? 'border-red-300 bg-red-50 text-red-700 ring-2 ring-red-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    <ArrowUpFromLine className="h-4 w-4" />
                    صادر
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cash-operation-counter-account" className="font-black">الحساب المقابل</Label>
                <select
                  id="cash-operation-counter-account"
                  value={counterAccountId}
                  onChange={(event) => setCounterAccountId(event.target.value)}
                  disabled={isLoading || isSubmitting}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-right text-sm font-bold text-slate-900 outline-none transition focus:border-teal-300 focus:ring-4 focus:ring-teal-50 disabled:opacity-60"
                >
                  <option value="">اختر الحساب المقابل</option>
                  {counterAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cash-operation-amount" className="font-black">المبلغ</Label>
                <Input
                  id="cash-operation-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  disabled={isSubmitting}
                  placeholder="0.00"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="cash-operation-note" className="font-black">بيان العملية</Label>
                <textarea
                  id="cash-operation-note"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  disabled={isSubmitting}
                  rows={3}
                  placeholder="اكتب سبب أو وصف العملية"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-300 focus:ring-4 focus:ring-teal-50 disabled:opacity-60"
                />
              </div>

              {submitError ? (
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{submitError}</p>
              ) : null}

              <Button type="submit" disabled={isSubmitting || isLoading} className="w-full bg-teal-700 text-white hover:bg-teal-800">
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                {isSubmitting ? 'جاري تسجيل العملية...' : 'تسجيل العملية'}
              </Button>
            </form>
          ) : isLoading ? (
            <div className="flex min-h-48 items-center justify-center gap-2 text-sm font-black text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري تحميل سجل الخزنة...
            </div>
          ) : loadError ? (
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{loadError}</p>
          ) : operations.length ? (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="divide-y divide-slate-100">
                {operations.map((operation) => {
                  const isIncoming = operation.direction === 'in';
                  const OperationIcon = isIncoming ? ArrowDownToLine : ArrowUpFromLine;
                  return (
                    <div key={operation.id} className="flex items-center gap-3 px-4 py-3.5">
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        isIncoming ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'
                      }`}>
                        <OperationIcon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-slate-900">{operation.label}</p>
                        <p className="mt-1 truncate text-[11px] font-bold text-slate-400">{operation.dateLabel || 'بدون تاريخ'}</p>
                      </div>
                      <p className={`shrink-0 text-sm font-black ${isIncoming ? 'text-emerald-700' : 'text-red-600'}`}>
                        {isIncoming ? '+' : '-'} {formatCurrency(operation.amount)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
              <History className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-3 text-sm font-black text-slate-700">لا توجد عمليات على هذه الخزنة.</p>
              <button type="button" onClick={() => setActiveTab('new')} className="mt-3 text-sm font-black text-teal-700 hover:text-teal-800">
                إضافة أول عملية
              </button>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
