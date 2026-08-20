import { Loader2 } from 'lucide-react';

export function AccessSection({ title, description, children }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4"><div className="mb-3"><h3 className="font-black text-slate-900">{title}</h3>{description?<p className="mt-1 text-xs font-medium leading-5 text-slate-500">{description}</p>:null}</div><div className="space-y-2">{children}</div></section>;
}

export function AccessCheck({ checked, disabled, pending, label, hint, onChange }) {
  return <label className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 ${disabled?'bg-slate-50 opacity-70':'cursor-pointer bg-white hover:bg-slate-50'}`}><input type="checkbox" className="h-4 w-4 accent-slate-900" checked={checked} disabled={disabled||pending} onChange={e=>onChange(e.target.checked)}/><span className="min-w-0 flex-1"><span className="block text-sm font-bold text-slate-800">{label}</span>{hint?<span className="block truncate text-xs text-slate-500">{hint}</span>:null}</span>{pending?<Loader2 className="h-4 w-4 animate-spin"/>:null}</label>;
}
