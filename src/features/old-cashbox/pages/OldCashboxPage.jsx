import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Archive, Check, ChevronLeft, ChevronRight, Minus, Plus, Save, Search, Trash2, X } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Sheet, SheetContent } from '@/core/ui/sheet';
import { cn } from '@/core/utils/cn';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { createOldCashboxTransactions, listOldCashboxTransactions, subscribeOldCashboxTransactions, updateOldCashboxTransactionsStatus } from '@/features/old-cashbox/api/oldCashbox.api';

function formatMoney(value) {
  return Number(value || 0).toLocaleString('ar-EG', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(date);
}

function getTransactionDirection(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (['income', 'in', 'credit', 'deposit', 'قبض', 'ايراد', 'إيراد', 'داخل'].includes(normalized)) {
    return 'in';
  }
  if (['expense', 'out', 'debit', 'withdrawal', 'صرف', 'مصروف', 'خارج'].includes(normalized)) {
    return 'out';
  }
  return 'neutral';
}

function TransactionRow({ transaction }) {
  const direction = getTransactionDirection(transaction.type);
  const isIncome = direction === 'in';
  const isExpense = direction === 'out';

  return (
    <div className="flex items-center gap-3 px-1 py-4">
      <div className={cn(
        'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
        isIncome && 'bg-green-100 text-green-600',
        isExpense && 'bg-red-100 text-red-600',
        !isIncome && !isExpense && 'bg-slate-100 text-slate-500',
      )}>
        {isIncome ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-right text-sm font-medium text-slate-800" dir="rtl">{transaction.note || 'عملية خزنة قديمة'}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span>{formatDate(transaction.date || transaction.created_at)}</span>
          {transaction.created_by ? <span>{transaction.created_by}</span> : null}
          {transaction.status && transaction.status !== 'approved' ? <span className="font-bold text-amber-500">({transaction.status})</span> : null}
          {transaction.ref_id ? <span dir="ltr">#{transaction.ref_id}</span> : null}
        </div>
      </div>
      <p className={cn(
        'shrink-0 text-left font-mono text-sm font-bold',
        isIncome && 'text-green-600',
        isExpense && 'text-red-500',
        !isIncome && !isExpense && 'text-slate-700',
      )}>
        {isIncome ? '+' : isExpense ? '-' : ''}
        {formatMoney(transaction.amount)}
      </p>
    </div>
  );
}

export function OldCashboxPage() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [currentMonth, setCurrentMonth] = useState(() => new Date());
  const [searchQuery, setSearchQuery] = useState('');
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isReviewSheetOpen, setIsReviewSheetOpen] = useState(false);
  const [selectedReview, setSelectedReview] = useState([]);
  const [step, setStep] = useState(1);
  const [dialogType, setDialogType] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [pendingOperations, setPendingOperations] = useState([]);

  const loadTransactions = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const data = await listOldCashboxTransactions();
      setTransactions(data);
    } catch (err) {
      setError(err.message || 'تعذر تحميل معاملات الخزنة القديمة.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTransactions();
    return subscribeOldCashboxTransactions(() => loadTransactions());
  }, [loadTransactions]);

  const filteredTransactions = useMemo(() => {
    const month = currentMonth.getMonth();
    const year = currentMonth.getFullYear();
    const query = searchQuery.trim().toLowerCase();

    return transactions.filter((transaction) => {
      const transactionDate = transaction.date;
      const parsedDate = transactionDate ? new Date(transactionDate) : null;
      const matchesMonth = parsedDate && !Number.isNaN(parsedDate.getTime())
        ? parsedDate.getMonth() === month && parsedDate.getFullYear() === year
        : false;
      const searchableText = [
        transaction.note,
        transaction.type,
        transaction.status,
        transaction.created_by,
        transaction.ref_id,
        transaction.amount,
      ].filter(Boolean).join(' ').toLowerCase();
      return matchesMonth && (!query || searchableText.includes(query));
    }).sort((left, right) => new Date(right.date) - new Date(left.date));
  }, [currentMonth, searchQuery, transactions]);

  const topReport = useMemo(() => {
    const approved = transactions.filter((transaction) => transaction.status === 'approved');
    const pending = transactions.filter((transaction) => transaction.status === 'pending');
    const income = approved.filter((transaction) => transaction.type === 'income').reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const expenses = approved.filter((transaction) => transaction.type === 'expense').reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const balance = income - expenses;
    const pendingExpenses = pending.filter((transaction) => transaction.type === 'expense').reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const pendingIncomes = pending.filter((transaction) => transaction.type === 'income').reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0);
    const pendingAmount = pendingIncomes + pendingExpenses;
    const projectedBalance = balance + pendingIncomes - pendingExpenses;

    return { balance, pendingAmount, projectedBalance };
  }, [transactions]);

  const pendingTransactions = useMemo(
    () => transactions.filter((transaction) => transaction.status === 'pending'),
    [transactions],
  );

  const currentUserName = user?.fullName || user?.user_metadata?.full_name || user?.email || 'System';

  const reviewOperations = useMemo(() => {
    const currentOperation = { id: 'current', amount: Number(amount) || 0, type: dialogType, note: description };
    return [currentOperation, ...pendingOperations];
  }, [amount, description, dialogType, pendingOperations]);

  const reviewTotals = useMemo(() => {
    const income = reviewOperations.filter((operation) => operation.type === 'income').reduce((sum, operation) => sum + Number(operation.amount || 0), 0);
    const expense = reviewOperations.filter((operation) => operation.type === 'expense').reduce((sum, operation) => sum + Number(operation.amount || 0), 0);
    const valid = reviewOperations.filter((operation) => Number(operation.amount) > 0 && operation.note?.trim() && operation.type);
    return { totalIncome: income, totalExpense: expense, net: income - expense, count: valid.length };
  }, [reviewOperations]);

  const openAddSheet = () => {
    setStep(1);
    setDialogType('');
    setAmount('');
    setDescription('');
    setPendingOperations([]);
    setFormError('');
    setIsSheetOpen(true);
  };

  const handleAmountChange = (event) => {
    const englishDigits = event.target.value.replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632));
    setAmount(englishDigits.replace(/[^0-9.]/g, ''));
    setFormError('');
  };

  const handleProceedToReview = () => {
    if (!amount || Number(amount) <= 0) {
      setFormError('المبلغ مطلوب.');
      return;
    }
    if (!description.trim()) {
      setFormError('البيان مطلوب.');
      return;
    }
    if (!dialogType) {
      setFormError('اختر نوع العملية.');
      return;
    }
    setFormError('');
    setStep(2);
  };

  const handleAddNewAndGoBack = () => {
    if (!amount || Number(amount) <= 0 || !description.trim() || !dialogType) {
      handleProceedToReview();
      return;
    }

    setPendingOperations((current) => [
      { id: Date.now(), amount: Number(amount), type: dialogType, note: description.trim(), created_by: currentUserName },
      ...current,
    ]);
    setAmount('');
    setDescription('');
    setDialogType('');
    setFormError('');
    setStep(1);
  };

  const handleRemoveOperation = (idToRemove) => {
    setPendingOperations((current) => current.filter((operation) => operation.id !== idToRemove));
  };

  const toggleReviewSelection = (id) => {
    setSelectedReview((current) => (
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]
    ));
    setReviewError('');
  };

  const toggleAllReviewSelection = () => {
    setSelectedReview((current) => (
      current.length === pendingTransactions.length ? [] : pendingTransactions.map((transaction) => transaction.id)
    ));
    setReviewError('');
  };

  const handleUpdateStatus = async (status) => {
    if (!selectedReview.length) {
      setReviewError('اختر عملية واحدة على الأقل.');
      return;
    }

    setIsUpdating(true);
    setReviewError('');
    try {
      await updateOldCashboxTransactionsStatus(selectedReview, status);
      setSelectedReview([]);
      await loadTransactions();
      if (selectedReview.length >= pendingTransactions.length) {
        setIsReviewSheetOpen(false);
      }
    } catch (err) {
      setReviewError(err.message || 'لم نتمكن من تحديث حالة العمليات.');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSaveAll = async () => {
    const validOperations = reviewOperations.filter((operation) => Number(operation.amount) > 0 && operation.note?.trim() && operation.type);
    if (!validOperations.length) {
      setFormError('لا توجد عمليات للحفظ.');
      return;
    }

    const saveDate = new Date().toISOString();
    const operationsToSave = validOperations
      .map((operation) => ({
        amount: Number(operation.amount),
        type: operation.type,
        note: operation.note.trim(),
        date: saveDate,
        created_by: operation.created_by || currentUserName,
        status: operation.type === 'income' ? 'approved' : 'pending',
        ref_id: null,
      }))
      .reverse();

    setIsSaving(true);
    setFormError('');
    try {
      await createOldCashboxTransactions(operationsToSave);
      setIsSheetOpen(false);
      setStep(1);
      setPendingOperations([]);
      setAmount('');
      setDescription('');
      setDialogType('');
      await loadTransactions();
    } catch (err) {
      setFormError(err.message || 'لم نتمكن من حفظ الحركات.');
    } finally {
      setIsSaving(false);
    }
  };

  const monthName = currentMonth.toLocaleString('ar-EG', { month: 'long', year: 'numeric' });
  const isCurrentMonth = useMemo(() => {
    const today = new Date();
    return currentMonth.getMonth() === today.getMonth() && currentMonth.getFullYear() === today.getFullYear();
  }, [currentMonth]);

  const changeMonth = (increment) => {
    setCurrentMonth((current) => {
      const next = new Date(current);
      next.setMonth(next.getMonth() + increment);
      return next;
    });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#121a2d]" dir="rtl">
      <div className="relative z-20 pb-8 pt-4 text-center text-white">
        <p className="text-sm text-slate-300">الرصيد المتاح</p>
        <p className="text-5xl font-extrabold tracking-tighter">{formatMoney(topReport.balance)}</p>
        {topReport.pendingAmount > 0 ? (
          <button type="button" onClick={() => setIsReviewSheetOpen(true)} className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-slate-200 transition hover:bg-white/10">
            <span>قيد المراجعة: <span className="font-semibold text-amber-300">{formatMoney(topReport.pendingAmount)}</span></span>
            <span className="opacity-50">•</span>
            <span>المتوقع: <span className="font-semibold text-white">{formatMoney(topReport.projectedBalance)}</span></span>
          </button>
        ) : null}
      </div>

      <div className="absolute inset-0 z-10 overflow-y-auto">
        <div className="h-[150px] flex-shrink-0" />
        <div className="min-h-[calc(100vh-210px)] w-full rounded-t-[2rem] bg-white shadow-lg">
          <div className="sticky top-0 z-20">
            <div
              className="absolute left-0 top-0 h-[2rem] w-[2rem]"
              style={{
                background: 'radial-gradient(circle at right bottom, transparent 2rem, rgb(18 26 45) 0px) right top',
                backgroundPosition: 'top left',
              }}
            />
            <div
              className="absolute right-0 top-0 h-[2rem] w-[2rem]"
              style={{
                background: 'radial-gradient(circle at left bottom, transparent 2rem, rgb(18 26 45) 0px) right top',
                backgroundPosition: 'top right',
              }}
            />
            <div className="border-b border-slate-200 bg-white">
              <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
                <div className="flex items-center justify-between py-4">
                  <div className="flex items-center gap-2">
                    <Button onClick={() => changeMonth(1)} variant="secondary" size="icon" className="h-8 w-8 rounded-full" disabled={isCurrentMonth}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                    <h2 className="w-28 text-center text-sm font-bold tabular-nums text-slate-800">{monthName}</h2>
                    <Button onClick={() => changeMonth(-1)} variant="secondary" size="icon" className="h-8 w-8 rounded-full">
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button onClick={openAddSheet} className="h-9 rounded-xl bg-blue-600 text-sm font-bold text-white hover:bg-blue-700">
                    <Plus className="ml-1 h-4 w-4" />
                    إضافة عملية
                  </Button>
                </div>
                <div className="pb-4">
                  <div className="relative">
                    <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="بحث في الحركات"
                      className="h-10 rounded-full border-slate-200 bg-slate-50 pr-9 text-sm font-medium shadow-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="mx-auto w-full max-w-3xl px-4 pt-1 sm:px-6">
            {isLoading ? (
              <div className="flex justify-center py-10 text-sm font-bold text-slate-500">جاري تحميل معاملات الخزنة...</div>
            ) : error ? (
              <div className="py-10 text-center text-sm font-bold text-red-600">{error}</div>
            ) : filteredTransactions.length > 0 ? (
              <div className="divide-y divide-slate-200/80">
                {filteredTransactions.map((transaction) => (
                  <TransactionRow key={transaction.id} transaction={transaction} />
                ))}
              </div>
            ) : (
              <div className="py-16 text-center">
                <Archive className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 font-medium text-slate-600">لا توجد حركات لهذا الشهر</p>
                <p className="mt-1 text-sm text-slate-400">جرّب تغيير الشهر أو أضف حركة جديدة</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="left" className="flex w-full flex-col overflow-hidden border-r bg-white p-0 sm:max-w-md" dir="rtl">
          {step === 1 ? (
            <>
              <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
                <div className="w-10" />
                <h2 className="text-xl font-bold text-slate-800">إضافة عملية</h2>
                <Button variant="ghost" size="icon" onClick={() => setIsSheetOpen(false)} className="rounded-full">
                  <X className="h-6 w-6 text-slate-600" />
                </Button>
              </header>
              <main className="flex-grow overflow-y-auto p-6">
                <Input
                  type="tel"
                  value={amount ? Number(amount).toLocaleString('en-US') : ''}
                  onChange={handleAmountChange}
                  placeholder="0"
                  className="mb-4 h-20 rounded-xl border-2 border-transparent bg-slate-100 text-center text-5xl font-bold text-slate-800 focus-visible:border-blue-500 focus-visible:ring-blue-500"
                />
                <textarea
                  value={description}
                  onChange={(event) => {
                    setDescription(event.target.value);
                    setFormError('');
                  }}
                  placeholder="اكتب هنا تفاصيل العملية..."
                  className="mb-4 min-h-[96px] w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-right text-base font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  rows={3}
                  dir="rtl"
                />
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setDialogType('expense');
                      setFormError('');
                    }}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-xl border-2 py-4 text-base font-semibold transition-colors',
                      dialogType === 'expense' ? 'border-red-500 bg-red-500 text-white' : 'border-slate-200 bg-white text-slate-700',
                    )}
                  >
                    <Minus className="h-5 w-5" />
                    مصروف
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDialogType('income');
                      setFormError('');
                    }}
                    className={cn(
                      'flex items-center justify-center gap-2 rounded-xl border-2 py-4 text-base font-semibold transition-colors',
                      dialogType === 'income' ? 'border-green-600 bg-green-600 text-white' : 'border-slate-200 bg-white text-slate-700',
                    )}
                  >
                    <Plus className="h-5 w-5" />
                    إيراد
                  </button>
                </div>
                {formError ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{formError}</p> : null}
              </main>
              <footer className="shrink-0 border-t border-slate-200 bg-white p-4">
                <div className={cn('grid gap-3', pendingOperations.length > 0 ? 'grid-cols-2' : 'grid-cols-1')}>
                  {pendingOperations.length > 0 ? (
                    <Button variant="secondary" onClick={() => setStep(2)} className="h-12 text-base font-semibold">
                      <span>الرجوع للمراجعة ({pendingOperations.length})</span>
                      <ArrowRight className="h-5 w-5" />
                    </Button>
                  ) : null}
                  <Button onClick={handleProceedToReview} className="h-12 bg-slate-800 text-base font-bold text-white hover:bg-slate-900">
                    <span>متابعة</span>
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                </div>
              </footer>
            </>
          ) : (
            <>
              <header className="flex shrink-0 items-center justify-end border-b border-slate-200 bg-slate-50 p-4">
                <Button variant="ghost" size="icon" onClick={() => setStep(1)} className="ml-4 rounded-full">
                  <ArrowRight className="h-6 w-6 text-slate-600" />
                </Button>
                <h2 className="flex-grow text-right text-xl font-bold text-slate-800">مراجعة وحفظ</h2>
              </header>
              <main className="flex min-h-0 flex-grow flex-col bg-slate-50">
                <div className="border-b border-slate-200 bg-slate-100 p-4">
                  <div className="grid grid-cols-3 items-end gap-3 text-center">
                    <div>
                      <p className="text-sm text-slate-500">الإيرادات</p>
                      <p className="text-lg font-semibold text-green-500 opacity-90">{formatMoney(reviewTotals.totalIncome)}</p>
                    </div>
                    <div className="pb-1">
                      <p className="text-base font-bold text-slate-800">الصافي</p>
                      <p className={cn('text-3xl font-extrabold tracking-tighter', reviewTotals.net >= 0 ? 'text-slate-900' : 'text-red-600')}>
                        {formatMoney(reviewTotals.net)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">المصروفات</p>
                      <p className="text-lg font-semibold text-red-500 opacity-90">{formatMoney(reviewTotals.totalExpense)}</p>
                    </div>
                  </div>
                </div>
                <div className="flex-grow space-y-2 overflow-y-auto p-4">
                  {reviewOperations.map((operation) => {
                    const valid = Number(operation.amount) > 0 && operation.note?.trim() && operation.type;
                    const isIncome = operation.type === 'income';
                    return (
                      <div key={operation.id} className={cn('flex items-center gap-3 rounded-lg border bg-white p-2.5 shadow-sm', operation.id === 'current' ? 'border-2 border-blue-500' : 'border-slate-200', !valid && 'opacity-50')}>
                        <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', isIncome ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600')}>
                          {isIncome ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                        </div>
                        <div className="min-w-0 flex-1 overflow-hidden">
                          <p className="truncate text-right text-sm font-medium text-slate-800">{operation.note || 'بدون بيان'}</p>
                          <p className={cn('text-right text-xs font-semibold', isIncome ? 'text-green-600' : 'text-red-500')}>{formatMoney(operation.amount)}</p>
                        </div>
                        {operation.id !== 'current' ? (
                          <Button variant="ghost" size="icon" onClick={() => handleRemoveOperation(operation.id)} className="h-8 w-8 rounded-full text-slate-400 hover:bg-red-100 hover:text-red-500">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                {formError ? <p className="mx-4 mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{formError}</p> : null}
              </main>
              <footer className="grid shrink-0 grid-cols-2 gap-3 border-t border-slate-200 bg-white p-4">
                <Button onClick={handleSaveAll} disabled={isSaving || reviewTotals.count === 0} className="h-12 bg-green-600 text-base font-bold text-white hover:bg-green-700">
                  <Save className="h-5 w-5" />
                  <span>{isSaving ? 'جار الحفظ...' : `حفظ (${reviewTotals.count})`}</span>
                </Button>
                <Button onClick={handleAddNewAndGoBack} disabled={isSaving} className="h-12 bg-blue-500 text-base font-semibold text-white hover:bg-blue-600">
                  <Plus className="h-5 w-5" />
                  إضافة عملية جديدة
                </Button>
              </footer>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={isReviewSheetOpen} onOpenChange={setIsReviewSheetOpen}>
        <SheetContent side="left" className="flex w-full flex-col overflow-hidden border-r bg-white p-0 sm:max-w-md" dir="rtl">
          <header className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 p-4">
            <div className="w-10" />
            <div className="text-center">
              <h2 className="text-xl font-bold text-slate-800">عمليات قيد المراجعة</h2>
              <p className="mt-1 text-xs font-semibold text-amber-600">{formatMoney(topReport.pendingAmount)}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setIsReviewSheetOpen(false)} className="rounded-full">
              <X className="h-6 w-6 text-slate-600" />
            </Button>
          </header>
          <main className="min-h-0 flex-grow overflow-y-auto bg-slate-50 p-4">
            {pendingTransactions.length > 0 ? (
              <>
                <button type="button" onClick={toggleAllReviewSelection} className="mb-3 flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
                  <span>{selectedReview.length === pendingTransactions.length ? 'إلغاء تحديد الكل' : 'تحديد الكل'}</span>
                  <span className="text-xs text-slate-400">{selectedReview.length} / {pendingTransactions.length}</span>
                </button>
                <div className="space-y-2">
                  {pendingTransactions.map((transaction) => {
                    const isSelected = selectedReview.includes(transaction.id);
                    const isIncome = getTransactionDirection(transaction.type) === 'in';
                    return (
                      <button
                        key={transaction.id}
                        type="button"
                        onClick={() => toggleReviewSelection(transaction.id)}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-right transition',
                          isSelected ? 'border-blue-500 shadow-sm' : 'border-slate-200',
                        )}
                      >
                        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', isSelected ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300')}>
                          {isSelected ? <Check className="h-4 w-4" /> : null}
                        </span>
                        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', isIncome ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600')}>
                          {isIncome ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-800">{transaction.note || 'عملية خزنة قديمة'}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">{formatDate(transaction.date || transaction.created_at)} - {transaction.created_by || 'System'}</span>
                        </span>
                        <span className={cn('font-mono text-sm font-bold', isIncome ? 'text-green-600' : 'text-red-500')}>
                          {isIncome ? '+' : '-'}{formatMoney(transaction.amount)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="py-16 text-center">
                <Archive className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 font-medium text-slate-600">لا توجد عمليات معلقة</p>
              </div>
            )}
          </main>
          {reviewError ? <p className="mx-4 mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-600">{reviewError}</p> : null}
          <footer className="grid shrink-0 grid-cols-2 gap-3 border-t border-slate-200 bg-white p-4">
            <Button onClick={() => handleUpdateStatus('approved')} disabled={isUpdating || !selectedReview.length} className="h-12 bg-green-600 text-base font-bold text-white hover:bg-green-700">
              موافقة
            </Button>
            <Button onClick={() => handleUpdateStatus('rejected')} disabled={isUpdating || !selectedReview.length} className="h-12 bg-red-500 text-base font-bold text-white hover:bg-red-600">
              رفض
            </Button>
          </footer>
        </SheetContent>
      </Sheet>
    </div>
  );
}
