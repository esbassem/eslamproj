import { Search, X } from 'lucide-react';
import { Input } from '@/core/ui/input';

const SECTION_SEARCH_COPY = {
  sales: {
    label: 'البحث في المبيعات',
    placeholder: 'ابحث بالعميل، الهاتف، رقم البيع، المنتج، الشاسيه أو الموتور',
  },
  requests: {
    label: 'البحث في طلبات الأوراق',
    placeholder: 'ابحث بالعميل، رقم الطلب، المنتج، الجهة، الشاسيه أو الموتور',
  },
};

export function FollowUpSearchBar({ section, value, onChange }) {
  const copy = SECTION_SEARCH_COPY[section] || SECTION_SEARCH_COPY.sales;

  return (
    <div className="w-36 flex-none sm:w-52 lg:w-64">
      <label className="relative block w-full">
        <span className="sr-only">{copy.label}</span>
        <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <Input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={copy.placeholder}
          className="h-8 rounded-lg border-slate-200 bg-slate-50 pl-8 pr-8 text-[11px] font-bold shadow-inner placeholder:text-slate-400 focus:bg-white"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute left-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-200 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            aria-label="مسح البحث"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </label>
    </div>
  );
}
