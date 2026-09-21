import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, Link2, Plus, RefreshCw, WalletCards } from 'lucide-react';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { Button } from '@/core/ui/button';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { PaymentAllocationSheet } from '../../allocations/components/PaymentAllocationSheet';
import { getMoneyDestinationSelection, listMoneyDestinationBalances } from '../../money-destinations/moneyDestinations.service';
import { listFinancialPayments } from '../../payments/canonicalPayments.service';
import { RegisterPaymentSheet } from '../../payments/components/RegisterPaymentSheet';
import { InternalTransferSheet } from '../../transfers/components/InternalTransferSheet';
import { listInternalTransfers } from '../../transfers/internalTransfers.service';

const money = (value, currency = 'EGP') => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency || ''}`;
const paymentStates = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', confirmed: 'معتمدة', rejected: 'مرفوضة', reversed: 'معكوسة' };
const transferStates = { draft: 'مسودة', sent: 'مرسل', received: 'مستلم', confirmed: 'مؤكد' };

export function FinancialOperationsWorkspace() {
  const { tenant } = useWorkspace();
  const { can, canAny, isLoading: permissionsLoading } = useAuthorization();
  const tenantId = tenant?.id ?? null;
  const canConfirmPayment = can('financial.payment.confirm');
  const canCreatePayment = can('financial.payment.create') && can('financial.payment.submit') && can('financial.payment.post');
  const canViewPayments = canAny(['financial.payment.create', 'financial.payment.submit', 'financial.payment.confirm', 'financial.payment.reverse']);
  const canAllocate = can('financial.payment.allocate');
  const canTransfer = can('financial.transfer.create') && can('financial.transfer.confirm');
  const canViewTransfers = canAny(['financial.transfer.create', 'financial.transfer.send', 'financial.transfer.receive', 'financial.transfer.confirm']);
  const [tab, setTab] = useState('payments');
  const [payments, setPayments] = useState([]);
  const [transfers, setTransfers] = useState([]);
  const [destinationSummary, setDestinationSummary] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [allocationPayment, setAllocationPayment] = useState(null);

  const load = useCallback(async () => {
    if (!tenantId || permissionsLoading) return;
    setStatus('loading'); setError('');
    try {
      const [paymentRows, transferRows, destinationData] = await Promise.all([
        canViewPayments ? listFinancialPayments({ tenantId, limit: 30 }) : [],
        canViewTransfers ? listInternalTransfers({ tenantId, limit: 30 }) : [],
        canCreatePayment ? Promise.all([
          getMoneyDestinationSelection({ tenantId, permissionCode: 'financial.payment.create', accessType: 'initiate' }),
          listMoneyDestinationBalances({ tenantId, permissionCode: 'financial.payment.create', accessType: 'initiate' }),
        ]) : null,
      ]);
      setPayments(paymentRows ?? []); setTransfers(transferRows ?? []);
      if (destinationData) {
        const [selection, balances] = destinationData;
        const byId = new Map(balances.map((item) => [item.destinationId, item]));
        setDestinationSummary(selection.destinations.map((item) => ({ ...item, balance: byId.get(item.destination_id) ?? null })));
      } else setDestinationSummary([]);
      setStatus('ready');
    } catch (nextError) { setStatus('error'); setError(nextError.message); }
  }, [canCreatePayment, canViewPayments, canViewTransfers, permissionsLoading, tenantId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!canViewPayments && canViewTransfers) setTab('transfers'); }, [canViewPayments, canViewTransfers]);
  const visiblePayments = useMemo(() => payments.filter((payment) => payment.direction === 'inbound'), [payments]);
  const noAccess = !permissionsLoading && !canViewPayments && !canViewTransfers;

  return <div className="space-y-5" dir="rtl">
    <header className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2 text-sm font-bold text-blue-700"><WalletCards className="h-4 w-4"/>العمليات المالية</div><h1 className="mt-2 text-2xl font-black text-slate-950">الدفعات والتحويلات</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">سجّل تحصيلات العملاء، خصصها على المستندات المفتوحة، وانقل أموال الشركة بين أماكن الأموال.</p></div><div className="flex flex-wrap gap-2">{canCreatePayment ? <Button onClick={() => setPaymentOpen(true)}><Plus className="h-4 w-4"/>تسجيل دفعة</Button> : null}{canTransfer ? <Button variant="secondary" onClick={() => setTransferOpen(true)}><ArrowLeftRight className="h-4 w-4"/>تحويل داخلي</Button> : null}</div></div></header>

    {destinationSummary.length ? <section aria-label="أرصدة أماكن الأموال" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{destinationSummary.map((item) => <div key={item.destination_id} className="rounded-2xl border border-slate-200 bg-white p-4"><p className="truncate text-sm font-bold text-slate-600">{item.destination_name}</p><p className="mt-2 text-xl font-black text-slate-950">{item.balance ? money(item.balance.balance, item.balance.currencyCode) : '—'}</p><p className="mt-1 text-xs text-slate-400">رصيد تشغيلي محدّث</p></div>)}</section> : null}

    <nav className="flex gap-2 rounded-2xl bg-slate-100 p-1" aria-label="أقسام العمليات المالية">{canViewPayments ? <Tab active={tab === 'payments'} onClick={() => setTab('payments')}>الدفعات</Tab> : null}{canViewTransfers ? <Tab active={tab === 'transfers'} onClick={() => setTab('transfers')}>التحويلات الداخلية</Tab> : null}<Button size="icon" variant="ghost" className="mr-auto" onClick={load} aria-label="تحديث العمليات"><RefreshCw className="h-4 w-4"/></Button></nav>
    {status === 'loading' ? <div className="grid gap-3"><div className="h-24 animate-pulse rounded-2xl bg-slate-100"/><div className="h-24 animate-pulse rounded-2xl bg-slate-100"/></div> : null}
    {status === 'error' ? <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5"><p className="font-bold text-red-800">{error}</p><Button className="mt-3" variant="secondary" onClick={load}>إعادة المحاولة</Button></div> : null}
    {noAccess ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900">ليس لديك صلاحية لعرض العمليات المالية.</div> : null}
    {status === 'ready' && tab === 'payments' && canViewPayments ? <OperationList empty="لا توجد دفعات عملاء بعد.">{visiblePayments.map((payment) => <article key={payment.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><b dir="ltr">{payment.payment_number}</b><Status>{paymentStates[payment.status] || payment.status}</Status>{payment.accounting_state === 'posted' ? <Status success>مرحّلة</Status> : null}</div><p className="mt-2 text-lg font-black">{money(payment.amount, payment.currency_code)}</p><p className="mt-1 text-xs text-slate-500">{new Date(payment.created_at).toLocaleString('ar-EG')}</p></div>{canAllocate && payment.accounting_state === 'posted' ? <Button variant="secondary" onClick={() => setAllocationPayment(payment)}><Link2 className="h-4 w-4"/>التخصيصات</Button> : null}</article>)}</OperationList> : null}
    {status === 'ready' && tab === 'transfers' && canViewTransfers ? <OperationList empty="لا توجد تحويلات داخلية بعد.">{transfers.map((transfer) => <article key={transfer.id} className="rounded-2xl border border-slate-200 bg-white p-4"><div className="flex items-center justify-between gap-3"><div><b dir="ltr">{transfer.transfer_number}</b><p className="mt-2 text-lg font-black">{money(transfer.amount, transfer.currency_code)}</p></div><Status success={transfer.status === 'confirmed'}>{transferStates[transfer.status] || transfer.status}</Status></div><p className="mt-2 text-xs text-slate-500">{new Date(transfer.created_at).toLocaleString('ar-EG')}</p></article>)}</OperationList> : null}

    <RegisterPaymentSheet open={paymentOpen} onOpenChange={setPaymentOpen} tenantId={tenantId} canConfirm={canConfirmPayment} canAllocate={canAllocate} onCompleted={load}/>
    <InternalTransferSheet open={transferOpen} onOpenChange={setTransferOpen} tenantId={tenantId} onCompleted={load}/>
    <PaymentAllocationSheet open={Boolean(allocationPayment)} onOpenChange={(value) => !value && setAllocationPayment(null)} tenantId={tenantId} payment={allocationPayment} onChanged={load}/>
  </div>;
}

function Tab({ active, ...props }) { return <button type="button" className={`min-h-10 rounded-xl px-4 text-sm font-bold ${active ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500'}`} {...props}/>; }
function OperationList({ children, empty }) { return <section className="space-y-3">{children?.length ? children : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">{empty}</div>}</section>; }
function Status({ children, success }) { return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${success ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}>{children}</span>; }
