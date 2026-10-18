import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { PageHeader } from '@/core/ui/page-header';
import { getCanonicalBreadcrumbs } from '@/core/navigation/platformNavigation';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { inventoryService } from '@/features/inventory/api/inventory.api';

export function InventoryReturnReviewsPage() {
  const { can, isReady: authorizationReady } = useAuthorization();
  const canRelease = authorizationReady && can('inventory.return_review_release');
  const [reviews, setReviews] = useState([]);
  const [reasons, setReasons] = useState({});
  const [loading, setLoading] = useState(false);
  const [releasingId, setReleasingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const releaseAttempts = useRef({});

  const reload = async () => {
    if (!canRelease) { setReviews([]); return; }
    setLoading(true); setError('');
    try { setReviews(await inventoryService.listPendingInventoryReturnReviews()); }
    catch (nextError) { setError(nextError.message || 'تعذر تحميل المرتجعات المعلقة.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { void reload(); }, [canRelease]); // eslint-disable-line react-hooks/exhaustive-deps

  const release = async (review) => {
    const reason = reasons[review.review_id]?.trim();
    if (!canRelease || !reason) return;
    if (!window.confirm('بعد المراجعة الفعلية ستصبح الوحدة متاحة في موقعها الحالي. هل تريد المتابعة؟')) return;
    setReleasingId(review.review_id); setError(''); setNotice('');
    try {
      const fingerprint = `${review.tracking_unit_id}:${reason}`;
      const previous = releaseAttempts.current[review.review_id];
      const attempt = previous?.fingerprint === fingerprint
        ? previous
        : { fingerprint, idempotencyKey: `return-review-release:${crypto.randomUUID()}` };
      releaseAttempts.current[review.review_id] = attempt;
      await inventoryService.releaseReturnedInventoryUnit({
        trackingUnitId: review.tracking_unit_id,
        reason,
        idempotencyKey: attempt.idempotencyKey,
      });
      delete releaseAttempts.current[review.review_id];
      setNotice(`تمت مراجعة وإتاحة الوحدة ${review.tracking_number}.`);
      await reload();
    } catch (nextError) {
      setError(nextError.message || 'تعذر إتاحة الوحدة المرتجعة.');
    } finally { setReleasingId(''); }
  };

  if (!authorizationReady) return <LoadingSpinner title="جاري التحقق من صلاحيات مراجعة المرتجعات" />;
  if (!canRelease) {
    return <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm font-bold text-amber-900" dir="rtl">ليست لديك صلاحية مراجعة وإتاحة الوحدات المرتجعة.</div>;
  }

  return <div className="space-y-5" dir="rtl">
    <PageHeader title="مراجعة المرتجعات" description="وحدات متسلسلة مرتجعة وموقوفة لحين المراجعة الفعلية." breadcrumbs={getCanonicalBreadcrumbs('/apps/inventory/operations/returns')} />
    {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">{error}</div> : null}
    {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{notice}</div> : null}
    {loading ? <LoadingSpinner title="جاري تحميل المرتجعات" /> : <div className="space-y-3">
      {reviews.map((review) => <article key={review.review_id} className="rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-black">{review.product_name}</h2><p className="mt-1 text-sm">رقم التتبع: <b dir="ltr">{review.tracking_number}</b></p><p className="text-sm">شاسيه: {review.chassis_number || '—'} · موتور: {review.engine_number || '—'}</p><p className="mt-1 text-xs font-bold text-slate-500">{review.branch_name} — {review.location_name} · الحالة: مرتجع موقوف</p></div><RotateCcw className="h-6 w-6 text-amber-600" /></div>
        <label className="mt-4 block text-sm font-bold">نتيجة المراجعة وسبب الإتاحة<input className="mt-2 h-11 w-full rounded-lg border px-3" value={reasons[review.review_id] || ''} onChange={(event) => setReasons((current) => ({ ...current, [review.review_id]: event.target.value }))} placeholder="مثال: تمت معاينة الوحدة وتأكدت سلامتها" maxLength={1000} /></label>
        <Button className="mt-3 gap-2" disabled={releasingId === review.review_id || !reasons[review.review_id]?.trim()} onClick={() => release(review)}><CheckCircle2 className="h-4 w-4" />مراجعة وإتاحة الوحدة</Button>
      </article>)}
      {!reviews.length ? <div className="rounded-2xl border border-dashed bg-slate-50 p-10 text-center font-bold text-slate-500">لا توجد وحدات مرتجعة معلقة داخل نطاق مواقعك.</div> : null}
    </div>}
  </div>;
}
