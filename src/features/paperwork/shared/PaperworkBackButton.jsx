import { ArrowRight } from 'lucide-react';

export function PaperworkBackButton({ onClick, label = 'الصفحة السابقة', disabled = false }) {
  const accessibleLabel = disabled ? 'لا توجد صفحة سابقة' : `الرجوع إلى ${label}`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={accessibleLabel}
      title={accessibleLabel}
      className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition-colors hover:bg-slate-200/70 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      <ArrowRight className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
