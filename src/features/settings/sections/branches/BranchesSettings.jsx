import { useCallback, useEffect, useState } from 'react';
import { Building2, MapPin, Pencil, Phone, Plus, Power } from 'lucide-react';
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
import { branchesService } from '@/features/settings/sections/branches/branches.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const EMPTY_FORM = { name: '', code: '', address: '', phone: '' };

function BranchSheet({ open, branch, onOpenChange, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setForm(branch ? {
      name: branch.name,
      code: branch.code,
      address: branch.address,
      phone: branch.phone,
    } : EMPTY_FORM);
    setError('');
    setSaving(false);
  }, [branch, open]);

  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError('اسم الفرع مطلوب.');
      return;
    }

    try {
      setSaving(true);
      setError('');
      await onSave(form);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError.message || 'تعذر حفظ الفرع.');
    } finally {
      setSaving(false);
    }
  };

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl">
        <form className="flex h-full flex-col" onSubmit={submit}>
          <SheetHeader>
            <SheetTitle>{branch ? 'تعديل الفرع' : 'إضافة فرع'}</SheetTitle>
            <SheetDescription>تعريف بيانات الفرع داخل الشركة الحالية دون ربطه بالمخزون.</SheetDescription>
            <SheetDismissButton />
          </SheetHeader>
          <SheetBody className="space-y-4">
            <label className="block space-y-1.5">
              <Label htmlFor="branch-name">اسم الفرع *</Label>
              <Input id="branch-name" value={form.name} onChange={set('name')} placeholder="مثال: الفرع الرئيسي" autoFocus />
            </label>
            <label className="block space-y-1.5">
              <Label htmlFor="branch-code">كود الفرع</Label>
              <Input id="branch-code" value={form.code} onChange={set('code')} placeholder="اختياري" dir="ltr" />
            </label>
            <label className="block space-y-1.5">
              <Label htmlFor="branch-address">العنوان</Label>
              <Input id="branch-address" value={form.address} onChange={set('address')} placeholder="اختياري" />
            </label>
            <label className="block space-y-1.5">
              <Label htmlFor="branch-phone">الهاتف</Label>
              <Input id="branch-phone" value={form.phone} onChange={set('phone')} placeholder="اختياري" dir="ltr" />
            </label>
            {error ? <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error}</p> : null}
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>إلغاء</Button>
            <Button type="submit" disabled={saving}>{saving ? 'جاري الحفظ...' : 'حفظ الفرع'}</Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

export function BranchesSettings() {
  const { tenant, tenantUser } = useWorkspace();
  const tenantId = tenant?.id ?? null;
  const isOwner = tenantUser?.role === 'owner';
  const [branches, setBranches] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [processingId, setProcessingId] = useState(null);

  const load = useCallback(async () => {
    if (!tenantId || !isOwner) return;
    try {
      setStatus('loading');
      setError('');
      setBranches(await branchesService.list(tenantId));
      setStatus('ready');
    } catch (loadError) {
      setStatus('error');
      setError(loadError.message || 'تعذر تحميل الفروع.');
    }
  }, [isOwner, tenantId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!isOwner) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">إدارة الفروع متاحة لمالك الشركة فقط.</div>;
  }

  const save = async (values) => {
    if (editing) {
      await branchesService.update(tenantId, editing.id, values);
      setNotice('تم تحديث بيانات الفرع.');
    } else {
      await branchesService.create(tenantId, values);
      setNotice('تمت إضافة الفرع.');
    }
    setEditing(null);
    await load();
  };

  const toggle = async (branch) => {
    try {
      setProcessingId(branch.id);
      setError('');
      await branchesService.setActive(tenantId, branch.id, !branch.isActive);
      setNotice(branch.isActive ? 'تم تعطيل الفرع مع الاحتفاظ ببياناته.' : 'تم تفعيل الفرع.');
      await load();
    } catch (toggleError) {
      setError(toggleError.message || 'تعذر تغيير حالة الفرع.');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-5" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-950">الفروع</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">تعريف فروع الشركة وتفعيلها أو إيقاف استخدامها دون حذف البيانات التاريخية.</p>
        </div>
        <Button onClick={() => { setEditing(null); setSheetOpen(true); }} className="gap-2"><Plus className="h-4 w-4" />إضافة فرع</Button>
      </div>

      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700">{notice}</div> : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}
      {status === 'loading' ? <LoadingSpinner title="جاري تحميل الفروع" /> : null}
      {status === 'ready' && !branches.length ? <EmptyState icon={Building2} title="لا توجد فروع" description="أضف أول فرع للشركة لبدء استخدامه في الإعدادات والعمليات التي تدعم الفروع." surface="plain" /> : null}

      {branches.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {branches.map((branch) => (
            <article key={branch.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0"><h3 className="truncate font-black text-slate-950">{branch.name}</h3><p className="mt-1 text-xs font-bold text-slate-400" dir="ltr">{branch.code || 'بدون كود'}</p></div>
                <Badge variant={branch.isActive ? 'success' : 'default'}>{branch.isActive ? 'نشط' : 'غير نشط'}</Badge>
              </div>
              <div className="mt-4 space-y-2 text-sm font-semibold text-slate-600">
                <p className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span>{branch.address || 'لا يوجد عنوان'}</span></p>
                <p className="flex gap-2"><Phone className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" /><span dir="ltr">{branch.phone || 'لا يوجد هاتف'}</span></p>
              </div>
              <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => { setEditing(branch); setSheetOpen(true); }}><Pencil className="h-3.5 w-3.5" />تعديل</Button>
                <Button variant="secondary" size="sm" className="gap-1.5" disabled={processingId === branch.id} onClick={() => toggle(branch)}><Power className="h-3.5 w-3.5" />{branch.isActive ? 'تعطيل' : 'تفعيل'}</Button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <BranchSheet open={sheetOpen} branch={editing} onOpenChange={(next) => { setSheetOpen(next); if (!next) setEditing(null); }} onSave={save} />
    </div>
  );
}
