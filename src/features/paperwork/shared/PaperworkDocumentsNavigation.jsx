import { NavLink } from 'react-router-dom';
import { cn } from '@/core/utils/cn';
import { PaperworkManualReceipt } from '@/features/paperwork/manual-receipt/PaperworkManualReceipt';
import { PAPERWORK_ROUTES } from '@/features/paperwork/routes/paperworkRoutes';

const items = [
  { label: 'كل المستندات', to: PAPERWORK_ROUTES.documents },
  { label: 'الخزنة', to: PAPERWORK_ROUTES.vault },
];

export function PaperworkDocumentsNavigation() {
  return (
    <nav aria-label="تنقل المستندات" className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3" dir="rtl">
      <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100 p-1">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            className={({ isActive }) => cn(
              'rounded-lg px-3 py-2 text-sm font-black transition-colors',
              isActive ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900',
            )}
          >
            {item.label}
          </NavLink>
        ))}
      </div>
      <PaperworkManualReceipt showTrigger />
    </nav>
  );
}
