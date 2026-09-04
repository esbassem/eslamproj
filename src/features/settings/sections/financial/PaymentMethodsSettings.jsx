import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BadgeCheck, CircleAlert, CreditCard, Landmark, Pencil, Plus, Power, RefreshCw, WalletCards } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetDismissButton, SheetFooter, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { financialReadinessService } from '@/features/settings/services/financialReadiness.service';
import { PAYMENT_METHOD_TYPES, paymentMethodsSettingsService } from '@/features/settings/services/paymentMethodsSettings.service';

const typeIcons = { cash: Landmark, bank_transfer: Landmark, wallet: WalletCards, card: CreditCard };
const defaultNames = Object.fromEntries(PAYMENT_METHOD_TYPES.map((type) => [type.code, type.label]));

function methodStatus(method) {
  if (!method.isActive) return { label: 'غير نشط', className: 'bg-slate-100 text-slate-700' };
  if (!method.isUsable) return { label: 'يحتاج إلى استكمال الإعداد', className: 'bg-amber-100 text-amber-900' };
  return { label: 'نشط', className: 'bg-emerald-100 text-emerald-800' };
}

function ClearingOptionLabel({ option }) {
  return (
    <>
      <span className="block font-bold text-slate-900">{option.accountLabel} — {option.journalLabel}</span>
      <span className="mt-1 block text-xs leading-5 text-slate-500">
        {option.destinationLabel}{option.branchLabel ? ` · ${option.branchLabel}` : ''}
      </span>
    </>
  );
}

