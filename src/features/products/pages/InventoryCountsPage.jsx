import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ClipboardCheck, Plus, Search, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/core/ui/button';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { inventoryService, normalizeTrackingIdentifierValue } from '@/features/inventory/api/inventory.api';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const key = (prefix) => `${prefix}:${crypto.randomUUID()}`;
const labels = { draft: 'مسودة', submitted: 'بانتظار المراجعة', posted: 'مرحّل', cancelled: 'ملغي' };
const varianceLabels = {
  matched: 'مطابق', missing: 'وحدة مسجلة وغير موجودة فعليًا', unexpected: 'وحدة غير متوقعة في نطاق الجرد',
  location_mismatch: 'الوحدة في موقع مختلف', identity_review: 'هوية غير معروفة وتحتاج مراجعة',
  zero: 'الكمية مطابقة', positive: 'زيادة فعلية', negative: 'عجز فعلي',
};
const stateLabels = { available: 'متاح', reserved: 'محجوز', issued: 'مباع/مُسلّم', blocked: 'موقوف' };
const adjustableTypes = new Set(['positive', 'negative', 'missing', 'location_mismatch']);

function hydrateDraft(count) {
  const observations = count?.observations ?? [];
  return {
    serials: observations.filter((item) => item.type === 'serial').map((item) => ({
      identifier: item.identifier, status: item.tracking_unit_id ? 'matched' : 'unknown', unit: null,
    })),
    quantities: Object.fromEntries(observations.filter((item) => item.type === 'quantity')
      .map((item) => [item.product_id, String(item.physical_quantity)])),
  };
}

function observationPayload(serials, quantities, quantityProducts) {
  const observations = serials.map((item) => ({ type: 'serial', identifier: item.identifier }));
  quantityProducts.forEach((product) => {
    const value = quantities[product.id];
    if (value !== '' && value != null) observations.push({ type: 'quantity', product_id: product.id, physical_quantity: Number(value) });
  });
  return observations;
}

function proposedEffect(variance) {
  if (variance.variance_type === 'missing') return 'إيقاف الوحدة وإزالتها من المتاح بالموقع';
  if (variance.variance_type === 'location_mismatch') return 'تصحيح موقع الوحدة إلى موقع الجرد';
  if (variance.variance_type === 'positive') return `زيادة الرصيد إلى ${variance.physical_quantity}`;
  if (variance.variance_type === 'negative') return `خفض الرصيد إلى ${variance.physical_quantity}`;
  if (variance.variance_type === 'identity_review') return 'لا تعديل؛ يلزم التحقق ثم الاستلام/التبنّي Canonical وإعادة الجرد';
  return 'لا تغيير تلقائي';
}

