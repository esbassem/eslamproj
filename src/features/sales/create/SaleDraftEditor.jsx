import { AlertCircle, CheckCircle2, RefreshCcw, Save } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { SaleCustomerSelector } from '@/features/sales/create/SaleCustomerSelector';
import { SaleItemsSection } from '@/features/sales/create/SaleItemsSection';
import { SaleTotals } from '@/features/sales/create/SaleTotals';
import { useSaleDraft } from '@/features/sales/hooks/useSaleDraft';

export function SaleDraftEditor({ tenantId, initialSale = null, canBackdate = false, readOnly = false, onSaved, onReload }) {
  const draft = useSaleDraft({ tenantId, initialSale, onSaved });
  const stockLines = draft.form.lines.some((line) => line.product.productType === 'goods');

  if (draft.status === 'loading') return <div role="status" className="space-y-3"><div className="h-16 animate-pulse rounded-xl bg-slate-100" /><div className="h-40 animate-pulse rounded-xl bg-slate-100" /><div className="h-48 animate-pulse rounded-xl bg-slate-100" /></div>;
  if (draft.status === 'error') return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center"><AlertCircle className="mx-auto h-8 w-8 text-red-600" /><p className="mt-3 font-black text-red-900">{draft.error}</p><Button className="mt-4" variant="secondary" onClick={draft.retryOptions}><RefreshCcw className="h-4 w-4" />إعادة المحاولة</Button></div>;
  if (!draft.options.branches.length) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center font-bold text-amber-900">لا يوجد فرع نشط ومسموح يمكنك إنشاء البيع عليه. راجع نطاق الفروع مع المسؤول.</div>;

  return (
    <div className="space-y-7">
      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2">
        <label className="text-sm font-bold text-slate-700">الفرع<select disabled={readOnly || draft.options.branches.length === 1} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3" value={draft.form.branchId} onChange={(event) => draft.setBranch(event.target.value)}><option value="">اختر الفرع</option>{draft.options.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
        <label className="text-sm font-bold text-slate-700">تاريخ البيع{canBackdate ? <Input disabled={readOnly} className="mt-1 text-left" dir="ltr" type="date" max={new Date().toISOString().slice(0, 10)} value={draft.form.effectiveSaleDate} onChange={(event) => draft.setField('effectiveSaleDate', event.target.value)} /> : <div className="mt-1 flex h-11 items-center rounded-xl border border-slate-200 bg-white px-3">{draft.form.effectiveSaleDate}</div>}</label>
        {stockLines || draft.branchLocations.length ? <label className="text-sm font-bold text-slate-700 md:col-span-2">موقع المخزون الواحد<select disabled={readOnly || !draft.form.branchId || draft.branchLocations.length === 1} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3" value={draft.form.locationId} onChange={(event) => draft.setLocation(event.target.value)}><option value="">اختر موقع المخزون</option>{draft.branchLocations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.code ? ` — ${location.code}` : ''}</option>)}</select>{!draft.branchLocations.length && draft.form.branchId ? <small className="mt-1 block text-amber-700">لا يوجد موقع مخزون نشط ومسموح لهذا الفرع. ما زال يمكن حفظ بيع خدمات فقط.</small> : <small className="mt-1 block text-slate-500">يُستخدم نفس الموقع لجميع البنود المخزنية وفق قيد Sales Core الحالي.</small>}</label> : null}
      </section>

      <section className="space-y-3"><div><h2 className="text-lg font-black">العميل</h2><p className="mt-1 text-sm text-slate-500">ابحث بالاسم أو الهاتف. إدارة العملاء تبقى داخل Contacts.</p></div><SaleCustomerSelector tenantId={tenantId} value={draft.form.customer} disabled={readOnly} onChange={(customer) => draft.setField('customer', customer)} /></section>

      <SaleItemsSection tenantId={tenantId} branchId={draft.form.branchId} locationId={draft.form.locationId} lines={draft.form.lines} disabled={readOnly} onAdd={draft.addProduct} onUpdate={draft.updateLine} onRemove={draft.removeLine} />

      <label className="block text-sm font-bold text-slate-700">ملاحظات<textarea disabled={readOnly} className="mt-1 min-h-24 w-full rounded-xl border border-slate-200 bg-white p-3 outline-none focus:ring-4 focus:ring-slate-100" maxLength={4000} value={draft.form.notes} onChange={(event) => draft.setField('notes', event.target.value)} placeholder="ملاحظات اختيارية على المسودة" /><small className="text-slate-400">{draft.form.notes.length} / 4000</small></label>
      <SaleTotals lines={draft.form.lines} total={draft.total} currencyCode={draft.form.currencyCode} />

      {draft.readiness ? <div className="rounded-xl bg-blue-50 p-4 text-sm text-blue-900"><b>حالة المسودة:</b> {draft.readiness.ready ? 'البيانات التجارية جاهزة، وسيتم التحقق النهائي من المخزون عند التأكيد.' : 'تم الحفظ، وما زالت هناك بيانات مطلوبة قبل التأكيد.'}</div> : null}
      {draft.success ? <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 font-bold text-emerald-800"><CheckCircle2 className="h-5 w-5" />{draft.success}</p> : null}
      {draft.error ? <div role="alert" className="rounded-xl bg-red-50 p-4 font-bold text-red-800"><p>{draft.error}</p>{draft.error.includes('مستخدم آخر') && onReload ? <Button className="mt-3" size="sm" variant="secondary" onClick={onReload}><RefreshCcw className="h-4 w-4" />إعادة تحميل المسودة</Button> : null}</div> : null}

      {!readOnly ? <div className="sticky bottom-3 z-10 flex justify-end rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur"><Button disabled={draft.saving} onClick={draft.save}><Save className="h-4 w-4" />{draft.saving ? 'جاري حفظ المسودة...' : initialSale?.id ? 'حفظ التعديلات' : 'حفظ المسودة'}</Button></div> : <p className="rounded-xl bg-slate-100 p-4 text-sm font-bold text-slate-700">المسودة للعرض فقط لأن صلاحية التعديل غير متاحة.</p>}
    </div>
  );
}
