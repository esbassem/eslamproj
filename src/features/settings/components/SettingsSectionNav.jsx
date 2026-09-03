import { Landmark, WalletCards } from 'lucide-react';
import { cn } from '@/core/utils/cn';
import { resolveModuleIcon } from '@/features/modules/modules.navigation';
import { getSettingsSectionKey } from '@/features/settings/settingsNavigation';

const accountingTabs = [
  { key: 'methods', title: 'طرق الدفع', icon: WalletCards },
  { key: 'rules', title: 'القواعد العامة', icon: WalletCards },
  { key: 'journals', title: 'الجورنالات المالية', icon: Landmark },
  { key: 'journal-methods', title: 'ربط طرق الدفع بالجورنالات', icon: Landmark },
];

export function SettingsSectionNav({
  items = [],
  activeMenuId = null,
  activeAccountingTab = 'methods',
  onMenuSelect,
  onAccountingTabChange,
}) {
  return (
    <nav className="space-y-2" dir="rtl">
      {items.map((menu) => {
        const sectionKey = getSettingsSectionKey(menu);
        const Icon = resolveModuleIcon(menu.icon);
        const activeChild = (menu.children ?? []).find((child) => child.id === activeMenuId);
        const isActive = menu.id === activeMenuId || Boolean(activeChild);
        const isDisabled = menu.active === false;

        return (
          <div key={menu.id || menu.code} className="space-y-2">
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
                    onMenuSelect?.(menu);
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
                <span className="min-w-0 flex-1">{menu.name}</span>
                {isDisabled ? (
                  <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[0.68rem] font-black text-white/70">
                    قريبًا
                  </span>
                ) : null}
              </button>

              {sectionKey === 'accounting' && isActive && !isDisabled ? (
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

              {(menu.children ?? []).length && isActive && !isDisabled ? (
                <div className="space-y-1 px-3 pb-3">
                  <div className="h-px bg-[#dbe8ff]" />
                  {menu.children.map((child) => {
                    const ChildIcon = resolveModuleIcon(child.icon);
                    const isChildActive = child.id === activeMenuId;
                    return (
                      <button
                        key={child.id || child.code}
                        type="button"
                        disabled={child.active === false}
                        aria-disabled={child.active === false}
                        className={cn(
                          'mt-1 flex min-h-10 w-full items-center gap-2 rounded-lg px-3 py-2.5 text-right text-xs font-bold transition',
                          child.active === false
                            ? 'cursor-not-allowed text-slate-400 opacity-55'
                            : isChildActive
                              ? 'bg-[#eaf2ff] text-[#0f62fe]'
                              : 'text-slate-500 hover:bg-slate-50 hover:text-slate-950',
                        )}
                        onClick={() => child.active !== false && onMenuSelect?.(child)}
                      >
                        <ChildIcon className="h-3.5 w-3.5" />
                        <span className="min-w-0 flex-1">{child.name}</span>
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
