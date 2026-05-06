import { Plus, Search } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';

const FILTER_LABELS = {
  all: 'جميع الجهات',
  customer: 'العملاء',
  supplier: 'الموردون',
};

export function ContactsHeader({
  title,
  subtitle,
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  filterType,
  onAdd,
}) {
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold text-slate-950">{title}</h1>
          <p className="text-sm text-slate-500">{subtitle}</p>
        </div>
        <Button onClick={onAdd} className="gap-2">
          <Plus className="h-4 w-4" />
          إضافة جهة اتصال
        </Button>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="ابحث بالاسم أو الهاتف"
            className="pr-10"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600">
            {FILTER_LABELS[filterType] ?? FILTER_LABELS.all}
          </span>
          <select
            value={statusFilter}
            onChange={(event) => onStatusFilterChange(event.target.value)}
            className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
          >
            <option value="all">كل الحالات</option>
            <option value="active">نشط</option>
            <option value="archived">مؤرشف</option>
          </select>
        </div>
      </div>
    </div>
  );
}
