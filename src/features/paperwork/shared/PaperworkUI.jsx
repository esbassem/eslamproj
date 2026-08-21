import { AlertCircle, FileText, Search } from 'lucide-react';

export function StatusBadge({ label, status }) {
  const tone = status === 'cancelled' ? 'bg-red-50 text-red-700 ring-red-200'
    : status === 'delivered' || status === 'done' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : status === 'sent_to_processor' ? 'bg-violet-50 text-violet-700 ring-violet-200'
        : 'bg-blue-50 text-blue-700 ring-blue-200';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-black ring-1 ${tone}`}>{label}</span>;
}

export function SearchInput({ value, onChange, placeholder = 'بحث' }) {
  return <label className="relative block min-w-0 flex-1"><span className="sr-only">{placeholder}</span><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-11 w-full rounded-xl border border-slate-200 bg-white pr-10 pl-3 text-sm font-bold outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-100" /></label>;
}

export function FilterBar({ filters, value, onChange }) {
  return <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="تصفية النتائج">{filters.map((filter) => <button key={filter.id} type="button" role="tab" aria-selected={value === filter.id} onClick={() => onChange(filter.id)} className={`h-9 flex-none rounded-lg px-3 text-xs font-black ${value === filter.id ? 'bg-slate-950 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>{filter.label}</button>)}</div>;
}

export function PageSkeleton({ rows = 6 }) {
  return <div className="space-y-3" aria-label="جاري تحميل البيانات">{Array.from({ length: rows }, (_, index) => <div key={index} className="h-20 animate-pulse rounded-2xl bg-slate-200/70" />)}</div>;
}

export function PageError({ message, onRetry }) {
  return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center"><AlertCircle className="mx-auto mb-2 h-6 w-6 text-red-600" /><p className="text-sm font-black text-red-800">{message}</p><button type="button" onClick={onRetry} className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-sm font-black text-white">إعادة المحاولة</button></div>;
}

export function EmptyState({ title, description, action }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center"><FileText className="mx-auto mb-3 h-8 w-8 text-slate-400" /><h2 className="font-black text-slate-900">{title}</h2>{description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}{action}</div>;
}

export function DetailSection({ title, children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-sm font-black text-slate-900">{title}</h2>{children}</section>;
}

export function SerialDisplay({ trackingNumber, identifiers = [] }) {
  const values = [trackingNumber, ...identifiers].filter(Boolean);
  return <span className="font-mono text-xs text-slate-600" dir="ltr">{values.slice(0, 2).join(' · ') || '—'}</span>;
}
