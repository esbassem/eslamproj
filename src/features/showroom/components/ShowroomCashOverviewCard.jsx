import { ChevronLeft, Loader2, WalletCards } from 'lucide-react';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetHeader, SheetTitle } from '@/core/ui/sheet';

function formatMoney(value) {
  return `${new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 2 }).format(Number(value) || 0)} ج.م`;
}

export function ShowroomCashOverviewCard({ overview, isLoading, error, open, onOpenChange }) {
  const accounts = overview?.accounts || [];

  return (
    <>
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        className="showroom-header-in mb-5 flex w-full items-center justify-between gap-4 rounded-[20px] border border-white/45 bg-white/95 px-5 py-4 text-right shadow-[0_22px_50px_-34px_rgba(15,23,42,0.62)] transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus:ring-4 focus:ring-white/25 sm:px-6"
        aria-label="عرض تفاصيل إجمالي النقدية المتاحة"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
            {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <WalletCards className="h-5 w-5" />}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-black text-slate-500">إجمالي النقدية المتاحة</span>
            <span className="mt-1 block truncate text-2xl font-black tracking-tight text-slate-950">
              {isLoading ? 'جاري الحساب...' : error ? 'تعذر تحميل الإجمالي' : formatMoney(overview?.total)}
            </span>
            <span className="mt-1 block text-[11px] font-bold text-slate-500">يشمل الخزنة الرئيسية وعهد الموظفين</span>
          </span>
        </span>
        <ChevronLeft className="h-5 w-5 shrink-0 text-slate-400" />
      </button>

      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full max-w-md border-l-0 bg-white p-0" dir="rtl">
          <SheetDismissButton />
          <SheetHeader className="pr-6 text-right">
            <SheetTitle className="font-black">تفاصيل النقدية المتاحة</SheetTitle>
            <p className="text-xs font-bold text-slate-500">الأرصدة محسوبة من القيود المحاسبية المرحلة فقط.</p>
          </SheetHeader>
          <SheetBody className="px-5 py-5">
            {isLoading ? (
              <div className="flex min-h-40 items-center justify-center gap-2 text-sm font-bold text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري حساب الأرصدة...
              </div>
            ) : error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p>
            ) : accounts.length ? (
              <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="divide-y divide-slate-100">
                  {accounts.map((account) => (
                    <div key={account.id} className="flex items-center justify-between gap-4 px-4 py-3.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-900">{account.name}</p>
                        <p className="mt-0.5 text-[11px] font-bold text-slate-400">{account.code}</p>
                      </div>
                      <p className="shrink-0 font-mono text-sm font-black text-slate-900">{formatMoney(account.balance)}</p>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-4 border-t-2 border-slate-900 bg-slate-50 px-4 py-4">
                  <p className="text-sm font-black text-slate-950">الإجمالي</p>
                  <p className="font-mono text-base font-black text-emerald-700">{formatMoney(overview?.total)}</p>
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-sm font-bold text-slate-500">لا توجد حسابات نقدية نشطة.</p>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
