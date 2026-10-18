import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Copy, ExternalLink, History, Image as ImageIcon, MapPin } from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { PageHeader } from '@/core/ui/page-header';
import { getCanonicalBreadcrumbs } from '@/core/navigation/platformNavigation';
import { inventoryService } from '@/features/inventory/api/inventory.api';

const PAGE_SIZE = 25;
const STATE_LABELS = {
  available: 'متاحة', reserved: 'محجوزة', issued: 'تم تسليمها', blocked: 'موقوفة',
};
const EVENT_LABELS = {
  received: 'استلام', transferred: 'تحويل', reserved: 'حجز', reservation_released: 'تحرير حجز',
  delivered: 'تسليم', returned: 'مرتجع', return_review_released: 'اعتماد مرتجع',
  adjustment_posted: 'تسوية جرد', adjustment_reversed: 'عكس تسوية', opening_adopted: 'رصيد افتتاحي',
  receipt_corrected: 'تصحيح استلام', delivery_corrected: 'تصحيح تسليم', return_corrected: 'تصحيح مرتجع',
  receive: 'استلام قديم', transfer: 'تحويل قديم', adjustment: 'تسوية قديمة',
  in: 'إضافة مخزون', out: 'صرف مخزون', return: 'مرتجع قديم',
};

export function SerialUnitDetailsPage() {
  const { unitId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ data: null, loading: true, error: '', code: '' });
  const rawReturnTo = searchParams.get('returnTo');
  const returnTo = rawReturnTo?.startsWith('/apps/inventory/unique-units')
    ? rawReturnTo : '/apps/inventory/unique-units';

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '', code: '' }));
    try {
      const data = await inventoryService.getSerialUnitDetails({
        trackingUnitId: unitId, timelinePage: page, timelinePageSize: PAGE_SIZE,
      });
      setState({ data, loading: false, error: '', code: '' });
    } catch (error) {
      setState({ data: null, loading: false, error: error.message || 'تعذر تحميل تفاصيل الوحدة.', code: error.code || '' });
    }
  }, [page, unitId]);

  useEffect(() => { load(); }, [load]);
  const data = state.data;
  const unit = data?.unit;
  const product = data?.product;
  const pageCount = Math.max(1, Math.ceil((data?.timelineTotal ?? 0) / PAGE_SIZE));
  const breadcrumbs = useMemo(() => getCanonicalBreadcrumbs('/apps/inventory/unique-units/x', {
    currentLabel: unit?.trackingNumber || 'تفاصيل الوحدة',
  }), [unit?.trackingNumber]);

  if (state.loading && !data) return <LoadingSpinner title="جاري تحميل تفاصيل الوحدة" />;
  if (state.error) return <div className="space-y-5" dir="rtl">
    <PageHeader title="تفاصيل الوحدة" breadcrumbs={breadcrumbs} />
    <EmptyState title={state.code === 'denied' ? 'غير مصرح بعرض الوحدة' : state.code === 'not_found' ? 'الوحدة غير موجودة' : 'تعذر تحميل الوحدة'} description={state.error}>
      <Button onClick={() => navigate(returnTo)}><ArrowRight className="h-4 w-4" />العودة إلى الوحدات</Button>
      {!['denied', 'not_found'].includes(state.code) ? <Button variant="secondary" onClick={load}>إعادة المحاولة</Button> : null}
    </EmptyState>
  </div>;

  return <div className="space-y-6" dir="rtl">
    <PageHeader
      title={unit?.trackingNumber || 'تفاصيل الوحدة'}
      description={product?.display_name || product?.template_name || 'وحدة متسلسلة'}
      breadcrumbs={breadcrumbs}
      actions={<div className="flex gap-2"><Button variant="secondary" onClick={() => navigate(returnTo)}><ArrowRight className="h-4 w-4" />رجوع</Button><Button variant="secondary" onClick={async () => navigator.clipboard.writeText(window.location.href)}><Copy className="h-4 w-4" />نسخ الرابط</Button></div>}
    />

    <section className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-black">معلومات الوحدة</h2><Badge variant={unit?.canonicalState === 'available' ? 'success' : unit?.canonicalState === 'reserved' ? 'warning' : 'default'}>{STATE_LABELS[unit?.canonicalState] || unit?.canonicalState || 'غير محددة'}</Badge></div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Detail label="المنتج" value={product?.display_name || product?.template_name} />
          <Detail label="التصنيف" value={product?.category_name} />
          <Detail label="رقم التتبع الرئيسي" value={(data?.identifiers ?? []).find((item) => item.is_primary)?.value || unit?.trackingNumber} ltr />
          <Detail label="الفرع الحالي" value={unit?.currentBranchName || (unit?.canonicalState === 'issued' ? 'خارج المخزون' : '-')} />
          <Detail label="الموقع الحالي" value={unit?.currentLocationName || (unit?.canonicalState === 'issued' ? 'تم التسليم' : '-')} />
          <Detail label="حالة البيانات" value={unit?.dataStatus === 'complete' ? 'مكتملة' : unit?.dataStatus} />
        </div>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-black">الموقع الفعلي</h2><div className="mt-5 flex items-start gap-3"><MapPin className="mt-0.5 h-5 w-5 text-slate-400" /><div><p className="font-black">{unit?.currentLocationName || 'لا يوجد موقع حالي'}</p><p className="mt-1 text-sm text-slate-500">{unit?.currentBranchName || 'الوحدة خارج الرصيد المتاح حاليًا'}</p></div></div></div>
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <DetailsBlock title="هويات التتبع" rows={data?.identifiers} />
      <DetailsBlock title="الخصائص" rows={data?.attributes} />
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="font-black">صور الوحدة</h2>
      {(data?.attachments ?? []).length ? <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{data.attachments.map((attachment) => <div key={attachment.id} className="overflow-hidden rounded-xl border border-slate-200">
        {attachment.url && attachment.mime_type?.startsWith('image/') ? <img src={attachment.url} alt={attachment.document_type || 'صورة الوحدة'} className="h-40 w-full object-cover" loading="lazy" /> : <div className="flex h-40 items-center justify-center bg-slate-50"><ImageIcon className="h-10 w-10 text-slate-300" /></div>}
        <div className="space-y-2 p-3"><p className="truncate text-sm font-black">{attachment.document_type || 'صورة'}</p><p className="truncate text-xs text-slate-500">{attachment.original_file_name || '-'}</p>{attachment.url ? <a href={attachment.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-bold text-blue-700">عرض الصورة <ExternalLink className="h-3.5 w-3.5" /></a> : <p className="text-xs font-bold text-red-600">تعذر إنشاء رابط العرض</p>}</div>
      </div>)}</div> : <EmptyInline icon={ImageIcon} text="لا توجد صور مرتبطة بهذه الوحدة." />}
    </section>

    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3"><div><h2 className="font-black">سجل الوحدة</h2><p className="mt-1 text-sm text-slate-500">الأحداث والحركات المسجلة فعليًا، من الأحدث إلى الأقدم.</p></div><History className="h-5 w-5 text-slate-400" /></div>
      {(data?.timeline ?? []).length ? <div className="mt-5 space-y-0">{data.timeline.map((event, index) => <TimelineItem key={`${event.record_source}-${event.id}`} event={event} last={index === data.timeline.length - 1} />)}</div> : <EmptyInline icon={History} text="لا توجد حركات إضافية مسجلة لهذه الوحدة." />}
      {pageCount > 1 ? <div className="mt-5 flex items-center justify-between border-t border-slate-100 pt-4 text-sm font-bold"><span>{Number(data.timelineTotal).toLocaleString('ar-EG')} حركة</span><div className="flex items-center gap-2"><Button size="sm" variant="secondary" disabled={page <= 1 || state.loading} onClick={() => setPage((value) => value - 1)}><ChevronRight className="h-4 w-4" /></Button><span>{page} / {pageCount}</span><Button size="sm" variant="secondary" disabled={page >= pageCount || state.loading} onClick={() => setPage((value) => value + 1)}><ChevronLeft className="h-4 w-4" /></Button></div></div> : null}
    </section>
  </div>;
}

function TimelineItem({ event, last }) {
  const from = event.from_location_name;
  const to = event.to_location_name;
  return <div className="relative flex gap-4"><div className="flex flex-col items-center"><span className="mt-1 h-3 w-3 rounded-full bg-slate-900" />{!last ? <span className="min-h-20 w-px flex-1 bg-slate-200" /> : null}</div><div className="min-w-0 flex-1 pb-6"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-black">{EVENT_LABELS[event.event_type] || event.event_type}</p><p className="mt-1 text-sm text-slate-500">{from || to ? `${from || 'موقع غير متاح'} ← ${to || 'موقع غير متاح'}` : 'لا توجد بيانات موقع لهذا الحدث'}</p></div><time className="text-xs font-bold text-slate-500">{event.occurred_at ? new Date(event.occurred_at).toLocaleString('ar-EG') : '-'}</time></div><div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500"><span>المرجع: {event.source_id || '-'}</span><span>المصدر: {event.source_type || event.record_source}</span>{event.route_path ? <Link to={event.route_path} className="font-bold text-blue-700">فتح العملية</Link> : null}</div></div></div>;
}
function DetailsBlock({ title, rows = [] }) { return <section className="rounded-xl border border-slate-200 bg-white p-5"><h2 className="font-black">{title}</h2><div className="mt-3 divide-y divide-slate-100">{rows?.length ? rows.map((row) => <div key={`${row.id}-${row.value}`} className="flex justify-between gap-4 py-3 text-sm"><span className="font-bold text-slate-500">{row.name}{row.is_primary ? ' (رئيسي)' : ''}</span><span className="break-all text-left font-black" dir="auto">{row.is_not_available ? 'غير متاح' : row.value || '-'}</span></div>) : <p className="py-4 text-sm text-slate-500">لا توجد بيانات مسجلة.</p>}</div></section>; }
function Detail({ label, value, ltr }) { return <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 break-words font-black" dir={ltr ? 'ltr' : undefined}>{value || '-'}</p></div>; }
function EmptyInline({ icon: Icon, text }) { return <div className="mt-4 flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 text-center"><Icon className="h-8 w-8 text-slate-300" /><p className="mt-2 text-sm font-bold text-slate-500">{text}</p></div>; }
function EmptyState({ title, description, children }) { return <div className="flex min-h-72 flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-6 text-center"><h2 className="text-lg font-black">{title}</h2><p className="mt-2 max-w-lg text-sm text-slate-500">{description}</p><div className="mt-5 flex gap-2">{children}</div></div>; }
