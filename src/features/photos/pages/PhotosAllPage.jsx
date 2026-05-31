import { useCallback, useEffect, useState } from 'react';
import { Check, ExternalLink, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { QuickImageUploadSheet } from '@/features/dashboard/components/QuickImageUploadSheet';
import { PhotosEmptyState } from '@/features/photos/components/PhotosEmptyState';
import { deleteTenantPhotos, listTenantPhotos } from '@/features/photos/services/photosStorage.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function formatFileSize(size) {
  if (!size) return 'غير معروف';
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value) {
  if (!value) return 'بدون تاريخ';
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function PhotosAllPage() {
  const { tenant } = useWorkspace();
  const [photos, setPhotos] = useState([]);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');
  const [selectedPhotoIds, setSelectedPhotoIds] = useState([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [notice, setNotice] = useState('');

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
      const nextPhotos = await listTenantPhotos({ tenantId: tenant.id });
      setPhotos(nextPhotos);
      setSelectedPhotoIds((current) => current.filter((id) => nextPhotos.some((photo) => photo.id === id)));
      setStatus('ready');
    } catch (loadError) {
      setPhotos([]);
      setStatus('error');
      setError(loadError.message || 'تعذر تحميل الصور.');
    }
  }, [tenant?.id]);

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  const selectedPhotos = photos.filter((photo) => selectedPhotoIds.includes(photo.id));
  const allSelected = photos.length > 0 && selectedPhotoIds.length === photos.length;

  const togglePhotoSelection = (photoId) => {
    setNotice('');
    setSelectedPhotoIds((current) =>
      current.includes(photoId) ? current.filter((id) => id !== photoId) : [...current, photoId],
    );
  };

  const toggleSelectAll = () => {
    setNotice('');
    setSelectedPhotoIds(allSelected ? [] : photos.map((photo) => photo.id));
  };

  const handleDeleteSelected = async () => {
    if (!selectedPhotos.length || isDeleting) {
      return;
    }

    const isConfirmed = window.confirm(`تأكيد حذف ${selectedPhotos.length} صورة من Storage؟ لا يمكن التراجع عن هذه العملية.`);

    if (!isConfirmed) {
      return;
    }

    setIsDeleting(true);
    setError('');
    setNotice('');

    try {
      await deleteTenantPhotos({ paths: selectedPhotos.map((photo) => photo.path) });
      setSelectedPhotoIds([]);
      await loadPhotos();
      setNotice('تم حذف الصور المحددة بنجاح.');
    } catch (deleteError) {
      setError(deleteError.message || 'تعذر حذف الصور المحددة.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUploaded = async () => {
    await loadPhotos();
    setNotice('تم رفع الصورة وتحديث القائمة.');
  };

  return (
    <section className="space-y-6 text-right" dir="rtl">
      <div className="rounded-[26px] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_100%)] p-6 shadow-[0_24px_70px_-54px_rgba(15,23,42,0.42)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-4">
            <div>
              <p className="text-xs font-black uppercase tracking-wide text-slate-400">Photos</p>
              <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">جميع الصور</h1>
            </div>
            {status === 'ready' && photos.length ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  disabled={isDeleting}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label={allSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                  title={allSelected ? 'إلغاء تحديد الكل' : 'تحديد الكل'}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-md border ${allSelected ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-300 bg-white text-transparent'}`}>
                    <Check className="h-3.5 w-3.5" />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleDeleteSelected}
                  disabled={!selectedPhotoIds.length || isDeleting}
                  className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 text-white shadow-[0_18px_32px_-24px_rgba(220,38,38,0.9)] transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
                  aria-label="حذف المحدد"
                  title={selectedPhotoIds.length ? `حذف ${selectedPhotoIds.length} صورة` : 'حذف المحدد'}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ) : null}
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
              disabled={status === 'loading' || isDeleting}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${status === 'loading' ? 'animate-spin' : ''}`} />
              تحديث
            </button>
          </div>
        </div>
      </div>

      {status === 'loading' ? (
        <div className="rounded-[24px] border border-slate-200 bg-white py-16 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.35)]">
          <LoadingSpinner title="جاري تحميل الصور" />
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-black text-red-700">
          {error}
        </div>
      ) : null}

      {status !== 'error' && error ? (
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
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {photos.map((photo) => {
              const isSelected = selectedPhotoIds.includes(photo.id);

              return (
                <article
                  key={photo.id}
                  className={`overflow-hidden rounded-[22px] border bg-white shadow-[0_22px_54px_-44px_rgba(15,23,42,0.42)] transition ${
                    isSelected ? 'border-slate-950 ring-4 ring-slate-950/10' : 'border-slate-200'
                  }`}
                >
                  <div className="relative aspect-[4/3] bg-slate-100">
                    <button
                      type="button"
                      onClick={() => togglePhotoSelection(photo.id)}
                      disabled={isDeleting}
                      className={`absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-xl border shadow-sm transition ${
                        isSelected
                          ? 'border-slate-950 bg-slate-950 text-white'
                          : 'border-white/80 bg-white/90 text-transparent hover:text-slate-500'
                      } disabled:cursor-not-allowed disabled:opacity-60`}
                      aria-label={isSelected ? 'إلغاء تحديد الصورة' : 'تحديد الصورة'}
                      title={isSelected ? 'إلغاء التحديد' : 'تحديد'}
                    >
                      <Check className="h-5 w-5" />
                    </button>
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
                    <div className="grid grid-cols-2 gap-2 text-xs font-bold text-slate-500">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <span className="block text-[10px] font-black text-slate-400">الحجم</span>
                        {formatFileSize(photo.size)}
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <span className="block text-[10px] font-black text-slate-400">التاريخ</span>
                        {formatDate(photo.createdAt)}
                      </div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-left font-mono text-[11px] font-bold text-slate-500" dir="ltr">
                      {photo.path}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      ) : null}

      {status === 'ready' && !photos.length ? (
        <PhotosEmptyState
          tone="all"
          title="لا توجد صور على Storage حاليًا"
          description="لم يتم العثور على صور داخل مسارات الشركة الحالية في bucket tenant-files."
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
