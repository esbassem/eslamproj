import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/core/ui/button';

export function SectionTabs({ value, onChange, items, label }) {
  return <div role="tablist" aria-label={label} className="flex min-w-max gap-1 rounded-xl bg-slate-100 p-1">{items.map(item=><button key={item.value} type="button" role="tab" aria-selected={value===item.value} onClick={()=>onChange(item.value)} className={`rounded-lg px-4 py-2 text-sm font-black transition ${value===item.value?'bg-white text-slate-950 shadow-sm':'text-slate-500 hover:text-slate-800'}`}>{item.label}</button>)}</div>;
}

export function DetailSkeleton() {
  return <div className="space-y-4" aria-label="جاري التحميل">{[1,2,3].map(item=><div key={item} className="h-24 animate-pulse rounded-2xl bg-slate-100"/>)}</div>;
}

export function LoadError({ message, onRetry }) {
  return <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center"><p className="text-sm font-bold text-red-800">{message}</p>{onRetry?<Button className="mt-3" size="sm" variant="secondary" onClick={onRetry}>إعادة المحاولة</Button>:null}</div>;
}

export function EmptyBlock({ title, description, action, actionLabel }) {
  return <div className="rounded-2xl bg-slate-50 px-5 py-8 text-center"><p className="font-black text-slate-800">{title}</p>{description?<p className="mx-auto mt-1 max-w-md text-sm leading-6 text-slate-500">{description}</p>:null}{action?<Button className="mt-4" size="sm" onClick={action}>{actionLabel}</Button>:null}</div>;
}

export function ConfirmationDialog({ open, onOpenChange, title, description, confirmLabel='تأكيد', pending, onConfirm }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[60] bg-slate-950/35 backdrop-blur-sm"/><Dialog.Content dir="rtl" className="fixed left-1/2 top-1/2 z-[70] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-white p-6 shadow-2xl outline-none"><Dialog.Close aria-label="إغلاق" className="absolute left-4 top-4 rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-4 w-4"/></Dialog.Close><Dialog.Title className="pl-10 text-lg font-black text-slate-950">{title}</Dialog.Title><Dialog.Description className="mt-2 text-sm leading-6 text-slate-600">{description}</Dialog.Description><div className="mt-6 flex justify-end gap-2"><Dialog.Close asChild><Button variant="secondary" disabled={pending}>إلغاء</Button></Dialog.Close><Button onClick={onConfirm} disabled={pending}>{pending?<Loader2 className="h-4 w-4 animate-spin"/>:null}{pending?'جاري التنفيذ...':confirmLabel}</Button></div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

export function StatusText({ active }) {
  return <span className={`inline-flex items-center gap-2 text-xs font-bold ${active?'text-emerald-700':'text-amber-700'}`}><span className={`h-2 w-2 rounded-full ${active?'bg-emerald-500':'bg-amber-500'}`}/>{active?'نشط':'غير نشط'}</span>;
}
