import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Phone, UserRound, X } from 'lucide-react';

function getCustomerName(request) {
  return request.customer?.name || 'عميل غير محدد';
}

function getCustomerPhone(request) {
  return request.customer?.phone || request.customer?.phone1 || request.customer?.phone2 || 'لا يوجد رقم هاتف';
}

function formatReceivedAt(request) {
  const value = request.stageEnteredAt || request.updatedAt || request.createdAt;
  if (!value) return 'غير محدد';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  }).format(date);
}

export function PendingCustomerNotificationDrawer({ open, onOpenChange, requests = [], onOpenRequest }) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  const frameRef = useRef(null);
  const pendingRequests = useMemo(
    () => requests.filter((request) => request.currentStage === 'received_from_processor'),
    [requests],
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
      <button type="button" onClick={() => onOpenChange(false)} className={`absolute inset-0 bg-slate-950/30 transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`} aria-label="إغلاق قائمة انتظار الإبلاغ" />
      <aside className={`absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-white shadow-2xl transition-transform duration-[240ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${visible ? 'translate-x-0' : 'translate-x-full'}`}>
        <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600"><Phone className="h-4.5 w-4.5" /></span>
            <div className="min-w-0">
              <h2 className="truncate text-base font-black text-slate-950">بانتظار الإبلاغ</h2>
              <p className="text-[10px] font-bold text-slate-400">{pendingRequests.length} عميل بانتظار التواصل</p>
            </div>
          </div>
          <button type="button" onClick={() => onOpenChange(false)} className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200" aria-label="إغلاق"><X className="h-5 w-5" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {pendingRequests.length ? (
            <div className="divide-y divide-slate-100">
              {pendingRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  onClick={() => {
                    onOpenRequest?.(request);
                  }}
                  className="flex w-full items-start gap-3 px-4 py-4 text-right transition hover:bg-amber-50/35"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-400"><UserRound className="h-4 w-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-black text-slate-950">{getCustomerName(request)}</span>
                      <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black text-amber-700">بانتظار الإبلاغ</span>
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-slate-500" dir="ltr"><Phone className="h-3 w-3" />{getCustomerPhone(request)}</span>
                    <span className="mt-2 flex items-center gap-1.5 truncate text-[10px] font-black text-slate-700"><FileText className="h-3 w-3 shrink-0 text-slate-400" />{request.productName || 'طلب أوراق'}</span>
                    <span className="mt-1 block text-[9px] font-bold text-slate-400">تم استلام الأوراق: {formatReceivedAt(request)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex min-h-full items-center justify-center px-6 text-center text-sm font-black text-slate-400">لا يوجد عملاء بانتظار الإبلاغ حاليًا.</div>
          )}
        </div>
      </aside>
    </div>,
    document.body,
  );
}
