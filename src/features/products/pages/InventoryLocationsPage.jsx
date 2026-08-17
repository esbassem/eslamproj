import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, MapPin, Pencil, Plus, Power, Warehouse } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { EmptyState } from '@/core/ui/empty-state';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetDismissButton,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { STOCK_LOCATION_TYPES, stockLocationsService } from '@/features/inventory/api/stockLocations.api';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const EMPTY_FORM = { name: '', code: '', branchId: '', locationType: 'internal' };

function LocationSheet({ open, location, branches, onOpenChange, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(location ? {
      name: location.name,
      code: location.code,
      branchId: location.branchId,
      locationType: location.locationType,
    } : { ...EMPTY_FORM, branchId: branches[0]?.id ?? '' });
    setError('');
    setSaving(false);
  }, [branches, location, open]);

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault();
    try {
      setSaving(true);
      setError('');
      await onSave(form);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError.message || 'تعذر حفظ الموقع.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl">
        <form className="flex h-full flex-col" onSubmit={submit}>
          <SheetHeader>
            <SheetTitle>{location ? 'تعديل موقع المخزون' : 'إضافة موقع مخزون'}</SheetTitle>
            <SheetDescription>الموقع يتبع فرعًا محددًا، ولا يُربط بأرصدة المخزون في هذه المرحلة.</SheetDescription>
            <SheetDismissButton />
          </SheetHeader>
          <SheetBody className="space-y-4">
            <label className="block space-y-1.5">
              <Label htmlFor="stock-location-name">اسم الموقع *</Label>
              <Input id="stock-location-name" value={form.name} onChange={set('name')} placeholder="مثال: المخزن الرئيسي" autoFocus />
            </label>
            <label className="block space-y-1.5">
              <Label htmlFor="stock-location-code">الكود *</Label>
              <Input id="stock-location-code" value={form.code} onChange={set('code')} placeholder="مثال: MAIN" dir="ltr" />
            </label>
            <label className="block space-y-1.5">
              <Label htmlFor="stock-location-branch">الفرع *</Label>
              <select id="stock-location-branch" value={form.branchId} onChange={set('branchId')} className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500">
                <option value="">اختر الفرع</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </label>
            <label className="block space-y-1.5">
              <Label htmlFor="stock-location-type">النوع *</Label>
              <select id="stock-location-type" value={form.locationType} onChange={set('locationType')} className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-blue-500">
                {STOCK_LOCATION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
              </select>
            </label>
            {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p> : null}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ الموقع'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function InventoryLocationsPage() {
  const { tenant, tenantUser } = useWorkspace();
  const tenantId = tenant?.id ?? null;
  const isOwner = tenantUser?.role === 'owner';
  const [locations, setLocations] = useState([]);
  const [branches, setBranches] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [processingId, setProcessingId] = useState(null);

  const load = useCallback(async () => {
    if (!tenantId) return;
    try {
      setStatus('loading');
      setError('');
      const [nextLocations, nextBranches] = await Promise.all([
        stockLocationsService.list(tenantId),
        stockLocationsService.listBranches(tenantId),
      ]);
      setLocations(nextLocations);
      setBranches(nextBranches);
      setStatus('ready');
    } catch (loadError) {
      setStatus('error');
      setError(loadError.message || 'تعذر تحميل مواقع المخزون.');
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const typeLabels = useMemo(() => new Map(STOCK_LOCATION_TYPES.map((type) => [type.value, type.label])), []);
  const save = async (values) => {
    if (editing) {
      await stockLocationsService.update(tenantId, editing.id, values);
      setNotice('تم تحديث موقع المخزون.');
    } else {
      await stockLocationsService.create(tenantId, values);
      setNotice('تمت إضافة موقع المخزون.');
    }
    setEditing(null);
    await load();
  };

  const toggle = async (location) => {
    try {
      setProcessingId(location.id);
      setError('');
      await stockLocationsService.setActive(tenantId, location.id, !location.isActive);
      setNotice(location.isActive ? 'تم تعطيل الموقع دون حذفه.' : 'تم تفعيل الموقع.');
      await load();
    } catch (toggleError) {
      setError(toggleError.message || 'تعذر تغيير حالة الموقع.');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-950">مواقع المخزون</h1>
          <p className="mt-1 text-sm font-semibold text-slate-500">تعريف المواقع التابعة للفروع. لم يتم ربط الأرصدة أو القطع بهذه المواقع بعد.</p>
        </div>
        {isOwner ? <Button onClick={() => { setEditing(null); setSheetOpen(true); }} className="gap-2" disabled={!branches.length}><Plus className="h-4 w-4" />إضافة موقع</Button> : null}
      </header>

      {!isOwner ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-semibold text-blue-800">يمكنك عرض المواقع فقط. الإدارة متاحة لمالك الشركة.</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
      {status === 'loading' ? <LoadingSpinner title="جاري تحميل مواقع المخزون" /> : null}
      {status === 'ready' && !locations.length ? <EmptyState icon={Warehouse} title="لا توجد مواقع مخزون" description="أضف موقعًا داخل أحد الفروع للبدء." surface="plain" /> : null}

      {locations.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {locations.map((location) => (
            <article key={location.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-black text-slate-950">{location.name}</h2>
                  <p className="mt-1 text-xs font-bold text-slate-400" dir="ltr">{location.code}</p>
                </div>
                <Badge variant={location.isActive ? 'success' : 'default'}>{location.isActive ? 'نشط' : 'غير نشط'}</Badge>
              </div>
              <div className="mt-4 space-y-2 text-sm font-semibold text-slate-600">
                <p className="flex items-center gap-2"><Building2 className="h-4 w-4 text-slate-400" />{location.branchName || 'فرع غير محدد'}</p>
                <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-slate-400" />{typeLabels.get(location.locationType) || location.locationType}</p>
              </div>
              {isOwner ? (
                <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                  <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => { setEditing(location); setSheetOpen(true); }}><Pencil className="h-3.5 w-3.5" />تعديل</Button>
                  <Button variant="secondary" size="sm" className="gap-1.5" disabled={processingId === location.id} onClick={() => toggle(location)}><Power className="h-3.5 w-3.5" />{location.isActive ? 'تعطيل' : 'تفعيل'}</Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {isOwner ? <LocationSheet open={sheetOpen} location={editing} branches={branches} onOpenChange={(next) => { setSheetOpen(next); if (!next) setEditing(null); }} onSave={save} /> : null}
    </div>
  );
}
