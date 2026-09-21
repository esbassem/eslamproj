import { useCallback, useEffect, useRef, useState } from 'react';
import { Link2Off, RefreshCw } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import {
  Sheet, SheetBody, SheetContent, SheetDescription, SheetDismissButton,
  SheetFooter, SheetHeader, SheetTitle,
} from '@/core/ui/sheet';
import {
  allocatePaymentToOpenItem,
  loadPaymentAllocationWorkspace,
  unallocatePaymentAllocation,
} from '../allocationOperations.service';

const money = (value, currency = 'EGP') => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency || ''}`;

export function PaymentAllocationSheet({ open, onOpenChange, tenantId, payment, onChanged }) {
  const [state, setState] = useState({ status: 'idle', summary: null, openItems: [], error: '' });
  const [selectedId, setSelectedId] = useState('');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);

  const load = useCallback(async () => {
    if (!tenantId || !payment?.id) return;
    setState((current) => ({ ...current, status: 'loading', error: '' }));
    try {
      const workspace = await loadPaymentAllocationWorkspace({ tenantId, paymentId: payment.id });
      setState({ status: 'ready', ...workspace, error: '' });
      setSelectedId((current) => workspace.openItems.some((item) => item.id === current) ? current : '');
    } catch (error) {
      setState({ status: 'error', summary: null, openItems: [], error: error.message });
    }
  }, [payment?.id, tenantId]);

  useEffect(() => { if (open) { setSelectedId(''); setAmount(''); load(); } }, [load, open]);
  const selected = state.openItems.find((item) => item.id === selectedId) ?? null;

  const selectItem = (item) => {
    setSelectedId(item.id);
    setAmount(String(Math.min(item.residualAmount, Number(state.summary?.remaining_allocatable_amount ?? 0))));
  };

  const allocate = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    const numericAmount = Number(amount);
    const paymentResidual = Number(state.summary?.remaining_allocatable_amount ?? 0);
    if (!selected) { setState((current) => ({ ...current, error: 'اختر المستند المراد تخصيص الدفعة عليه.' })); return; }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setState((current) => ({ ...current, error: 'أدخل مبلغ تخصيص صحيحًا.' })); return; }
    if (numericAmount > selected.residualAmount || numericAmount > paymentResidual) { setState((current) => ({ ...current, error: 'مبلغ التخصيص أكبر من المتاح.' })); return; }
    submitLock.current = true; setSubmitting(true); setState((current) => ({ ...current, error: '' }));
    try {
      await allocatePaymentToOpenItem({ tenantId, paymentId: payment.id, openItemId: selected.id, amount: numericAmount, idempotencyKey: crypto.randomUUID() });
      await load(); setSelectedId(''); setAmount(''); await onChanged?.();
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally { submitLock.current = false; setSubmitting(false); }
  };

  const unallocate = async (allocation) => {
    if (submitting || !window.confirm('هل تريد فك هذا التخصيص؟ سيعود المبلغ غير مخصص.')) return;
    setSubmitting(true); setState((current) => ({ ...current, error: '' }));
    try {
      await unallocatePaymentAllocation({ tenantId, allocationId: allocation.id, reason: 'فك التخصيص من واجهة العمليات المالية' });
      await load(); await onChanged?.();
    } catch (error) {
      setState((current) => ({ ...current, error: error.message }));
    } finally { setSubmitting(false); }
  };

  const summary = state.summary;
  const history = Array.isArray(summary?.allocation_history) ? summary.allocation_history : [];
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="left" dir="rtl" className="w-full max-w-none sm:max-w-2xl"><SheetDismissButton aria-label="إغلاق تخصيص الدفعة"/><SheetHeader><SheetTitle>تخصيص الدفعة {payment?.payment_number}</SheetTitle><SheetDescription>اربط المبلغ غير المخصص بمستند مفتوح لنفس العميل.</SheetDescription></SheetHeader><SheetBody className="space-y-5">
    {state.status === 'loading' ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">جاري تحميل البنود المفتوحة...</p> : null}
    {summary ? <section className="grid grid-cols-3 gap-2"><Stat label="قيمة الدفعة" value={money(summary.payment_amount, payment?.currency_code)}/><Stat label="مخصص" value={money(summary.allocated_amount, payment?.currency_code)}/><Stat label="متاح" value={money(summary.remaining_allocatable_amount, payment?.currency_code)} strong/></section> : null}
    {summary && Number(summary.remaining_allocatable_amount) > 0 ? <form className="space-y-4" onSubmit={allocate}><fieldset><legend className="text-sm font-black">البنود المفتوحة</legend><div className="mt-2 max-h-56 space-y-2 overflow-y-auto">{state.openItems.length ? state.openItems.map((item) => <button key={item.id} type="button" onClick={() => selectItem(item)} className={`w-full rounded-xl border p-3 text-right ${selectedId === item.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}><span className="flex justify-between gap-3"><b>{item.documentNumber}</b><b>{money(item.residualAmount, item.currencyCode)}</b></span><span className="mt-1 block text-xs text-slate-500">{item.reference || item.documentType || 'مستند مالي'}{item.dueDate ? ` · استحقاق ${item.dueDate}` : ''}</span></button>) : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">لا توجد بنود مفتوحة قابلة للتخصيص.</p>}</div></fieldset>{selected ? <label className="block text-sm font-bold">مبلغ التخصيص<Input className="mt-2 text-left" dir="ltr" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)}/></label> : null}{selected ? <Button type="submit" disabled={submitting}>{submitting ? 'جاري التخصيص...' : 'تخصيص المبلغ'}</Button> : null}</form> : null}
    {summary && Number(summary.remaining_allocatable_amount) === 0 ? <p className="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-900">تم تخصيص كامل قيمة الدفعة.</p> : null}
    {history.length ? <section><h3 className="text-sm font-black">سجل التخصيص</h3><div className="mt-2 space-y-2">{history.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-sm"><div><b>{item.target_open_item?.move_name || item.target_open_item?.move_reference || 'مستند مالي'}</b><p className="mt-1 text-xs text-slate-500">{money(item.amount, payment?.currency_code)} · {item.status === 'active' ? 'نشط' : 'تم فكه'}</p></div>{item.status === 'active' ? <Button size="sm" variant="secondary" disabled={submitting} onClick={() => unallocate(item)}><Link2Off className="h-4 w-4"/>فك التخصيص</Button> : null}</div>)}</div></section> : null}
    {state.error ? <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800"><p>{state.error}</p><Button type="button" size="sm" variant="secondary" className="mt-3" onClick={load}><RefreshCw className="h-4 w-4"/>إعادة المحاولة</Button></div> : null}
  </SheetBody><SheetFooter><Button variant="secondary" onClick={() => onOpenChange?.(false)}>إغلاق</Button></SheetFooter></SheetContent></Sheet>;
}

function Stat({ label, value, strong }) { return <div className={`rounded-xl p-3 ${strong ? 'bg-emerald-50 text-emerald-950' : 'bg-slate-50'}`}><div className="text-xs text-slate-500">{label}</div><div className="mt-1 font-black">{value}</div></div>; }
