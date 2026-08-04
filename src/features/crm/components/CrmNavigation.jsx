import { NavLink } from 'react-router-dom';
import { CRM_NAV_ITEMS } from '@/features/crm/constants/navigation';
import { cn } from '@/core/utils/cn';

export function CrmNavigation() {
  return <nav aria-label="التنقل داخل تطبيق متابعة العملاء المحتملين" className="overflow-x-auto border-b border-slate-200 bg-white/95 px-4 sm:px-6"><div className="mx-auto flex min-w-max max-w-7xl gap-1 py-2">{CRM_NAV_ITEMS.map(({ label, href, icon: Icon, end }) => <NavLink key={href} to={href} end={end} className={({ isActive }) => cn('inline-flex min-h-11 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition-colors', isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950')}><Icon className="h-4 w-4" /><span>{label}</span></NavLink>)}</div></nav>;
}
