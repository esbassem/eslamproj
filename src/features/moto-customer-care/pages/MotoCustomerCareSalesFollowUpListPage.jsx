import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/core/ui/input';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { MotoCustomerCareSalesTable } from '@/features/moto-customer-care/components/MotoCustomerCareSalesTable';
import { MotoCustomerCareSummaryCards } from '@/features/moto-customer-care/components/MotoCustomerCareSummaryCards';
import { useMotoCustomerCareSales } from '@/features/moto-customer-care/hooks/useMotoCustomerCareSales';

export function MotoCustomerCareSalesFollowUpListPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const { sales, summary, isLoading, error } = useMotoCustomerCareSales({
    search,
    status,
    limit: 250,
  });
  const statusOptions = useMemo(() => [
    ['all', 'كل المبيعات'],
    ['pending', 'قيد الانتظار'],
    ['confirmed', 'مؤكدة'],
    ['completed', 'مكتملة'],
    ['cancelled', 'ملغاة'],
  ], []);

  return (
    <section className="min-h-screen space-y-5 bg-slate-50 px-4 py-16 sm:px-8" dir="rtl">
      <header className="mx-auto max-w-7xl">
        <p className="text-xs font-black text-blue-700">Moto Customer Care</p>
        <h1 className="mt-1 text-2xl font-black text-slate-950">متابعة المبيعات والعملاء</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">متابعة عمليات البيع وحالة التحصيل دون تحميل بيانات تطبيق أوراق الملكية.</p>
      </header>

      <div className="mx-auto max-w-7xl"><MotoCustomerCareSummaryCards summary={summary} /></div>

      <div className="mx-auto flex max-w-7xl flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {statusOptions.map(([value, label]) => (
            <button key={value} type="button" onClick={() => setStatus(value)} className={`h-9 rounded-xl px-3 text-xs font-black ${status === value ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{label}</button>
          ))}
        </div>
        <label className="relative block w-full sm:w-72">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="بحث بالعميل أو التاريخ..." className="pr-9" />
        </label>
      </div>

      <div className="mx-auto max-w-7xl">
        {isLoading ? <LoadingSpinner title="جاري تحميل المبيعات" description="يتم تجهيز بيانات المتابعة." /> : (
          <MotoCustomerCareSalesTable sales={sales} error={error} emptyTitle="لا توجد مبيعات" emptyDescription="لا توجد نتائج مطابقة للفلاتر الحالية." />
        )}
      </div>
    </section>
  );
}
