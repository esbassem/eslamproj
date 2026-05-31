import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, ImagePlus, Link2Off, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { QuickImageUploadSheet } from '@/features/dashboard/components/QuickImageUploadSheet';
import { PhotosEmptyState } from '@/features/photos/components/PhotosEmptyState';
import { listUnlinkedTenantPhotos } from '@/features/photos/services/photosStorage.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function formatDate(value) {
  if (!value) return 'بدون تاريخ';
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function PhotosUnlinkedPage() {
  const { tenant } = useWorkspace();
  const [photos, setPhotos] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isUploadOpen, setIsUploadOpen] = useState(false);

  const loadPhotos = useCallback(async () => {
    if (!tenant?.id) {
      setPhotos([]);
      setStatus('idle');
      setError('');
      return;
    }

    setStatus('loading');
    setError('');
    setNotice('');

    try {
      const nextPhotos = await listUnlinkedTenantPhotos({ tenantId: tenant.id });
      setPhotos(nextPhotos);
      setStatus('ready');
    } catch (loadError) {
      setPhotos([]);
      setStatus('error');
      setError(loadError.message || 'تعذر تحميل الصور غير المرتبطة.');
    }
  }, [tenant?.id]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const handleUploaded = async () => {
    await loadPhotos();
    setNotice('تم رفع الصورة وتحديث قائمة الصور غير المرتبطة.');
  };

  return (
    <section className="space-y-6 text-right" dir="rtl">
      <div className="rounded-[26px] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_-54px_rgba(15,23,42,0.42)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-slate-400">Unlinked Photos</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">الصور غير المرتبطة</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setIsUploadOpen(true)}
              disabled={!tenant?.id}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white shadow-[0_18px_32px_-24px_rgba(15,23,42,0.9)] transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ImagePlus className="h-4 w-4" />
              صورة جديدة
            </button>
            <button
              type="button"
              onClick={loadPhotos}
              disabled={status === 'loading'}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
              تحديث
            </button>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
              <Link2Off className="h-7 w-7" />
            </div>
          </div>
        </div>
      </div>

      {status === 'loading' ? (
        <div className="rounded-[24px] border border-slate-200 bg-white py-16 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.35)]">
          <LoadingSpinner title="جاري تحميل الصور غير المرتبطة" />
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-black text-red-700">
          {error}
        </div>
      ) : null}

      {notice ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-black text-emerald-700">
          {notice}
        </div>
      ) : null}

      {status === 'ready' && photos.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {photos.map((photo) => (
            <article
              key={photo.id}
              className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-[0_22px_54px_-44px_rgba(15,23,42,0.42)]"
            >
              <div className="relative aspect-[4/3] bg-slate-100">
                {photo.signedUrl ? (
                  <img src={photo.signedUrl} alt={photo.name} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-black text-slate-400">
                    لا توجد معاينة
                  </div>
                )}
              </div>
              <div className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-black text-slate-950">{photo.name}</h2>
                    <p className="mt-1 text-xs font-bold text-slate-500">{photo.typeLabel}</p>
                  </div>
                  {photo.signedUrl ? (
                    <a
                      href={photo.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-950 hover:text-white"
                      aria-label="فتح الصورة"
                      title="فتح الصورة"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
                  <span className="block text-[10px] font-black text-slate-400">تاريخ الرفع</span>
                  {formatDate(photo.createdAt)}
                </div>
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-left font-mono text-[11px] font-bold text-slate-500" dir="ltr">
                  {photo.path}
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {status === 'ready' && !photos.length ? (
        <PhotosEmptyState
          tone="unlinked"
          title="لا توجد صور غير مرتبطة"
          description="كل الصور الموجودة في Storage لديها file_path مطابق داخل ir_attachments."
        />
      ) : null}

      <QuickImageUploadSheet
        open={isUploadOpen}
        onOpenChange={setIsUploadOpen}
        tenantId={tenant?.id}
        onUploaded={handleUploaded}
      />
    </section>
  );
}
