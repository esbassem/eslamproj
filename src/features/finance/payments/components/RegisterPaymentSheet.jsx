import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, Search } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import {
  Sheet, SheetBody, SheetContent, SheetDescription, SheetDismissButton,
  SheetFooter, SheetHeader, SheetTitle,
} from '@/core/ui/sheet';
import { listAvailablePaymentMethods, getPaymentMethodDestinationSelection } from '../../payment-methods/paymentMethods.service';
import { registerInboundCustomerPayment, searchPaymentCustomers } from '../paymentOperations.service';

const money = (value, currency = 'EGP') => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency}`;
const stateLabels = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', confirmed: 'معتمدة', rejected: 'مرفوضة', reversed: 'معكوسة' };

export function RegisterPaymentSheet({ open, onOpenChange, tenantId, context = null, canConfirm = false, canAllocate = false, onCompleted }) {
  const presetPartner = context?.partner ?? null;
  const maximumAmount = Number(context?.maximumAmount ?? context?.targetOpenItem?.residualAmount ?? 0);
  const [methods, setMethods] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [partner, setPartner] = useState(presetPartner);
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerResults, setCustomerResults] = useState([]);
  const [amount, setAmount] = useState('');
  const [methodId, setMethodId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const requestKey = useRef(null);
  const submitLock = useRef(false);
  const selectedMethod = useMemo(() => methods.find((method) => method.payment_method_id === methodId) ?? null, [methodId, methods]);

  useEffect(() => {
    if (!open) return;
    requestKey.current = crypto.randomUUID();
    setPartner(presetPartner);
    setCustomerSearch(''); setCustomerResults([]); setMethods([]); setDestinations([]);
    setAmount(context?.amount ? String(context.amount) : maximumAmount > 0 ? String(maximumAmount) : '');
    setMethodId(''); setDestinationId(''); setReference(context?.reference ?? ''); setNotes('');
    setError(''); setResult(null); setLoading(true);
    listAvailablePaymentMethods({ tenantId })
      .then((items) => { setMethods(items); if (items.length === 1) setMethodId(items[0].payment_method_id); })
      .catch((nextError) => setError(nextError.message))
      .finally(() => setLoading(false));
  }, [context?.amount, context?.reference, maximumAmount, open, presetPartner, tenantId]);

  useEffect(() => {
    if (!open || !methodId) { setDestinations([]); setDestinationId(''); return; }
    setLoading(true); setError('');
    getPaymentMethodDestinationSelection({ tenantId, paymentMethodId: methodId })
      .then((selection) => {
        setDestinations(selection.destinations);
        setDestinationId(selection.autoSelectedDestinationId || '');
      })
      .catch((nextError) => { setDestinations([]); setDestinationId(''); setError(nextError.message); })
      .finally(() => setLoading(false));
  }, [methodId, open, tenantId]);

  useEffect(() => {
    const term = customerSearch.trim();
    if (!open || presetPartner || term.length < 2) { setCustomerResults([]); setSearching(false); return undefined; }
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      searchPaymentCustomers({ tenantId, search: term })
        .then((items) => { if (active) setCustomerResults(items); })
        .catch((nextError) => { if (active) setError(nextError.message); })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [customerSearch, open, presetPartner, tenantId]);

  const submit = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    const numericAmount = Number(amount);
    if (!partner?.id) { setError('اختر العميل.'); return; }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setError('أدخل مبلغًا صحيحًا.'); return; }
    if (maximumAmount > 0 && numericAmount > maximumAmount) { setError('المبلغ أكبر من المتبقي على المستند.'); return; }
    if (!selectedMethod) { setError('اختر طريقة الدفع.'); return; }
    if (destinations.length && !destinationId) { setError('اختر مكان استلام الأموال.'); return; }
    if (selectedMethod.requires_reference && !reference.trim()) { setError('المرجع مطلوب لطريقة الدفع المختارة.'); return; }
    submitLock.current = true; setSubmitting(true); setError('');
    try {
      const nextResult = await registerInboundCustomerPayment({
        tenantId, partnerId: partner.id, amount: numericAmount,
        paymentMethodId: methodId, moneyDestinationId: destinationId || null,
        branchId: context?.branchId ?? null, referenceNumber: reference.trim() || null,
        notes: notes.trim() || null, source: context?.source ?? null,
        targetOpenItemId: context?.targetOpenItem?.id ?? null,
        allocationAmount: context?.targetOpenItem ? numericAmount : null,
        idempotencyKey: requestKey.current, includeAllocationSummary: canAllocate,
        confirmSubmitted: canConfirm,
      });
      setResult(nextResult);
      await onCompleted?.(nextResult);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      submitLock.current = false; setSubmitting(false);
    }
  };

  const payment = result?.readback?.payment;
  const summary = result?.allocationSummary;
  const selectedDestination = destinations.find((item) => item.destination_id === destinationId);

  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="left" dir="rtl" className="w-full max-w-none sm:max-w-xl"><SheetDismissButton aria-label="إغلاق تسجيل الدفعة"/><SheetHeader><SheetTitle>تسجيل دفعة عميل</SheetTitle><SheetDescription>{context?.targetOpenItem ? `تحصيل وتخصيص على ${context.targetOpenItem.label || 'المستند المحدد'}` : 'تحصيل مركزي يمكن تخصيصه لمستند العميل الآن أو لاحقًا.'}</SheetDescription></SheetHeader>
    {result ? <SheetBody className="space-y-4"><div className="rounded-2xl bg-emerald-50 p-5 text-emerald-950"><CheckCircle2 className="h-7 w-7"/><h3 className="mt-3 text-lg font-black">تم تسجيل الدفعة</h3><p className="mt-1 text-sm">رقم الدفعة: <b dir="ltr">{payment?.payment_number || result.created?.payment_number}</b></p></div><dl className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 p-4 text-sm"><Result label="العميل" value={partner.name}/><Result label="المبلغ" value={money(payment?.amount ?? amount, payment?.currency_code)}/><Result label="طريقة الدفع" value={selectedMethod?.payment_method_name}/><Result label="مكان الأموال" value={selectedDestination?.destination_name || 'بانتظار التسوية'}/><Result label="الحالة" value={stateLabels[payment?.status] || payment?.status}/><Result label="الترحيل" value={payment?.accounting_state === 'posted' ? 'مرحّلة' : 'لم تُرحّل بعد'}/>{summary ? <><Result label="المخصص" value={money(summary.allocated_amount, payment?.currency_code)}/><Result label="غير المخصص" value={money(summary.remaining_allocatable_amount, payment?.currency_code)}/></> : null}</dl>{payment?.status === 'submitted' ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">تم الإرسال والدفعة بانتظار الاعتماد والترحيل.</p> : null}</SheetBody> : <form className="contents" onSubmit={submit}><SheetBody className="space-y-5">
      {presetPartner ? <Field label="العميل"><div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3 font-bold">{presetPartner.name}</div></Field> : <Field label="العميل"><div className="relative mt-2"><Search className="absolute right-3 top-3 h-4 w-4 text-slate-400"/><Input className="pr-9" value={customerSearch} onChange={(event) => { setCustomerSearch(event.target.value); setPartner(null); }} placeholder="اكتب حرفين من الاسم أو الهاتف"/></div>{partner ? <button type="button" className="mt-2 w-full rounded-xl bg-blue-50 p-3 text-right font-bold text-blue-950" onClick={() => setPartner(null)}>{partner.name} · تغيير</button> : null}{!partner && (searching || customerResults.length) ? <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1">{searching ? <p className="p-3 text-sm text-slate-500">جاري البحث...</p> : customerResults.map((item) => <button key={item.id} type="button" className="block w-full rounded-lg p-3 text-right hover:bg-slate-50" onClick={() => { setPartner(item); setCustomerResults([]); setCustomerSearch(item.name); }}><b>{item.name}</b>{item.phone ? <span className="mt-1 block text-xs text-slate-500" dir="ltr">{item.phone}</span> : null}</button>)}</div> : null}</Field>}
      <div className="grid gap-4 sm:grid-cols-2"><Field label="المبلغ"><Input className="mt-2 text-left" dir="ltr" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}/>{maximumAmount > 0 ? <small className="mt-1 block text-slate-500">الحد الأقصى: {money(maximumAmount)}</small> : null}</Field><Field label="طريقة الدفع"><Select value={methodId} onChange={(event) => setMethodId(event.target.value)} disabled={loading}><option value="">اختر طريقة</option>{methods.map((method) => <option key={method.payment_method_id} value={method.payment_method_id}>{method.payment_method_name}</option>)}</Select></Field></div>
      {methodId && destinations.length ? <Field label="مكان استلام الأموال"><Select value={destinationId} onChange={(event) => setDestinationId(event.target.value)} disabled={loading}><option value="">اختر مكان الأموال</option>{destinations.map((item) => <option key={item.destination_id} value={item.destination_id}>{item.destination_name}</option>)}</Select></Field> : null}
      <div className="grid gap-4 sm:grid-cols-2"><Field label={`المرجع${selectedMethod?.requires_reference ? ' *' : ''}`}><Input className="mt-2" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="رقم إيصال أو مرجع"/></Field><Field label="البيان"><Input className="mt-2" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="ملاحظة اختيارية"/></Field></div>
      {!loading && !methods.length ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">لا توجد طريقة دفع نشطة وجاهزة للاستخدام.</p> : null}{error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p> : null}
    </SheetBody><SheetFooter><Button type="button" variant="secondary" onClick={() => onOpenChange?.(false)}>إلغاء</Button><Button type="submit" disabled={loading || submitting || !methods.length}>{submitting ? 'جاري التسجيل...' : 'تسجيل الدفعة'}</Button></SheetFooter></form>}
    {result ? <SheetFooter><Button onClick={() => onOpenChange?.(false)}>تم</Button></SheetFooter> : null}
  </SheetContent></Sheet>;
}

function Field({ label, children }) { return <Label className="block text-sm font-bold text-slate-800"><span>{label}</span>{children}</Label>; }
function Select(props) { return <select className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-4 focus:ring-slate-100" {...props}/>; }
function Result({ label, value }) { return <div><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-bold text-slate-950">{value || '—'}</dd></div>; }
