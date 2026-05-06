import { cn } from '@/core/utils/cn';

const tabs = [
  { id: 'methods', label: 'طرق الدفع', description: 'إدارة طرق الدفع المحاسبية' },
  { id: 'rules', label: 'القواعد العامة', description: 'سياسات الدفع العامة' },
  { id: 'journals', label: 'الجورنالات المالية', description: 'جورنالات النقد والبنوك' },
  { id: 'journal-methods', label: 'ربط الطرق بالجورنالات', description: 'ربط طرق الدفع بالجورنالات' },
];

export function PaymentTabs({ activeTab, onTabChange }) {
  return (
    <div className="grid gap-2 rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-sm md:grid-cols-4">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            className={cn(
              'rounded-2xl px-4 py-3 text-right transition duration-200',
              isActive ? 'bg-slate-950 text-white shadow-lg shadow-slate-950/15' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950',
            )}
            onClick={() => onTabChange(tab.id)}
          >
            <span className="block text-sm font-semibold">{tab.label}</span>
            <span className={cn('mt-1 block text-xs', isActive ? 'text-white/70' : 'text-muted-foreground')}>{tab.description}</span>
          </button>
        );
      })}
    </div>
  );
}
