import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import {
  Sheet, SheetBody, SheetContent, SheetDescription, SheetDismissButton,
  SheetFooter, SheetHeader, SheetTitle,
} from '@/core/ui/sheet';
import { getMoneyDestinationSelection, listMoneyDestinationBalances } from '../../money-destinations/moneyDestinations.service';
import { registerImmediateInternalTransfer } from '../internalTransfers.service';

const money = (value, currency = 'EGP') => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency || ''}`;

export function InternalTransferSheet({ open, onOpenChange, tenantId, onCompleted }) {
  const [sources, setSources] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [balances, setBalances] = useState(new Map());
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const submitLock = useRef(false);
  const requestKey = useRef(null);
  const source = useMemo(() => sources.find((item) => item.destination_id === sourceId), [sourceId, sources]);
  const destination = useMemo(() => destinations.find((item) => item.destination_id === destinationId), [destinationId, destinations]);

  useEffect(() => {
    if (!open) return;
    requestKey.current = crypto.randomUUID();
    setSources([]); setDestinations([]); setBalances(new Map()); setSourceId(''); setDestinationId('');
    setAmount(''); setReference(''); setNotes(''); setError(''); setResult(null); setLoading(true);
    Promise.all([
      getMoneyDestinationSelection({ tenantId, permissionCode: 'financial.transfer.create', accessType: 'transfer_from' }),
      getMoneyDestinationSelection({ tenantId, permissionCode: 'financial.transfer.create', accessType: 'transfer_to' }),
      listMoneyDestinationBalances({ tenantId, permissionCode: 'financial.transfer.create', accessType: 'transfer_from' }),
    ]).then(([sourceSelection, destinationSelection, balanceRows]) => {
      setSources(sourceSelection.destinations); setDestinations(destinationSelection.destinations);
      setSourceId(sourceSelection.autoSelectedDestinationId || '');
      setDestinationId(destinationSelection.autoSelectedDestinationId || '');
      setBalances(new Map(balanceRows.map((row) => [row.destinationId, row])));
    }).catch((nextError) => setError(nextError.message)).finally(() => setLoading(false));
  }, [open, tenantId]);

  const submit = async (event) => {
    event.preventDefault();
    if (submitLock.current) return;
    const numericAmount = Number(amount);
    if (!sourceId || !destinationId) { setError('اختر مكان الأموال المرسل والمستلم.'); return; }
    if (sourceId === destinationId) { setError('يجب أن يختلف مكان التحويل منه عن مكان التحويل إليه.'); return; }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) { setError('أدخل مبلغ تحويل صحيحًا.'); return; }
    submitLock.current = true; setSubmitting(true); setError('');
    try {
      const readback = await registerImmediateInternalTransfer({
        tenantId, sourceDestinationId: sourceId, destinationDestinationId: destinationId,
        amount: numericAmount, referenceNumber: reference.trim() || null,
        notes: notes.trim() || null, idempotencyKey: requestKey.current,
      });
      setResult(readback); await onCompleted?.(readback);
    } catch (nextError) { setError(nextError.message); }
    finally { submitLock.current = false; setSubmitting(false); }
  };

  const sourceBalance = balances.get(sourceId);
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="left" dir="rtl" className="w-full max-w-none sm:max-w-xl"><SheetDismissButton aria-label="إغلاق التحويل الداخلي"/><SheetHeader><SheetTitle>تحويل داخلي</SheetTitle><SheetDescription>نقل أموال الشركة بين مكانين ماليين. لا ينشئ دفعة عميل أو مصروفًا.</SheetDescription></SheetHeader>
    {result ? <SheetBody className="space-y-4"><div className="rounded-2xl bg-emerald-50 p-5 text-emerald-950"><CheckCircle2 className="h-7 w-7"/><h3 className="mt-3 text-lg font-black">تم تأكيد التحويل</h3><p className="mt-1 text-sm">رقم التحويل: <b dir="ltr">{result.transfer?.transfer_number}</b></p></div><dl className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 p-4 text-sm"><Result label="من" value={source?.destination_name}/><Result label="إلى" value={destination?.destination_name}/><Result label="المبلغ" value={money(result.transfer?.amount, result.transfer?.currency_code)}/><Result label="الحالة" value={result.transfer?.status === 'confirmed' ? 'مؤكد' : result.transfer?.status}/></dl></SheetBody> : <form className="contents" onSubmit={submit}><SheetBody className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr]"><Field label="من مكان الأموال"><Select value={sourceId} disabled={loading} onChange={(event) => setSourceId(event.target.value)}><option value="">اختر المصدر</option>{sources.map((item) => <option key={item.destination_id} value={item.destination_id}>{item.destination_name}</option>)}</Select>{sourceBalance ? <small className="mt-1 block text-slate-500">الرصيد: {money(sourceBalance.balance, sourceBalance.currencyCode)}</small> : null}</Field><ArrowLeftRight className="mt-9 hidden h-5 w-5 text-slate-400 sm:block"/><Field label="إلى مكان الأموال"><Select value={destinationId} disabled={loading} onChange={(event) => setDestinationId(event.target.value)}><option value="">اختر الوجهة</option>{destinations.filter((item) => item.destination_id !== sourceId).map((item) => <option key={item.destination_id} value={item.destination_id}>{item.destination_name}</option>)}</Select></Field></div>
      <Field label="المبلغ"><Input className="mt-2 text-left" dir="ltr" type="number" min="0.01" step="0.01" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)}/></Field>
      <div className="grid gap-4 sm:grid-cols-2"><Field label="المرجع"><Input className="mt-2" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="اختياري"/></Field><Field label="البيان"><Input className="mt-2" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="سبب التحويل"/></Field></div>
      {!loading && (!sources.length || !destinations.length) ? <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">لا توجد أماكن أموال متاحة كافية للتحويل.</p> : null}{error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p> : null}
    </SheetBody><SheetFooter><Button type="button" variant="secondary" onClick={() => onOpenChange?.(false)}>إلغاء</Button><Button type="submit" disabled={loading || submitting || !sourceId || !destinationId}>{submitting ? 'جاري التحويل...' : 'تأكيد التحويل'}</Button></SheetFooter></form>}
    {result ? <SheetFooter><Button onClick={() => onOpenChange?.(false)}>تم</Button></SheetFooter> : null}
  </SheetContent></Sheet>;
}

function Field({ label, children }) { return <label className="block text-sm font-bold text-slate-800"><span>{label}</span>{children}</label>; }
function Select(props) { return <select className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-4 focus:ring-slate-100" {...props}/>; }
function Result({ label, value }) { return <div><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-bold">{value || '—'}</dd></div>; }
