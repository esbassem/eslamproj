import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, ShieldCheck, X } from 'lucide-react';

function formatDate(value) {
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

function getTrackingText(document) {
  return (document.trackingIdentifiers || [])
    .map((identifier) => {
      const value = identifier.isNotAvailable ? 'غير متاح' : identifier.value;
      return value ? `${identifier.label || identifier.code || 'تعريف'}: ${value}` : '';
    })
    .filter(Boolean)
    .join(' · ');
}

export function VaultPaperworkDrawer({ open, onOpenChange, documents = [], isLoading = false }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const frameRef = useRef(null);
  const vaultDocuments = useMemo(
    () => documents.filter((document) => document.status === 'in_custody'),
    [documents],
  );

  useEffect(() => {
    window.clearTimeout(timerRef.current);
    if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    if (open) {
      setMounted(true);
      setVisible(false);
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = window.requestAnimationFrame(() => {
          setVisible(true);
          frameRef.current = null;
        });
      });
    } else {
      setVisible(false);
      timerRef.current = window.setTimeout(() => setMounted(false), 240);
    }
    return () => {
      window.clearTimeout(timerRef.current);
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
    };
  }, [open]);

  useEffect(() => {
    if (!mounted) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [mounted, onOpenChange]);

  if (!mounted) return null;

  return createPortal(
    <div className={`fixed inset-0 z-[130] ${visible ? 'pointer-events-auto' : 'pointer-events-none'}`} dir="rtl">
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        className={`absolute inset-0 bg-slate-950/30 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        aria-label="إغلاق نافذة أوراق الخزنة"
      />
      <aside className={`absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-2xl transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${visible ? 'translate-x-0' : 'translate-x-full'}`}>
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black text-slate-950">الأوراق الموجودة</h2>
              <p className="text-[10px] font-bold text-slate-400">{vaultDocuments.length} ورقة في الخزنة</p>
            </div>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="إغلاق">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex min-h-full items-center justify-center text-sm font-black text-slate-400">جاري تحميل الأوراق...</div>
          ) : vaultDocuments.length ? (
            <div className="divide-y divide-slate-100">
              {vaultDocuments.map((document) => {
                const trackingText = getTrackingText(document);
                return (
                  <article key={document.id} className="flex items-start gap-3 px-4 py-4 hover:bg-emerald-50/30">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-400">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-black text-slate-950">{document.productName || document.itemDescription || document.displayTitle}</h3>
                          <p className="mt-0.5 truncate text-[10px] font-bold text-slate-500">{document.documentTitle || document.displayTitle || 'جواب'}</p>
                        </div>
                        {document.jawabPhoto?.signedUrl ? (
                          <a href={document.jawabPhoto.signedUrl} target="_blank" rel="noreferrer" className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200">
                            <img src={document.jawabPhoto.signedUrl} alt="صورة الجواب" className="h-full w-full object-cover" />
                          </a>
                        ) : null}
                      </div>
                      {document.owner?.name ? <p className="mt-2 text-[10px] font-black text-slate-600">باسم: {document.owner.name}</p> : null}
                      {trackingText ? <p className="mt-1 truncate text-[10px] font-bold text-slate-400">{trackingText}</p> : null}
                      <p className="mt-2 text-[9px] font-bold text-emerald-600">في الخزنة منذ: {formatDate(document.latestMove?.movedAt || document.updatedAt)}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-full items-center justify-center px-6 text-center text-sm font-black text-slate-400">لا توجد أوراق في الخزنة حاليًا.</div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