export function InventoryCountsPage() {
  const { tenant, tenantUser } = useWorkspace();
  const { can, isLoading: permissionsLoading } = useAuthorization();
  const tenantId = tenant?.id;
  const userBranchId = tenantUser?.branch_id ?? tenantUser?.branchId ?? '';
  const canAdjust = can('inventory.adjust');
  const [locations, setLocations] = useState([]);
  const [products, setProducts] = useState([]);
  const [counts, setCounts] = useState([]);
  const [active, setActive] = useState(null);
  const [locationId, setLocationId] = useState('');
  const [requiredQuantityIds, setRequiredQuantityIds] = useState([]);
  const [serials, setSerials] = useState([]);
  const [quantities, setQuantities] = useState({});
  const [identityQuery, setIdentityQuery] = useState('');
  const [identityResult, setIdentityResult] = useState(null);
  const [identityBusy, setIdentityBusy] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [decisions, setDecisions] = useState({});
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [postedResult, setPostedResult] = useState(null);
  const [units, setUnits] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const selectedLocation = locations.find((item) => item.id === (active?.location_id || locationId));
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const unitsById = useMemo(() => new Map(units.map((unit) => [unit.id, unit])), [units]);
  const locationsById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const quantityProducts = useMemo(() => products.filter((product) => product.tracking !== 'serial'
    && (!active || requiredQuantityIds.includes(product.id))), [active, products, requiredQuantityIds]);
  const pendingVariances = active?.variances?.filter((item) => item.resolution_state === 'pending') ?? [];
  const unresolvedIdentities = pendingVariances.filter((item) => item.variance_type === 'identity_review');
  const reviewableVariances = pendingVariances.filter((item) => item.variance_type !== 'identity_review');
  const decisionsComplete = reviewableVariances.every((item) => decisions[item.id]?.action && decisions[item.id]?.reason?.trim());

  const reload = async () => {
    if (!tenantId) return;
    const [nextLocations, nextProducts, nextCounts] = await Promise.all([
      inventoryService.listReceivingLocations({ tenantId }), inventoryService.listProducts(tenantId),
      inventoryService.listInventoryCounts({ tenantId }),
    ]);
    setLocations(nextLocations); setProducts(nextProducts); setCounts(nextCounts);
    setLocationId((current) => {
      if (current && nextLocations.some((item) => item.id === current)) return current;
      const branchLocations = userBranchId ? nextLocations.filter((item) => item.branchId === userBranchId) : [];
      return branchLocations.length === 1 ? branchLocations[0].id : nextLocations.length === 1 ? nextLocations[0].id : '';
    });
  };
  useEffect(() => { void reload().catch((nextError) => setError(nextError.message)); }, [tenantId, userBranchId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const preventLoss = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty]);

  const run = async (operation) => {
    setBusy(true); setError(''); setNotice('');
    try { return await operation(); } catch (nextError) { setError(nextError.message); return null; } finally { setBusy(false); }
  };

  const resolveSavedSerials = async (draftSerials) => Promise.all(draftSerials.map(async (item) => {
    try {
      const result = await inventoryService.searchSerialUnitsByIdentifiers({
        tenantId, chassisNumber: item.identifier, engineNumber: item.identifier,
        trackingNumber: item.identifier, limit: 5,
      });
      if (result.units.length === 1) return { ...item, status: 'matched', unit: result.units[0] };
      if (result.units.length > 1) return { ...item, status: 'ambiguous', unit: null };
      return { ...item, status: 'unknown', unit: null };
    } catch { return item; }
  }));

  const openCount = async (id) => {
    setDraftLoaded(false); setPostedResult(null); setDecisions({}); setConfirming(false);
    const value = await inventoryService.getInventoryCount({ countId: id });
    const requiredIds = await inventoryService.listCountQuantityProductIds({ tenantId, locationId: value.location_id });
    setRequiredQuantityIds(requiredIds);
    if (value.state === 'draft') {
      const restored = hydrateDraft(value);
      setSerials(await resolveSavedSerials(restored.serials));
      setQuantities(restored.quantities);
    } else {
      const unitIds = (value.variances || []).map((item) => item.tracking_unit_id).filter(Boolean);
      setUnits(await inventoryService.getInventoryCountUnits({ tenantId, trackingUnitIds: unitIds }));
    }
    setActive(value); setDirty(false); setDraftLoaded(true); setIdentityQuery(''); setIdentityResult(null);
  };

  const start = () => run(async () => {
    const location = locations.find((item) => item.id === locationId);
    if (!location) throw new Error('اختر الفرع وموقع المخزون صراحةً قبل بدء الجرد.');
    const result = await inventoryService.startInventoryCount({
      branchId: location.branchId, locationId, idempotencyKey: key('count-start'),
    });
    await openCount(result.count_id); await reload();
  });

  const searchIdentity = async () => {
    const query = identityQuery.trim();
    if (normalizeTrackingIdentifierValue(query).length < 6) { setError('اكتب 6 خانات على الأقل من رقم الشاسيه أو الموتور أو رقم التتبع.'); return; }
    setIdentityBusy(true); setError('');
    try {
      const result = await inventoryService.searchSerialUnitsByIdentifiers({
        tenantId, chassisNumber: query, engineNumber: query, trackingNumber: query, limit: 10,
      });
      setIdentityResult({ query, ...result });
    } catch (nextError) { setError(nextError.message); } finally { setIdentityBusy(false); }
  };

  const addObservation = (unit = null) => {
    const identifier = unit?.trackingNumber || identityResult?.query?.trim();
    const normalized = normalizeTrackingIdentifierValue(identifier);
    if (!identifier) return;
    if (serials.some((item) => normalizeTrackingIdentifierValue(item.identifier) === normalized
      || (unit?.id && item.unit?.id === unit.id))) { setError('تم تسجيل هذه الوحدة بالفعل في نفس الجرد.'); return; }
    const conflict = unit && (unit.canonicalState !== 'available' || unit.currentLocationId !== active.location_id);
    setSerials((items) => [...items, { identifier, unit, status: unit ? (conflict ? 'conflict' : 'matched') : 'unknown' }]);
    setDirty(true); setIdentityQuery(''); setIdentityResult(null); setError('');
  };

  const removeObservation = (index) => { setSerials((items) => items.filter((_, itemIndex) => itemIndex !== index)); setDirty(true); };
  const setQuantity = (productId, value) => { setQuantities((current) => ({ ...current, [productId]: value })); setDirty(true); };

  const validateDraft = () => {
    const missingQuantity = quantityProducts.find((product) => quantities[product.id] === '' || quantities[product.id] == null);
    if (missingQuantity) return `أدخل الكمية الفعلية للمنتج «${missingQuantity.displayName || missingQuantity.name}».`;
    if (Object.values(quantities).some((value) => value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0))) return 'الكميات يجب أن تكون أرقامًا صحيحة غير سالبة.';
    return '';
  };

  const saveDraft = async ({ silent = false } = {}) => {
    if (!draftLoaded || active?.state !== 'draft') throw new Error('المسودة لم تكتمل استعادتها بعد.');
    const validation = validateDraft();
    if (validation) throw new Error(validation);
    const observations = observationPayload(serials, quantities, quantityProducts);
    await inventoryService.saveInventoryCountObservations({ countId: active.id, observations, idempotencyKey: key('count-save') });
    await openCount(active.id);
    if (!silent) setNotice('تم حفظ المشاهدات، ويمكن الرجوع للمسودة لاحقًا بأمان.');
  };
  const save = () => run(() => saveDraft());
  const submit = () => run(async () => {
    await saveDraft({ silent: true });
    await inventoryService.submitInventoryCount({ countId: active.id, idempotencyKey: key('count-submit') });
    await openCount(active.id); await reload(); setNotice('تم إرسال الجرد وتجميده. راجع الفروق قبل أي تعديل.');
  });

  const leaveCount = () => {
    if (dirty && !window.confirm('هناك مشاهدات غير محفوظة. هل تريد الخروج بدون حفظها؟')) return;
    setActive(null); setSerials([]); setQuantities({}); setDirty(false); setDraftLoaded(false); setPostedResult(null);
  };

  const updateDecision = (varianceId, changes) => setDecisions((current) => ({
    ...current, [varianceId]: { action: '', reason: '', ...(current[varianceId] || {}), ...changes },
  }));
  const requestPost = () => {
    if (!canAdjust) { setError('ليست لديك صلاحية اعتماد تعديلات المخزون.'); return; }
    if (unresolvedIdentities.length) { setError('توجد هويات غير معروفة. تحقق منها عبر الاستلام/التبنّي الصحيح ثم أعد الجرد.'); return; }
    if (!reviewableVariances.length) { setError('لا توجد فروق معلقة للترحيل.'); return; }
    if (!decisionsComplete || !reason.trim()) { setError('اختر قرارًا واكتب سببًا لكل فرق، ثم اكتب سبب الترحيل العام.'); return; }
    setConfirming(true); setError('');
  };
  const post = () => run(async () => {
    const payload = reviewableVariances.map((variance) => ({
      variance_id: variance.id,
      action: decisions[variance.id].action,
      reviewer_reason: decisions[variance.id].reason.trim(),
    }));
    const result = await inventoryService.postInventoryAdjustment({
      countId: active.id, decisions: payload, reason: reason.trim(), idempotencyKey: key('adjustment-post'),
    });
    setConfirming(false); await openCount(active.id); await reload(); setPostedResult({ ...result, decisions: payload });
    setNotice('تم ترحيل القرارات المعتمدة بنجاح.');
  });

  return <div className="space-y-5" dir="rtl">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-2xl font-black text-slate-950">الجرد</h1><p className="mt-1 text-sm font-semibold text-slate-500">سجل الواقع الفيزيائي أولًا، ثم راجع الفروق قبل أي تعديل.</p></div>
      {!active ? <div className="flex flex-wrap gap-2">
        <select aria-label="الفرع وموقع المخزون" className="h-10 min-w-72 rounded-lg border px-3" value={locationId} onChange={(event) => setLocationId(event.target.value)}>
          <option value="">اختر الفرع والموقع</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.branchName} — {location.name}</option>)}
        </select>
        <Button disabled={!locationId || busy} onClick={start}><Plus className="h-4 w-4" />جرد جديد</Button>
      </div> : <Button variant="secondary" onClick={leaveCount}>العودة للقائمة</Button>}
    </header>
    {selectedLocation ? <div className="rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="text-xs font-bold text-blue-700">نطاق الجرد الحالي</p><p className="mt-1 text-lg font-black text-blue-950">{selectedLocation.branchName} — {selectedLocation.name}</p></div> : !active ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-900">اختر الفرع والموقع صراحةً. لن يتم اختيار موقع عشوائي بدلًا منك.</div> : null}
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div> : null}
    {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</div> : null}

    {!active ? <div className="space-y-2">{counts.map((count) => <button type="button" key={count.id} onClick={() => run(() => openCount(count.id))} className="flex w-full justify-between rounded-xl border bg-white p-4 text-right"><span><strong className="block">جرد {new Date(count.started_at).toLocaleString('ar-EG')}</strong><small className="text-slate-500">{locationsById.get(count.location_id)?.branchName || 'فرع مصرح'} — {locationsById.get(count.location_id)?.name || 'موقع مخزون'}</small></span><span className="text-sm font-bold text-slate-500">{labels[count.state]}</span></button>)}{!counts.length ? <Empty /> : null}</div> : null}

    {active?.state === 'draft' ? <section className="space-y-5 rounded-2xl border bg-white p-5">
      <div className="rounded-xl bg-blue-50 p-3 text-sm font-bold text-blue-900">الجرد أعمى: الأرصدة وقائمة الوحدات المتوقعة مخفية حتى الإرسال.</div>
      {!draftLoaded ? <p className="text-sm font-bold text-slate-500">جاري استعادة المشاهدات المحفوظة…</p> : <>
        <div><h2 className="font-black">الموتوسيكلات الموجودة فعليًا</h2><p className="mt-1 text-sm text-slate-500">ابحث برقم الشاسيه أو الموتور أو رقم التتبع، ثم اختر الوحدة المطابقة.</p></div>
        <div className="flex gap-2"><input className="h-11 flex-1 rounded-xl border px-3" value={identityQuery} onChange={(event) => setIdentityQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchIdentity(); } }} placeholder="رقم الشاسيه / الموتور / التتبع" /><Button variant="secondary" disabled={identityBusy} onClick={searchIdentity}><Search className="h-4 w-4" />بحث</Button></div>
        {identityResult ? <IdentitySearchResult result={identityResult} countLocationId={active.location_id} onAdd={addObservation} /> : null}
        <div className="space-y-2">{serials.map((item, index) => <ObservedUnit key={`${item.identifier}:${index}`} item={item} onRemove={() => removeObservation(index)} />)}{!serials.length ? <p className="rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">لم تُسجل أي وحدة فعلية بعد.</p> : null}</div>
        {quantityProducts.length ? <div><h2 className="mb-3 font-black">المنتجات المحسوبة بالكمية</h2><div className="grid gap-3 md:grid-cols-2">{quantityProducts.map((product) => <label key={product.id} className="font-bold">{product.displayName || product.name}<span className="mr-1 text-red-600">مطلوب</span><input type="number" min="0" step="0.0001" className="mt-1 h-11 w-full rounded-lg border px-3" value={quantities[product.id] ?? ''} onChange={(event) => setQuantity(product.id, event.target.value)} placeholder="الكمية الموجودة فعليًا" /></label>)}</div></div> : null}
        <div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={busy || !draftLoaded || !dirty} onClick={save}>حفظ المشاهدات</Button><Button disabled={busy || !draftLoaded} onClick={submit}>إرسال وتجميد الجرد</Button>{dirty ? <span className="self-center text-xs font-bold text-amber-700">يوجد عمل غير محفوظ</span> : <span className="self-center text-xs text-emerald-700">كل المشاهدات محفوظة</span>}</div>
      </>}
    </section> : null}

    {active && active.state !== 'draft' ? <section className="space-y-4">
      <VarianceReviewTable variances={active.variances || []} decisions={decisions} onDecision={updateDecision} productsById={productsById} unitsById={unitsById} locationsById={locationsById} canAdjust={canAdjust} />
      {active.state === 'submitted' ? <div className="rounded-2xl border bg-white p-4">
        {unresolvedIdentities.length ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800"><AlertTriangle className="ml-2 inline h-4 w-4" />لا يمكن الترحيل وفي الجرد هوية غير معروفة. تحقق منها من مسار الاستلام/التبنّي Canonical، ثم ألغِ هذه الجلسة وأعد الجرد.</div> : null}
        {!permissionsLoading && !canAdjust ? <p className="rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-900">المراجعة متاحة للقراءة فقط. اعتماد التعديلات يحتاج صلاحية «تسوية المخزون».</p> : <>
          <label className="block font-bold">سبب الترحيل العام<input className="mt-2 h-11 w-full rounded-lg border px-3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثال: نتيجة الجرد الفيزيائي بتاريخ اليوم" /></label>
          <Button className="mt-3" disabled={busy || unresolvedIdentities.length > 0 || !decisionsComplete || !reason.trim()} onClick={requestPost}>مراجعة ملخص التغييرات</Button>
        </>}
      </div> : null}
      {confirming ? <ConfirmationSummary variances={reviewableVariances} decisions={decisions} onCancel={() => setConfirming(false)} onConfirm={post} busy={busy} /> : null}
      {postedResult ? <PostResult result={postedResult} /> : null}
    </section> : null}
  </div>;
}

