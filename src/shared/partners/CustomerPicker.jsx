import * as Dialog from '@radix-ui/react-dialog';
import { Check, ChevronsUpDown, Search, UserPlus, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { PartnerSummary } from '@/shared/partners/PartnerSummary';
import { useCustomerSearch } from '@/shared/partners/useCustomerSearch';

export function CustomerPicker({ value, onChange, searchCustomers, disabled = false, onCreateCustomer, title = 'اختيار العميل', placeholder = 'اختر العميل', pageSize = 20 }) {
  const [open, setOpen] = useState(false);
  const searchState = useCustomerSearch({ open, disabled, searchCustomers, pageSize });
  const displayed = value ? [value, ...searchState.items.filter((item) => item.id !== value.id)] : searchState.items;
  const setPickerOpen = (nextOpen) => { setOpen(nextOpen); if (!nextOpen) searchState.reset(); };
  return <Dialog.Root open={open} onOpenChange={setPickerOpen}>
    <Dialog.Trigger asChild><button type="button" disabled={disabled} className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-right text-sm transition hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 disabled:cursor-default disabled:bg-slate-50"><UserRound className="h-4 w-4 shrink-0 text-slate-400" /><span className={`min-w-0 flex-1 truncate ${value ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{value?.name || placeholder}</span>{value?.phone ? <small dir="ltr" className="hidden shrink-0 text-xs text-slate-500 sm:block">{value.phone}</small> : null}<ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-400" /></button></Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[120] bg-slate-950/35 backdrop-blur-[2px]" /><Dialog.Content dir="rtl" className="fixed inset-x-3 bottom-3 z-[121] flex max-h-[min(80dvh,36rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2 sm:w-[min(calc(100vw-2rem),30rem)] sm:-translate-x-1/2 sm:-translate-y-1/2">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3.5"><div><Dialog.Title className="font-black text-slate-950">{title}</Dialog.Title><Dialog.Description className="mt-0.5 text-xs text-slate-500">ابحث بالاسم أو رقم الهاتف ثم اختر العميل.</Dialog.Description></div><Dialog.Close className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100" aria-label="إغلاق"><X className="h-4 w-4" /></Dialog.Close></header>
      <div className="flex gap-2 border-b border-slate-100 p-3"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" /><Input autoFocus type="search" aria-label="البحث عن عميل" className="h-10 rounded-lg pr-9 text-sm" value={searchState.search} onChange={(event) => searchState.setSearch(event.target.value)} placeholder="ابحث بالاسم أو الهاتف..." /></div>{onCreateCustomer ? <Button type="button" variant="secondary" size="icon" aria-label="إضافة عميل جديد" onClick={() => { setPickerOpen(false); onCreateCustomer(); }}><UserPlus className="h-4 w-4" /></Button> : null}</div>
      <div role="listbox" aria-label="العملاء" className="min-h-36 flex-1 overflow-y-auto p-2">
        {searchState.status === 'loading' && !displayed.length ? <div role="status" className="space-y-2 p-1">{[0, 1, 2].map((item) => <div key={item} className="h-11 animate-pulse rounded-lg bg-slate-100" />)}</div> : null}
        {searchState.status === 'error' ? <div role="alert" className="p-3 text-sm text-red-700"><p className="font-bold">{searchState.error}</p><Button className="mt-2" size="sm" type="button" variant="secondary" onClick={searchState.retry}>إعادة المحاولة</Button></div> : null}
        {searchState.status === 'ready' && !displayed.length ? <p className="p-4 text-center text-sm text-slate-500">{searchState.search.trim() ? 'لا توجد نتائج بحث.' : 'لا يوجد عملاء متاحون.'}</p> : null}
        {displayed.map((customer) => { const selected = customer.id === value?.id; return <button key={customer.id} role="option" aria-selected={selected} type="button" className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-right text-sm transition ${selected ? 'bg-blue-50 text-blue-950' : 'hover:bg-slate-50'}`} onClick={() => { onChange(customer); setPickerOpen(false); }}>{selected ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-600 text-white"><Check className="h-4 w-4" /></span> : null}<PartnerSummary partner={customer} compact /></button>; })}
        {searchState.hasMore ? <Button type="button" variant="ghost" className="mt-2 w-full" disabled={searchState.status === 'loading'} onClick={searchState.loadMore}>{searchState.status === 'loading' ? 'جارٍ التحميل…' : 'عرض المزيد'}</Button> : null}
      </div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