function CreatePaymentMethodSheet({ open, tenantId, onClose, onCreated }) {
  const navigate = useNavigate();
  const [values, setValues] = useState({ type: '', name: '', clearingConfigurationKey: '' });
  const [optionsState, setOptionsState] = useState({ status: 'idle', items: [], error: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const nameEdited = useRef(false);
  const requestKey = useRef(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (!open) return;
    setValues({ type: '', name: '', clearingConfigurationKey: '' });
    setOptionsState({ status: 'idle', items: [], error: '' });
    setError(null);
    nameEdited.current = false;
    requestKey.current = crypto.randomUUID();
  }, [open]);

  const loadClearingOptions = useCallback(async () => {
    setOptionsState({ status: 'loading', items: [], error: '' });
    try {
      const items = await paymentMethodsSettingsService.listClearingOptions(tenantId);
      setOptionsState({ status: 'ready', items, error: '' });
      setValues((current) => ({ ...current, clearingConfigurationKey: items.length === 1 ? items[0].key : '' }));
    } catch (nextError) {
      setOptionsState({ status: 'error', items: [], error: nextError.message });
    }
  }, [tenantId]);

  useEffect(() => {
    if (open && values.type === 'card' && optionsState.status === 'idle') loadClearingOptions();
  }, [loadClearingOptions, open, optionsState.status, values.type]);

  const selectType = (type) => {
    setValues((current) => ({
      ...current,
      type: type.code,
      name: nameEdited.current ? current.name : defaultNames[type.code],
      clearingConfigurationKey: '',
    }));
    setError(null);
    setOptionsState({ status: 'idle', items: [], error: '' });
  };

  const cardReady = values.type !== 'card'
    || (optionsState.status === 'ready' && optionsState.items.length > 0 && values.clearingConfigurationKey);
  const valid = Boolean(values.type && values.name.trim() && cardReady);

  const submit = async (event) => {
    event.preventDefault();
    if (!valid || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    setError(null);
    try {
      await paymentMethodsSettingsService.create(tenantId, values, requestKey.current);
      await onCreated();
      onClose();
    } catch (nextError) {
      setError(nextError);
      if (nextError.code === 'PAYMENT_METHOD_CLEARING_CONFIGURATION_INVALID') loadClearingOptions();
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(value) => !value && onClose()}>
      <SheetContent side="left" dir="rtl" className="w-full max-w-none sm:max-w-xl">
        <SheetDismissButton aria-label="إغلاق إضافة طريقة دفع" />
        <SheetHeader>
          <SheetTitle>إضافة طريقة دفع</SheetTitle>
          <SheetDescription>أضف الطريقة التي سيستخدمها فريقك في التحصيل أو الدفع.</SheetDescription>
        </SheetHeader>
        <form onSubmit={submit} className="contents">
          <SheetBody className="space-y-5">
            <fieldset>
              <legend className="text-sm font-black text-slate-900">النوع</legend>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {PAYMENT_METHOD_TYPES.map((type) => {
                  const Icon = typeIcons[type.code];
                  const selected = values.type === type.code;
                  return (
                    <button key={type.code} type="button" onClick={() => selectType(type)} aria-pressed={selected} className={`min-h-16 rounded-xl border p-3 text-right transition ${selected ? 'border-blue-500 bg-blue-50 text-blue-950' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'}`}>
                      <span className="flex items-center gap-2 font-black"><Icon className="h-4 w-4" />{type.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {values.type ? (
              <label className="block text-sm font-bold text-slate-800">
                <span>الاسم</span>
                <Input className="mt-2" value={values.name} onChange={(event) => { nameEdited.current = true; setValues((current) => ({ ...current, name: event.target.value })); }} placeholder="اسم واضح لفريقك" />
              </label>
            ) : null}

            {values.type === 'card' ? (
              <section className="rounded-xl border border-slate-200 bg-slate-50 p-4" aria-label="إعداد تسوية البطاقة">
                <h3 className="text-sm font-black text-slate-900">إعداد استلام مبالغ البطاقات</h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">اختر الإعداد المالي الجاهز الذي ستُتابع من خلاله مبالغ البطاقات.</p>
                {optionsState.status === 'loading' ? <p className="mt-4 text-sm text-slate-500">جاري تحميل الإعدادات المتاحة...</p> : null}
                {optionsState.status === 'error' ? <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"><p>{optionsState.error}</p><Button type="button" size="sm" variant="secondary" className="mt-3" onClick={loadClearingOptions}><RefreshCw className="h-4 w-4" />إعادة المحاولة</Button></div> : null}
                {optionsState.status === 'ready' && !optionsState.items.length ? <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm leading-6 text-amber-900"><p className="font-bold">لا يوجد إعداد تسوية متاح للبطاقات.</p><p>أكمل الإعداد المالي المطلوب أولًا قبل إضافة طريقة البطاقة.</p></div> : null}
                {optionsState.status === 'ready' && optionsState.items.length ? (
                  <div className="mt-4 space-y-2">
                    {optionsState.items.map((option) => (
                      <label key={option.key} className={`block cursor-pointer rounded-lg border p-3 ${values.clearingConfigurationKey === option.key ? 'border-blue-500 bg-white' : 'border-slate-200 bg-white/70'}`}>
                        <input className="sr-only" type="radio" name="clearing-option" value={option.key} checked={values.clearingConfigurationKey === option.key} onChange={() => setValues((current) => ({ ...current, clearingConfigurationKey: option.key }))} />
                        <ClearingOptionLabel option={option} />
                      </label>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {error ? (
              <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-800">
                <p className="font-bold">{error.message}</p>
                {error.code === 'PAYMENT_METHOD_COMPATIBLE_DESTINATION_REQUIRED' ? <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => navigate(ROUTES.settingsMoneyDestinations)}>إعداد أماكن الأموال</Button> : null}
              </div>
            ) : null}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>إلغاء</Button>
            <Button type="submit" disabled={!valid || saving}>{saving ? 'جاري الحفظ...' : 'إضافة طريقة الدفع'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function PaymentMethodDetailsSheet({ method, tenantId, onClose, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(method?.name ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirmingDeactivation, setConfirmingDeactivation] = useState(false);

  useEffect(() => { setName(method?.name ?? ''); setEditing(false); setError(''); setConfirmingDeactivation(false); }, [method]);
  if (!method) return null;
  const status = methodStatus(method);

  const run = async (operation) => {
    if (pending) return;
    setPending(true); setError('');
    try { await operation(); await onChanged(); } catch (nextError) { setError(nextError.message); } finally { setPending(false); }
  };

  const rename = () => run(async () => {
    await paymentMethodsSettingsService.rename(tenantId, method.id, name);
    setEditing(false);
  });
  const setActive = (isActive) => run(() => paymentMethodsSettingsService.setActive(tenantId, method.id, isActive));

  return (
    <Sheet open onOpenChange={(value) => !value && onClose()}>
      <SheetContent side="left" dir="rtl" className="w-full max-w-none sm:max-w-lg">
        <SheetDismissButton aria-label="إغلاق تفاصيل طريقة الدفع" />
        <SheetHeader><SheetTitle>{method.name}</SheetTitle><SheetDescription>{method.typeLabel}</SheetDescription></SheetHeader>
        <SheetBody className="space-y-5">
          <section className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3"><h3 className="font-black">البيانات الأساسية</h3>{!editing ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />تعديل الاسم</Button> : null}</div>
            {editing ? <div className="mt-4 space-y-3"><Input value={name} onChange={(event) => setName(event.target.value)} /><div className="flex gap-2"><Button size="sm" disabled={!name.trim() || pending} onClick={rename}>حفظ</Button><Button size="sm" variant="secondary" onClick={() => { setName(method.name); setEditing(false); }}>إلغاء</Button></div></div> : null}
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">النوع</dt><dd className="font-bold">{method.typeLabel}</dd></div><div><dt className="text-slate-500">الحالة</dt><dd><span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${status.className}`}>{status.label}</span></dd></div></dl>
          </section>
          {method.settlementMode === 'clearing' ? <p className="rounded-xl bg-blue-50 p-4 text-sm font-bold text-blue-900">تُتابع مبالغ هذه الطريقة عبر إعداد مالي وسيط حتى اكتمال التسوية.</p> : null}
          <section className="rounded-xl border border-slate-200 p-4"><h3 className="font-black">حالة الاستخدام</h3><p className="mt-1 text-sm leading-6 text-slate-500">التعطيل يمنع استخدام الطريقة في العمليات الجديدة ويحافظ على كل العمليات السابقة.</p><div className="mt-4">{method.isActive ? confirmingDeactivation ? <div className="rounded-lg bg-amber-50 p-3"><p className="text-sm font-bold text-amber-950">لن تكون طريقة الدفع متاحة للعمليات الجديدة.</p><div className="mt-3 flex gap-2"><Button size="sm" variant="secondary" disabled={pending} onClick={() => setActive(false)}>تأكيد التعطيل</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmingDeactivation(false)}>إلغاء</Button></div></div> : <Button variant="secondary" disabled={pending} onClick={() => setConfirmingDeactivation(true)}><Power className="h-4 w-4" />تعطيل</Button> : <Button disabled={pending} onClick={() => setActive(true)}><Power className="h-4 w-4" />تفعيل</Button>}</div></section>
          {error ? <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{error}</p> : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

export function PaymentMethodsSettings({ tenantId, canManage }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', items: [], error: null });
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const selected = useMemo(() => state.items.find((method) => method.id === selectedId) ?? null, [selectedId, state.items]);

  const load = useCallback(async () => {
    if (!canManage) { setState({ status: 'denied', items: [], error: null }); return; }
    setState((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const items = await paymentMethodsSettingsService.list(tenantId);
      setState({ status: 'ready', items, error: null });
    } catch (error) {
      setState({ status: error.code === 'FINANCIAL_AUTHORIZATION_REQUIRED' ? 'denied' : 'error', items: [], error });
    }
  }, [canManage, tenantId]);

  const refreshAfterChange = useCallback(async () => {
    await load();
    try { await financialReadinessService.getReadiness(tenantId); } catch { /* Overview remains authoritative on revisit. */ }
  }, [load, tenantId]);

  useEffect(() => { load(); }, [load]);

  if (state.status === 'loading') return <div aria-label="جاري تحميل طرق الدفع" className="grid gap-3"><div className="h-20 animate-pulse rounded-2xl bg-slate-100" /><div className="h-20 animate-pulse rounded-2xl bg-slate-100" /></div>;
  if (state.status === 'denied') return <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center"><CircleAlert className="mx-auto h-7 w-7 text-amber-800" /><h2 className="mt-3 font-black text-amber-950">لا يمكنك إدارة طرق الدفع</h2><p className="mt-1 text-sm leading-6 text-amber-900">تحتاج إلى صلاحية إدارة طرق الدفع لعرض هذه الإعدادات.</p></div>;
  if (state.status === 'error') return <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center"><CircleAlert className="mx-auto h-7 w-7 text-red-700" /><h2 className="mt-3 font-black text-red-950">تعذر تحميل طرق الدفع</h2><p className="mt-1 text-sm text-red-800">{state.error?.message}</p><Button className="mt-4" variant="secondary" onClick={load}><RefreshCw className="h-4 w-4" />إعادة المحاولة</Button></div>;

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm leading-6 text-slate-600">حدد طرق الدفع التي يمكن استخدامها في العمليات المالية.</p><Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />إضافة طريقة دفع</Button></div>
      {!state.items.length ? (
        <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><CreditCard className="mx-auto h-9 w-9 text-slate-400" /><h2 className="mt-4 text-lg font-black text-slate-950">لا توجد طرق دفع</h2><p className="mt-1 text-sm leading-6 text-slate-500">أضف طرق الدفع التي ستستخدمها في التحصيل والدفع.</p><Button className="mt-5" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />إضافة طريقة دفع</Button></section>
      ) : (
        <div className="grid gap-3">
          {state.items.map((method) => {
            const Icon = typeIcons[method.type] ?? CreditCard;
            const status = methodStatus(method);
            return <article key={method.id} className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700"><Icon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h2 className="font-black text-slate-950">{method.name}</h2><div className="mt-1 flex flex-wrap items-center gap-2 text-xs"><span className="font-bold text-slate-500">{method.typeLabel}</span>{method.settlementMode === 'clearing' ? <span className="text-slate-500">تسوية عبر حساب وسيط</span> : null}<span className={`rounded-full px-2 py-1 font-bold ${status.className}`}>{status.label}</span></div></div><Button variant="secondary" size="sm" onClick={() => setSelectedId(method.id)}><BadgeCheck className="h-4 w-4" />إدارة</Button>{method.isActive && !method.isUsable && method.settlementMode === 'direct' ? <Button variant="ghost" size="sm" onClick={() => navigate(ROUTES.settingsMoneyDestinations)}>إعداد أماكن الأموال</Button> : null}</article>;
          })}
        </div>
      )}
      <CreatePaymentMethodSheet open={createOpen} tenantId={tenantId} onClose={() => setCreateOpen(false)} onCreated={refreshAfterChange} />
      <PaymentMethodDetailsSheet method={selected} tenantId={tenantId} onClose={() => setSelectedId(null)} onChanged={refreshAfterChange} />
    </div>
  );
}