function IdentitySearchResult({ result, countLocationId, onAdd }) {
  if (!result.units.length) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="font-black text-amber-900">هوية غير معروفة</p><p className="text-sm text-amber-800">لن يتم إنشاء وحدة جديدة تلقائيًا. يمكنك تسجيلها كدليل فعلي، وستتوقف التسوية حتى التحقق منها.</p><Button className="mt-2" variant="secondary" onClick={() => onAdd(null)}>تسجيلها كهوية غير معروفة</Button></div>;
  if (result.units.length > 1) return <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="font-black text-amber-900">أكثر من تطابق — اختر الوحدة الصحيحة بعد مراجعة الشاسيه والموتور</p>{result.units.map((unit) => <IdentityCandidate key={unit.id} unit={unit} countLocationId={countLocationId} onAdd={onAdd} />)}</div>;
  return <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3"><p className="mb-2 font-black text-emerald-900">تم العثور على وحدة مطابقة</p><IdentityCandidate unit={result.units[0]} countLocationId={countLocationId} onAdd={onAdd} /></div>;
}

function IdentityCandidate({ unit, countLocationId, onAdd }) {
  const conflict = unit.canonicalState !== 'available' || unit.currentLocationId !== countLocationId;
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white p-3"><div><strong>{unit.product?.displayName || unit.product?.name || 'منتج غير محدد'}</strong><p className="text-sm">شاسيه: {unit.chassisNumber || '—'} · موتور: {unit.engineNumber || '—'}</p><p className={`text-xs font-bold ${conflict ? 'text-red-700' : 'text-slate-500'}`}>{stateLabels[unit.canonicalState] || unit.canonicalState || 'غير معروف'} · {unit.currentBranchName || ''} {unit.currentLocationName || 'بدون موقع'}</p></div><Button size="sm" variant={conflict ? 'secondary' : 'default'} onClick={() => onAdd(unit)}>{conflict ? 'تسجيل مع تعارض' : 'إضافة للمشاهدات'}</Button></div>;
}

