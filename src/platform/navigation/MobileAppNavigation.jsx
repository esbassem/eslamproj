import { AppNavigation } from './AppNavigation';

export function MobileAppNavigation({ open, onOpenChange, ...navigationProps }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="قائمة التطبيق">
      <button type="button" className="absolute inset-0 bg-slate-950/30" onClick={() => onOpenChange(false)} aria-label="إغلاق قائمة التطبيق" />
      <aside className="absolute inset-y-0 right-0 w-[min(90vw,24rem)] overflow-y-auto bg-white p-5 shadow-2xl">
        <button type="button" onClick={() => onOpenChange(false)} className="mb-4 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold">إغلاق</button>
        <AppNavigation {...navigationProps} onNavigate={() => onOpenChange(false)} />
      </aside>
    </div>
  );
}
