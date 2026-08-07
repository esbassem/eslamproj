import { X } from 'lucide-react';
import { PAPERWORK_EXCEPTIONAL_ACTIONS } from '@/features/moto-customer-care/config/paperworkExceptionalActions';

export function PaperworkExceptionalActionsMenu({ open, canExecute = false, isActionAvailable, onClose, onSelect }) {
  if (!open) return null;

  return (
    <div className="absolute inset-0 z-40 flex items-end bg-slate-950/30 sm:block sm:bg-slate-950/10" dir="rtl">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="إغلاق قائمة الإجراءات الاستثنائية" />
      <section
        className="relative max-h-[82dvh] w-full overflow-hidden rounded-t-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:absolute sm:left-4 sm:top-14 sm:w-[21rem] sm:rounded-2xl"
        role="menu"
        aria-label="الإجراءات الاستثنائية"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div>
            <h3 className="text-sm font-black text-slate-950 dark:text-white">إجراءات استثنائية</h3>
            <p className="mt-0.5 text-[10px] font-bold text-slate-400 dark:text-slate-500">تُنفذ الإجراءات المفعّلة فقط</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200 active:scale-95 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700" aria-label="إغلاق">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[calc(82dvh-4rem)] overflow-y-auto p-2 sm:max-h-[calc(100dvh-8rem)]">
          {PAPERWORK_EXCEPTIONAL_ACTIONS.map((action) => {
            const Icon = action.icon;
            const isDanger = action.tone === 'danger';
            const isDisabled = action.disabled || !canExecute || (isActionAvailable && !isActionAvailable(action));

            return (
              <div key={action.id} className={action.dividerAfter ? 'mb-2 border-b border-slate-100 pb-2 dark:border-slate-800' : ''}>
                <button
                  type="button"
                  role="menuitem"
                  disabled={isDisabled}
                  onClick={() => onSelect(action)}
                  className={`group flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-right transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-40 ${
                    isDanger
                      ? 'text-red-700 hover:bg-red-50 active:bg-red-100 focus-visible:ring-red-200 dark:text-red-400 dark:hover:bg-red-950/40 dark:active:bg-red-950/60'
                      : 'text-slate-700 hover:bg-blue-50 hover:text-blue-800 active:bg-blue-100 focus-visible:ring-blue-200 dark:text-slate-200 dark:hover:bg-slate-800 dark:hover:text-blue-300 dark:active:bg-slate-700'
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition ${
                    isDanger
                      ? 'bg-red-50 text-red-600 group-hover:bg-red-100 dark:bg-red-950/50 dark:text-red-400'
                      : 'bg-slate-100 text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-700 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:text-blue-300'
                  }`}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-xs font-black leading-5">{action.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
