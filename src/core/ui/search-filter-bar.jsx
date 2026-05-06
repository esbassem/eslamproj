import { Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { useI18n } from '@/core/i18n/useI18n';
import { Input } from '@/core/ui/input';

export function SearchFilterBar({ searchPlaceholder }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-3 md:flex-row md:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="border-slate-200 bg-white pr-11 shadow-none focus:ring-2 focus:ring-blue-100" placeholder={searchPlaceholder || t('common.placeholders.searchRecords')} />
      </div>
      <Button variant="secondary" className="border-slate-200 bg-white shadow-none md:min-w-32">
        <SlidersHorizontal className="h-4 w-4" />
        {t('common.actions.filters')}
      </Button>
    </div>
  );
}

