import { Building2, Landmark, ShieldCheck, Store, Users2, WalletCards } from 'lucide-react';
import { cn } from '@/core/utils/cn';

const sections = [
  { key: 'general', title: 'عام', icon: Building2 },
  { key: 'accounting', title: 'المحاسبة', icon: Landmark },
  { key: 'pos', title: 'نقاط البيع', icon: Store },
  { key: 'team', title: 'المستخدمون والفريق', icon: Users2 },
  { key: 'permissions', title: 'الأدوار والصلاحيات', icon: ShieldCheck, ownerOnly: true },
];

const accountingTabs = [
  { key: 'methods', title: 'طرق الدفع', icon: WalletCards },
  { key: 'rules', title: 'القواعد العامة', icon: WalletCards },
  { key: 'journals', title: 'الجورنالات المالية', icon: Landmark },
  { key: 'journal-methods', title: 'ربط طرق الدفع بالجورنالات', icon: Landmark },
];

export function SettingsSectionNav({
  activeSection = 'general',
  activeAccountingTab = 'methods',
  canManagePermissions = false,
  onSectionChange,
  onAccountingTabChange,
}) {
  const visibleSections = sections.filter((section) => !section.ownerOnly || canManagePermissions);

  return (
    <nav className="space-y-2" dir="rtl">
      {visibleSections.map((section) => {
        const Icon = section.icon;
        const isActive = activeSection === section.key;
        const isDisabled = section.active === false;

        return (
          <div key={section.key} className="space-y-2">
            <div
              className={cn(
                'rounded-lg transition',
                isDisabled
                  ? 'cursor-not-allowed bg-white/8 text-white/55 opacity-55'
                  : isActive
                  ? 'bg-white text-[#0f172a] shadow-[0_24px_44px_-30px_rgba(0,0,0,0.58)]'
                  : 'bg-white/10 text-white/86 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:-translate-y-0.5 hover:bg-white/16',
              )}
            >
              <button
                type="button"
                className={cn(
                  'flex w-full items-center gap-3 px-4 py-3 text-right text-sm font-bold',
                  isDisabled && 'cursor-not-allowed',
                )}
                disabled={isDisabled}
                aria-disabled={isDisabled}
                onClick={() => {
                  if (!isDisabled) {
                    onSectionChange?.(section.key);
                  }
                }}
              >
                <span
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg',
                    isDisabled ? 'bg-white/8 text-white/55' : isActive ? 'bg-[#eaf2ff] text-[#0f62fe]' : 'bg-white/12 text-white',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">{section.title}</span>
                {isDisabled ? (
                  <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[0.68rem] font-black text-white/70">
                    قريبًا
                  </span>
                ) : null}
              </button>

              {section.key === 'accounting' && isActive && !isDisabled ? (
                <div className="space-y-1 px-3 pb-3">
                  <div className="h-px bg-[#dbe8ff]" />
                  {accountingTabs.map((tab) => {
                    const TabIcon = tab.icon;
                    const isTabActive = activeAccountingTab === tab.key;
                    const isTabDisabled = tab.active === false;

                    return (
                      <button
                        key={tab.key}
                        type="button"
                        disabled={isTabDisabled}
                        aria-disabled={isTabDisabled}
                        className={cn(
                          'mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-right text-xs font-bold transition',
                          isTabDisabled
                            ? 'cursor-not-allowed text-slate-400 opacity-55'
                            : isTabActive
                              ? 'bg-[#eaf2ff] text-[#0f62fe]'
                              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950',
                        )}
                        onClick={() => {
                          if (!isTabDisabled) {
                            onAccountingTabChange?.(tab.key);
                          }
                        }}
                      >
                        <TabIcon className="h-3.5 w-3.5" />
                        <span className="min-w-0 flex-1">{tab.title}</span>
                        {isTabDisabled ? (
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[0.65rem] font-black text-slate-500">
                            قريبًا
                          </span>
                        ) : null}
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