function ObservedUnit({ item, onRemove }) {
  const colors = { matched: 'border-emerald-200 bg-emerald-50', unknown: 'border-amber-200 bg-amber-50', ambiguous: 'border-amber-200 bg-amber-50', conflict: 'border-red-200 bg-red-50' };
  const status = { matched: 'مطابق', unknown: 'غير معروف', ambiguous: 'ملتبس', conflict: 'تعارض حالة/موقع' }[item.status] || item.status;
  return <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 ${colors[item.status] || ''}`}><div><strong>{item.unit?.product?.displayName || item.unit?.product?.name || item.identifier}</strong><p className="text-sm">{item.unit ? `شاسيه: ${item.unit.chassisNumber || '—'} · موتور: ${item.unit.engineNumber || '—'}` : item.identifier}</p><span className="text-xs font-bold">{status}</span></div><button type="button" aria-label="حذف المشاهدة" onClick={onRemove} className="rounded-lg p-2 text-red-700 hover:bg-red-100"><Trash2 className="h-4 w-4" /></button></div>;
}

function VarianceReviewTable({ variances, decisions, onDecision, productsById, unitsById, locationsById, canAdjust }) {
  return <div className="overflow-x-auto rounded-2xl border bg-white"><div className="border-b p-4"><h2 className="font-black">مراجعة الفروق المجمدة</h2><p className="text-sm text-slate-500">كل فرق يحتاج قرارًا وسببًا صريحًا. لا توجد موافقة جماعية تلقائية.</p></div><table className="min-w-full text-sm"><thead className="bg-slate-50 text-right"><tr><th className="p-3">المنتج والهوية</th><th className="p-3">المتوقع / الفعلي</th><th className="p-3">نوع الفرق</th><th className="p-3">الأثر المقترح</th><th className="p-3">قرار المراجع</th></tr></thead><tbody>{variances.map((variance) => {
    const product = productsById.get(variance.product_id); const unit = unitsById.get(variance.tracking_unit_id); const decision = decisions[variance.id] || {};
    const pending = variance.resolution_state === 'pending'; const unknown = variance.variance_type === 'identity_review';
    return <tr key={variance.id} className="border-t align-top"><td className="p-3"><strong>{product?.displayName || product?.name || 'منتج يحتاج تحديد'}</strong><p className="text-xs">شاسيه: {unit?.chassisNumber || '—'}<br />موتور: {unit?.engineNumber || '—'}</p></td><td className="p-3"><p>الحالة: {stateLabels[variance.observed_state] || variance.observed_state || '—'}</p><p>الموقع: {locationsById.get(variance.observed_location_id)?.name || '—'}</p><p>الكمية: {variance.expected_quantity ?? '—'} ← {variance.physical_quantity ?? '—'}</p></td><td className="p-3 font-bold">{varianceLabels[variance.variance_type] || variance.variance_type}</td><td className="p-3">{proposedEffect(variance)}</td><td className="min-w-64 p-3">{!pending ? <span className="font-bold text-emerald-700">{variance.resolution_state === 'adjusted' ? 'تم التعديل' : variance.resolution_state === 'ignored' ? 'تم التجاهل' : 'لا يحتاج تعديل'}</span> : unknown ? <span className="font-bold text-red-700">موقوف لحين التحقق — لا يمكن تجاهله من هنا</span> : canAdjust ? <div className="space-y-2"><select className="h-10 w-full rounded-lg border px-2" value={decision.action || ''} onChange={(event) => onDecision(variance.id, { action: event.target.value })}><option value="">اختر القرار</option>{adjustableTypes.has(variance.variance_type) ? <option value="adjust">اعتماد التعديل المقترح</option> : null}<option value="ignore">تجاهل الفرق</option></select><input className="h-10 w-full rounded-lg border px-2" value={decision.reason || ''} onChange={(event) => onDecision(variance.id, { reason: event.target.value })} placeholder="سبب القرار — مطلوب" /></div> : <span className="text-slate-500">بانتظار مدير مخول</span>}</td></tr>;
  })}</tbody></table>{!variances.length ? <p className="p-6 text-center text-slate-500">لا توجد فروق.</p> : null}</div>;
}

function ConfirmationSummary({ variances, decisions, onCancel, onConfirm, busy }) {
  const adjusted = variances.filter((item) => decisions[item.id]?.action === 'adjust');
  const ignored = variances.filter((item) => decisions[item.id]?.action === 'ignore');
  return <div className="rounded-2xl border-2 border-blue-300 bg-blue-50 p-5"><h2 className="text-lg font-black">تأكيد نهائي قبل تعديل المخزون</h2><p className="mt-1 text-sm">سيتم تطبيق {adjusted.length} تعديل، وتسجيل تجاهل {ignored.length} فرق. سيعيد backend فحص حالة المخزون والصلاحية لحظة الترحيل.</p><ul className="mt-3 list-inside list-disc text-sm">{variances.map((item) => <li key={item.id}>{varianceLabels[item.variance_type]}: {decisions[item.id].action === 'adjust' ? proposedEffect(item) : `تجاهل — ${decisions[item.id].reason}`}</li>)}</ul><div className="mt-4 flex gap-2"><Button disabled={busy} onClick={onConfirm}>تأكيد وترحيل التعديلات</Button><Button variant="secondary" disabled={busy} onClick={onCancel}>رجوع للمراجعة</Button></div></div>;
}

function PostResult({ result }) {
  return <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5"><CheckCircle2 className="h-7 w-7 text-emerald-700" /><h2 className="mt-2 font-black text-emerald-950">تم ترحيل نتيجة الجرد</h2><p className="mt-1 text-sm">مرجع التسوية: <code>{result.adjustment_id}</code></p><p className="text-sm">تعديلات: {result.decisions.filter((item) => item.action === 'adjust').length} · متجاهلة بقرار: {result.decisions.filter((item) => item.action === 'ignore').length}</p><Link className="mt-3 inline-block font-bold text-blue-700 underline" to="/apps/inventory/stock">العودة إلى أرصدة المخزون</Link></div>;
}

function Empty() { return <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-dashed bg-slate-50"><ClipboardCheck className="h-10 w-10 text-slate-300" /><p className="mt-3 font-black">لا توجد جلسات جرد بعد</p></div>; }
