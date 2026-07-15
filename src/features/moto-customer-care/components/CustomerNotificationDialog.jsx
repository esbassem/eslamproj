import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquareText, Phone, Send, UserRound, X } from 'lucide-react';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { motoCustomerCareService } from '@/features/moto-customer-care/services/motoCustomerCare.service';

export function CustomerNotificationDialog({ request, open, onOpenChange, tenantId, onNotified }) {
  const { tenant } = useWorkspace();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setIsSubmitting(false);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape' && !isSubmitting) onOpenChange(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isSubmitting, onOpenChange, open]);

  if (!open || !request) return null;

  const customerName = request.customer?.name || 'عميل غير محدد';
  const customerPhone = request.customer?.phone || request.customer?.phone1 || request.customer?.phone2 || '--';
  const showroomName = tenant?.name || tenant?.company_name || tenant?.display_name || 'معرض الوكيل';
  const message = `الأستاذ/ ${customerName}، نحيط سيادتكم علمًا بوصول الأوراق الخاصة بـ ${request.productName || 'طلبكم'}، وأصبحت جاهزة للاستلام. يسعدنا خدمتكم — ${showroomName}.`;
  const smsHref = customerPhone === '--'
    ? ''
    : `sms:${customerPhone.replace(/[^+\d]/g, '')}?body=${encodeURIComponent(message)}`;
  const confirmNotification = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      const result = await motoCustomerCareService.notifyPaperworkCustomer({ tenantId, requestId: request.id });
      onNotified?.(result);
      onOpenChange(false);
    } catch (nextError) {
      setError(nextError?.message || 'تعذر تأكيد إبلاغ العميل.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-950/35 p-4" dir="rtl">
      <button type="button" className="absolute inset-0" onClick={() => { if (!isSubmitting) onOpenChange(false); }} aria-label="إغلاق نافذة إبلاغ العميل" />
      <section className="relative w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black text-blue-600">الأوراق جاهزة للاستلام</p>
            <h3 className="mt-1 text-base font-black text-slate-950">إبلاغ العميل</h3>
          </div>
          <button type="button" disabled={isSubmitting} onClick={() => onOpenChange(false)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 disabled:opacity-50" aria-label="إغلاق"><X className="h-4 w-4" /></button>
        </div>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm"><UserRound className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="truncate text-xs font-black text-slate-900">{customerName}</p>
              <p className="mt-0.5 text-[10px] font-bold text-slate-500" dir="ltr">{customerPhone}</p>
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <p className="text-[11px] font-black text-slate-600">إرشادات إبلاغ العميل</p>
          <div className="flex items-start gap-3 rounded-xl border border-blue-100 bg-blue-50/70 p-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white"><Phone className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="text-xs font-black text-slate-900">أولًا: مكالمة هاتفية</p>
              <p className="mt-1 text-[10px] font-bold leading-5 text-slate-500">اتصل بالعميل وأبلغه بوصول الأوراق وجاهزيتها للاستلام.</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-700 text-white"><MessageSquareText className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-black text-slate-900">ثانيًا: رسالة SMS</p>
                  {smsHref ? (
                    <a href={smsHref} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-700" aria-label="فتح الرسالة في تطبيق الرسائل" title="إرسال عبر تطبيق الرسائل">
                      <Send className="h-3.5 w-3.5" />
                    </a>
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 cursor-not-allowed items-center justify-center rounded-lg bg-slate-200 text-slate-400" title="لا يوجد رقم هاتف"><Send className="h-3.5 w-3.5" /></span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5"><p className="text-xs font-bold leading-6 text-slate-700">{message}</p></div>
          </div>
        </div>

        {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2.5 text-xs font-bold leading-5 text-red-700">{error}</p> : null}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" disabled={isSubmitting} onClick={() => onOpenChange(false)} className="h-10 rounded-xl bg-slate-100 text-xs font-black text-slate-700 disabled:opacity-50">إلغاء</button>
          <button type="button" disabled={isSubmitting} onClick={confirmNotification} className="h-10 rounded-xl bg-blue-600 text-xs font-black text-white transition hover:bg-blue-700 disabled:cursor-wait disabled:opacity-60">{isSubmitting ? 'جاري التأكيد...' : 'تأكيد تم الإبلاغ'}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
