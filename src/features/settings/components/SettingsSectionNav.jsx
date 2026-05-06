import { Building2, Landmark, Store, WalletCards } from 'lucide-react';
import { cn } from '@/core/utils/cn';

const sections = [
  { key: 'general', title: 'عام', icon: Building2 },
  { key: 'accounting', title: 'المحاسبة', icon: Landmark },
  { key: 'pos', title: 'نقاط البيع', icon: Store },
];

const accountingTabs = [
  { key: 'methods', title: 'طرق الدفع', icon: WalletCards },
  { key: 'rules', title: 'القواعد العامة', icon: WalletCards },
  { key: 'journals', title: 'الجورنالات المالية', icon: Landmark },
  { key: 'journal-methods', title: 'ربط طرق الدفع بالجورنالات', icon: Landmark },
];

export function SettingsSectionNav({ activeSection = 'general', activeAccountingTab = 'methods', onSectionChange, onAccountingTabChange }) {
  return (
    <nav className="space-y-2" dir="rtl">
      {sections.map((section) => {
        const Icon = section.icon;
        const isActive = activeSection === section.key;

        return (
          <div key={section.key} className="space-y-2">
            <div
              className={cn(
                'rounded-lg transition',
                isActive
                  ? 'bg-white text-[#0f172a] shadow-[0_24px_44px_-30px_rgba(0,0,0,0.58)]'
                  : 'bg-white/10 text-white/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:-translate-y-0.5 hover:bg-white/16',
              )}
            >
              <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-right text-sm font-bold" onClick={() => onSectionChange?.(section.key)}>
                <span className={cn('flex h-9 w-9 items-center justify-center rounded-lg', isActive ? 'bg-[#eaf2ff] text-[#0f62fe]' : 'bg-white/12 text-white')}>
                  <Icon className="h-4 w-4" />
                </span>
                <span>{section.title}</span>
              </button>

              {section.key === 'accounting' && isActive ? (
                <div className="space-y-1 px-3 pb-3">
                  <div className="h-px bg-[#dbe8ff]" />
                  {accountingTabs.map((tab) => {
                    const TabIcon = tab.icon;
                    const isTabActive = activeAccountingTab === tab.key;

                    return (
                      <button
                        key={tab.key}
                        type="button"
                        className={cn(
                          'mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-right text-xs font-bold transition',
                          isTabActive ? 'bg-[#eaf2ff] text-[#0f62fe]' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950',
                        )}
                        onClick={() => onAccountingTabChange?.(tab.key)}
                      >
                        <TabIcon className="h-3.5 w-3.5" />
                        <span>{tab.title}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </nav>
  );
}
