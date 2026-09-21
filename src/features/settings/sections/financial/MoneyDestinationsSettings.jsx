import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Building2, Landmark, Pencil, Plus, Power, RefreshCw, Store, UserRound, WalletCards } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetDismissButton, SheetFooter, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { financialReadinessService } from '@/features/settings/services/financialReadiness.service';
import { MONEY_DESTINATION_TYPES, moneyDestinationsService } from '@/features/settings/services/moneyDestinations.service';
import { listMoneyDestinationBalances } from '@/features/finance/money-destinations/moneyDestinations.service';

const statusLabels = { active: 'نشط', inactive: 'غير نشط', archived: 'مؤرشف', draft: 'مسودة', configuring: 'قيد الإعداد' };
const typeIcons = { cashbox: Landmark, bank: Building2, employee_cash_custody: UserRound, pos_drawer: Store, wallet: WalletCards };

function Field({ label, children, hint }) {
  return <label className="block text-sm font-bold text-slate-800"><span>{label}</span>{children}{hint ? <span className="mt-1 block text-xs font-normal leading-5 text-slate-500">{hint}</span> : null}</label>;
}

function Select({ className = '', ...props }) {
  return <select className={`mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-4 focus:ring-slate-100 ${className}`} {...props}/>;
}

function CreateDestinationSheet({ open, tenantId, onClose, onCreated }) {
  const [values, setValues] = useState({ type: '', name: '', branchId: '', responsibleUserId: '', posConfigId: '', bankName: '', bankAccountLabel: '', bankIdentifierMasked: '' });
  const [branches, setBranches] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [posConfigs, setPosConfigs] = useState([]);
  const [loadingChoices, setLoadingChoices] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const requestKey = useRef(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (!open) return;
    requestKey.current = crypto.randomUUID();
    setValues({ type: '', name: '', branchId: '', responsibleUserId: '', posConfigId: '', bankName: '', bankAccountLabel: '', bankIdentifierMasked: '' });
    setBranches([]); setEmployees([]); setPosConfigs([]); setError('');
    moneyDestinationsService.listBranches(tenantId).then(setBranches).catch(() => setBranches([]));
  }, [open, tenantId]);

  useEffect(() => {
    if (!open || values.type !== 'employee_cash_custody' || employees.length) return;
    setLoadingChoices(true);
    moneyDestinationsService.listEmployees(tenantId).then(setEmployees).catch((nextError) => setError(nextError.message)).finally(() => setLoadingChoices(false));
  }, [employees.length, open, tenantId, values.type]);

  useEffect(() => {
    if (!open || values.type !== 'pos_drawer' || posConfigs.length) return;
    setLoadingChoices(true);
    moneyDestinationsService.listPosConfigs(tenantId).then(setPosConfigs).catch((nextError) => setError(nextError.message)).finally(() => setLoadingChoices(false));
  }, [open, posConfigs.length, tenantId, values.type]);

  const update = (key, value) => setValues((current) => ({ ...current, [key]: value }));
  const selectedPos = posConfigs.find((item) => item.id === values.posConfigId);
  const valid = values.type && values.name.trim()
    && (values.type !== 'bank' || (values.bankName.trim() && values.bankAccountLabel.trim()))
    && (values.type !== 'employee_cash_custody' || values.responsibleUserId)
    && (values.type !== 'pos_drawer' || (values.posConfigId && selectedPos?.branch_id));

  const submit = async (event) => {
    event.preventDefault();
    if (!valid || submitting.current) return;
    submitting.current = true; setSaving(true); setError('');
    try {
      await moneyDestinationsService.create(tenantId, { ...values, branchId: values.type === 'pos_drawer' ? selectedPos.branch_id : values.branchId }, requestKey.current);
      await onCreated();
      onClose();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      submitting.current = false; setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
      <SheetContent side="left" dir="rtl" className="w-full max-w-none sm:max-w-xl">
        <SheetDismissButton aria-label="إغلاق إضافة مكان أموال"/>
        <SheetHeader><SheetTitle>إضافة مكان أموال</SheetTitle><SheetDescription>اختر مكان الاحتفاظ بالأموال، وسينشئ النظام الربط المحاسبي المطلوب تلقائيًا.</SheetDescription></SheetHeader>
        <form onSubmit={submit} className="contents">
          <SheetBody className="space-y-5">
            <fieldset><legend className="text-sm font-black">أين سيتم الاحتفاظ بالأموال؟</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{MONEY_DESTINATION_TYPES.map((type) => { const Icon = typeIcons[type.code]; return <button key={type.code} type="button" onClick={() => setValues((current) => ({ ...current, type: type.code, responsibleUserId: '', posConfigId: '', bankName: '', bankAccountLabel: '', bankIdentifierMasked: '' }))} className={`min-h-20 rounded-xl border p-3 text-right ${values.type === type.code ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}><span className="flex items-center gap-2 font-black"><Icon className="h-4 w-4"/>{type.label}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{type.description}</span></button>; })}</div></fieldset>
            {values.type ? <Field label="اسم مكان الأموال"><Input className="mt-2" value={values.name} onChange={(event) => update('name', event.target.value)} placeholder={values.type === 'cashbox' ? 'مثال: خزنة معرض حلوان' : 'اسم واضح لفريقك'}/></Field> : null}
            {values.type && values.type !== 'pos_drawer' ? <Field label="الفرع (اختياري)" hint="اتركه فارغًا إذا كان مكان الأموال متاحًا على مستوى الشركة."><Select value={values.branchId} onChange={(event) => update('branchId', event.target.value)}><option value="">كل الشركة</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select></Field> : null}
            {values.type === 'bank' ? <div className="space-y-4 rounded-xl bg-slate-50 p-4"><Field label="اسم البنك"><Input className="mt-2" value={values.bankName} onChange={(event) => update('bankName', event.target.value)}/></Field><Field label="وصف الحساب" hint="مثال: الحساب الجاري الرئيسي"><Input className="mt-2" value={values.bankAccountLabel} onChange={(event) => update('bankAccountLabel', event.target.value)}/></Field><Field label="معرّف مختصر ظاهر (اختياري)" hint="آخر أرقام أو وصف آمن فقط، وليس رقم الحساب الكامل."><Input className="mt-2" value={values.bankIdentifierMasked} onChange={(event) => update('bankIdentifierMasked', event.target.value)} placeholder="مثال: •••• 2451"/></Field></div> : null}
            {values.type === 'employee_cash_custody' ? <Field label="الموظف المسؤول" hint="هذه نقدية مملوكة للشركة ومحفوظة لدى الموظف."><Select disabled={loadingChoices} value={values.responsibleUserId} onChange={(event) => update('responsibleUserId', event.target.value)}><option value="">{loadingChoices ? 'جاري تحميل الموظفين...' : 'اختر الموظف'}</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select></Field> : null}
            {values.type === 'pos_drawer' ? <Field label="نقطة البيع" hint="سيُستخدم فرع نقطة البيع تلقائيًا."><Select disabled={loadingChoices} value={values.posConfigId} onChange={(event) => update('posConfigId', event.target.value)}><option value="">{loadingChoices ? 'جاري تحميل نقاط البيع...' : 'اختر نقطة البيع'}</option>{posConfigs.map((pos) => <option key={pos.id} value={pos.id}>{pos.name}</option>)}</Select>{selectedPos ? <span className="mt-2 block text-xs text-slate-500">الفرع: {branches.find((branch) => branch.id === selectedPos.branch_id)?.name ?? 'فرع نقطة البيع'}</span> : null}</Field> : null}
            {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p> : null}
          </SheetBody>
          <SheetFooter><Button type="button" variant="secondary" onClick={onClose} disabled={saving}>إلغاء</Button><Button type="submit" disabled={!valid || saving}>{saving ? 'جاري الإعداد...' : 'إضافة وتجهيز المكان'}</Button></SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function DestinationDetailsSheet({ destination, balance, tenantId, canManage, onClose, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(destination?.name ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setName(destination?.name ?? ''); setEditing(false); setError(''); }, [destination]);
  if (!destination) return null;

  const run = async (operation) => {
    if (pending) return;
    setPending(true); setError('');
    try { await operation(); await onChanged(); } catch (nextError) { setError(nextError.message); } finally { setPending(false); }
  };
  const saveName = () => run(async () => { await moneyDestinationsService.rename(tenantId, destination.id, name); setEditing(false); });
  const setStatus = (status) => run(() => moneyDestinationsService.setStatus(tenantId, destination.id, status));

  return <Sheet open onOpenChange={(value) => !value && onClose()}><SheetContent side="left" dir="rtl" className="w-full max-w-none sm:max-w-xl"><SheetDismissButton aria-label="إغلاق تفاصيل مكان الأموال"/><SheetHeader><SheetTitle>{destination.name}</SheetTitle><SheetDescription>{destination.typeLabel} · {statusLabels[destination.status] ?? destination.status}</SheetDescription></SheetHeader><SheetBody className="space-y-5">
    <section className="rounded-xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><h3 className="font-black">البيانات الأساسية</h3>{canManage && !editing ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4"/>تعديل الاسم</Button> : null}</div>{editing ? <div className="mt-4 flex gap-2"><Input value={name} onChange={(event) => setName(event.target.value)}/><Button size="sm" disabled={!name.trim() || pending} onClick={saveName}>حفظ</Button></div> : null}<dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-slate-500">النوع</dt><dd className="font-bold">{destination.typeLabel}</dd></div><div><dt className="text-slate-500">الحالة</dt><dd className="font-bold">{statusLabels[destination.status] ?? destination.status}</dd></div>{balance ? <div><dt className="text-slate-500">الرصيد التشغيلي</dt><dd className="font-bold">{Number(balance.balance).toLocaleString('ar-EG')} {balance.currencyCode || ''}</dd></div> : null}{destination.branchName ? <div><dt className="text-slate-500">الفرع</dt><dd className="font-bold">{destination.branchName}</dd></div> : null}{destination.responsibleUserName ? <div><dt className="text-slate-500">الموظف المسؤول</dt><dd className="font-bold">{destination.responsibleUserName}</dd></div> : null}{destination.posConfigName ? <div><dt className="text-slate-500">نقطة البيع</dt><dd className="font-bold">{destination.posConfigName}</dd></div> : null}{destination.bankName ? <div><dt className="text-slate-500">البنك</dt><dd className="font-bold">{destination.bankName}</dd></div> : null}{destination.bankAccountLabel ? <div><dt className="text-slate-500">وصف الحساب</dt><dd className="font-bold">{destination.bankAccountLabel}</dd></div> : null}</dl></section>
    <p className="rounded-xl bg-emerald-50 p-4 text-sm font-bold text-emerald-900">تم إعداد الحساب واليومية والربط المحاسبي تلقائيًا.</p>
    {canManage && destination.status !== 'archived' ? <section className="rounded-xl border border-slate-200 p-4"><h3 className="font-black">حالة الاستخدام</h3><p className="mt-1 text-sm leading-6 text-slate-500">التعطيل يمنع العمليات الجديدة ويحافظ على كل السجل السابق. الأرشفة نهائية ولا تحذف التاريخ.</p><div className="mt-4 flex flex-wrap gap-2">{destination.status === 'active' ? <Button variant="secondary" disabled={pending} onClick={() => setStatus('inactive')}><Power className="h-4 w-4"/>تعطيل</Button> : null}{destination.status === 'inactive' ? <><Button disabled={pending} onClick={() => setStatus('active')}><Power className="h-4 w-4"/>إعادة التفعيل</Button><Button variant="secondary" disabled={pending} onClick={() => setStatus('archived')}><Archive className="h-4 w-4"/>أرشفة</Button></> : null}</div></section> : null}
    {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p> : null}
  </SheetBody></SheetContent></Sheet>;
}

export function MoneyDestinationsSettings({ tenantId, canManage }) {
  const [state, setState] = useState({ status: 'loading', items: [], error: '' });
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [balances, setBalances] = useState(new Map());
  const selected = useMemo(() => state.items.find((item) => item.id === selectedId) ?? null, [selectedId, state.items]);
  const load = useCallback(async () => { setState((current) => ({ ...current, status: 'loading', error: '' })); try { const items = await moneyDestinationsService.list(tenantId); let balanceRows = []; if (canManage) { try { balanceRows = await listMoneyDestinationBalances({ tenantId, permissionCode: 'financial.destination.manage', accessType: 'view' }); } catch { balanceRows = []; } } setState({ status: 'ready', items, error: '' }); setBalances(new Map(balanceRows.map((item) => [item.destinationId, item]))); } catch (error) { setState({ status: 'error', items: [], error: error.message }); setBalances(new Map()); } }, [canManage, tenantId]);
  const refreshAfterChange = useCallback(async () => { await load(); try { setReadiness(await financialReadinessService.getReadiness(tenantId)); } catch { setReadiness(null); } }, [load, tenantId]);
  useEffect(() => { load(); }, [load]);

  if (state.status === 'loading') return <div aria-label="جاري تحميل أماكن الأموال" className="grid gap-3"><div className="h-24 animate-pulse rounded-2xl bg-slate-100"/><div className="h-24 animate-pulse rounded-2xl bg-slate-100"/></div>;
  if (state.status === 'error') return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center"><p className="font-bold text-red-800">{state.error}</p><Button className="mt-4" variant="secondary" onClick={load}><RefreshCw className="h-4 w-4"/>إعادة المحاولة</Button></div>;

  return <div className="space-y-5" dir="rtl"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-black">أماكن الأموال</h2><p className="mt-1 text-sm text-slate-500">الخزن والحسابات والعهد ونقاط البيع والمحافظ المستخدمة في نشاطك.</p></div>{canManage ? <Button className="min-h-11" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4"/>إضافة مكان أموال</Button> : null}</div>
    {readiness ? <p className={`rounded-xl p-3 text-sm font-bold ${readiness.checks.destinations ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>تم تحديث الجاهزية: {readiness.checks.destinations ? 'أماكن الأموال جاهزة' : 'ما زال إعداد أماكن الأموال يحتاج إلى استكمال'}.</p> : null}
    {!state.items.length ? <section className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-10 text-center"><WalletCards className="mx-auto h-9 w-9 text-slate-500"/><h3 className="mt-3 text-lg font-black">لا توجد أماكن أموال حتى الآن</h3><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">أضف المكان الذي تستقبل أو تحتفظ فيه بأموال النشاط، مثل خزنة أو حساب بنكي أو عهدة موظف أو درج نقطة بيع أو محفظة إلكترونية.</p>{canManage ? <Button className="mt-5" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4"/>إضافة مكان أموال</Button> : null}</section> : <div className="grid gap-3 lg:grid-cols-2">{state.items.map((destination) => { const Icon = typeIcons[destination.type] ?? WalletCards; const balance = balances.get(destination.id); return <button key={destination.id} type="button" onClick={() => setSelectedId(destination.id)} className="min-h-28 rounded-2xl border border-slate-200 bg-white p-4 text-right transition hover:border-slate-300 hover:bg-slate-50"><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100"><Icon className="h-5 w-5"/></span><span className="min-w-0 flex-1"><span className="block truncate font-black">{destination.name}</span><span className="mt-1 block text-sm text-slate-500">{destination.typeLabel}{destination.branchName ? ` · ${destination.branchName}` : ''}</span>{balance ? <span className="mt-2 block text-sm font-black text-slate-900">الرصيد: {Number(balance.balance).toLocaleString('ar-EG')} {balance.currencyCode || ''}</span> : null}{destination.responsibleUserName ? <span className="mt-1 block text-xs text-slate-500">المسؤول: {destination.responsibleUserName}</span> : null}{destination.posConfigName ? <span className="mt-1 block text-xs text-slate-500">نقطة البيع: {destination.posConfigName}</span> : null}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${destination.status === 'active' ? 'bg-emerald-50 text-emerald-800' : destination.status === 'archived' ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-800'}`}>{statusLabels[destination.status] ?? destination.status}</span></div></button>; })}</div>}
    <CreateDestinationSheet open={createOpen} tenantId={tenantId} onClose={() => setCreateOpen(false)} onCreated={refreshAfterChange}/><DestinationDetailsSheet destination={selected} balance={selected ? balances.get(selected.id) : null} tenantId={tenantId} canManage={canManage} onClose={() => setSelectedId(null)} onChanged={refreshAfterChange}/>
  </div>;
}
