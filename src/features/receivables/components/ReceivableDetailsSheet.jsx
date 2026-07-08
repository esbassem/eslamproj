import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Loader2, Printer, Trash2, X } from 'lucide-react';
import { Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { cn } from '@/core/utils/cn';
import { ReceivableContractPreview } from '@/features/receivables/components/ReceivableContractPreview';

const sourceTypeLabels = {
  manual: 'يدوي',
  sale: 'بيع',
  invoice: 'فاتورة',
  contract: 'عقد',
  opening_balance: 'رصيد افتتاحي',
};

const receivableDetailsTabs = [
  { key: 'installments', label: 'الاستحقاقات' },
  { key: 'guarantors', label: 'الضامنين' },
  { key: 'contracts', label: 'عقود المديونية' },
  { key: 'payments', label: 'الدفعات' },
  { key: 'events', label: 'الأحداث' },
];

const receivableNumberStyle = {
  fontFamily: "'Cascadia Mono', Consolas, 'Liberation Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
  fontFeatureSettings: '"tnum"',
};

function toNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ج.م`;
}

function formatPlainNumber(value) {
  return Number(value || 0).toLocaleString('ar-EG-u-nu-latn', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

function formatShortDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('ar-EG', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  }).format(date);
}

function labelFor(map, value, fallback = 'غير محدد') {
  return map[value] ?? value ?? fallback;
}

function paymentProgressPercent(receivable) {
  const total = toNumber(receivable?.total_amount);
  if (total <= 0) return 0;
  return Math.min(Math.max((toNumber(receivable?.paid_amount) / total) * 100, 0), 100);
}

function todayIsoDate() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function currentInstallmentIndex(receivable) {
  const installments = Array.isArray(receivable?.installments) ? receivable.installments : [];
  if (!installments.length) return -1;

  const activeInstallments = installments
    .map((installment, index) => ({ installment, index }))
    .filter(({ installment }) => (
      toNumber(installment.remaining_amount) > 0
      && !['paid', 'cancelled'].includes(String(installment.status || '').toLowerCase())
    ));

  if (!activeInstallments.length) return installments.length - 1;

  const today = todayIsoDate();
  const dueInstallment = activeInstallments.find(({ installment }) => (
    installment.due_date && installment.due_date <= today
  ));

  return (dueInstallment || activeInstallments[0]).index;
}

function receivableContractDetails(notes) {
  const details = {
    trustReceiptStatus: '',
    paperworkStatus: '',
    extraNotes: '',
  };

  String(notes || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex < 0) return;

      const label = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (label === 'حالة إيصالات الأمانة') {
        details.trustReceiptStatus = value;
      } else if (label === 'الموقف الورقي') {
        details.paperworkStatus = value;
      } else if (label === 'ملاحظات إضافية') {
        details.extraNotes = value;
      }
    });

  return details;
}

function ReceivableInfoLine({ label, value, dir, tone = 'slate', valueStyle }) {
  const toneClass = tone === 'danger'
    ? 'text-rose-700'
    : tone === 'warning'
      ? 'text-amber-700'
      : 'text-slate-950';

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5">
      <span className="flex-shrink-0 font-bold text-slate-400">{label} :</span>
      <span className={cn('min-w-0 truncate font-black', toneClass)} dir={dir} style={valueStyle}>{value}</span>
    </div>
  );
}

export function ReceivableDetailsSheet({
  receivable,
  events,
  open,
  onOpenChange,
  companyName,
  canDelete = false,
  onDelete,
  isDeleting = false,
}) {
  const [activeDetailsTab, setActiveDetailsTab] = useState('installments');
  const [isContractOpen, setIsContractOpen] = useState(false);

  useEffect(() => {
    setActiveDetailsTab('installments');
    setIsContractOpen(false);
  }, [receivable?.id]);

  if (!receivable) return null;

  const installments = Array.isArray(receivable.installments) ? receivable.installments : [];
  const guarantors = Array.isArray(receivable.guarantors) ? receivable.guarantors : [];
  const payments = Array.isArray(receivable.payments) ? receivable.payments : [];
  const contractDetails = receivableContractDetails(receivable.notes);
  const progress = paymentProgressPercent(receivable);
  const installmentSegments = Math.max(installments.length, 1);
  const activeInstallmentIndex = currentInstallmentIndex(receivable);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="max-w-4xl" dir="rtl">
        <div className="absolute left-4 top-4 z-30 flex items-center gap-2">
          <SheetClose
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
            aria-label="إغلاق"
            title="إغلاق"
          >
            <X className="h-4 w-4" />
          </SheetClose>
          {canDelete ? (
            <button
              type="button"
              onClick={onDelete}
              disabled={isDeleting}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-rose-100 bg-white text-rose-500 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="حذف المديونية"
              title="حذف المديونية"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setIsContractOpen(true)}
            disabled={isDeleting}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="طباعة عقد المديونية"
            title="طباعة عقد المديونية"
          >
            <Printer className="h-4 w-4" />
          </button>
        </div>
        <SheetHeader className="relative z-10 border-b-0 bg-white px-6 pb-5 pt-12 shadow-none">
          <div className="min-w-0 pl-12">
            <div className="min-w-0">
              <SheetTitle className="truncate text-lg font-black leading-6 text-slate-950">
                {receivable.partnerName || 'طرف غير محدد'}
              </SheetTitle>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-black text-slate-500">{receivable.title || labelFor(sourceTypeLabels, receivable.source_type)}</p>
                <span className="inline-flex min-w-0 flex-shrink rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">
                  <span className="flex-shrink-0">{labelFor(sourceTypeLabels, receivable.source_type)}</span>
                  {receivable.createdByName ? (
                    <span className="mr-1 min-w-0 truncate">بواسطة {receivable.createdByName}</span>
                  ) : null}
                </span>
              </div>
            </div>

            <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]" dir="rtl">
              <aside className="min-w-0 space-y-1.5 pl-4 pr-2">
                <ReceivableInfoLine label="المستحق حاليًا" value={formatMoney(receivable.dueAmount)} dir="ltr" tone={receivable.dueAmount > 0 ? 'warning' : 'slate'} valueStyle={receivableNumberStyle} />
                <ReceivableInfoLine label="المتأخر" value={formatMoney(receivable.overdueAmount)} dir="ltr" tone={receivable.overdueAmount > 0 ? 'danger' : 'slate'} valueStyle={receivableNumberStyle} />
              </aside>
              <div className="min-w-0 text-right">
                <div className="mb-1 flex items-baseline justify-start gap-2 font-extrabold" dir="ltr" style={receivableNumberStyle}>
                  <span className="text-sm text-slate-700">{formatPlainNumber(receivable.total_amount)}</span>
                  <span className="text-slate-300">/</span>
                  <span className="text-2xl leading-none text-emerald-600">{formatPlainNumber(receivable.paid_amount)}</span>
                </div>
                <div className="relative h-5 overflow-hidden rounded-full border border-slate-300 bg-slate-100 shadow-inner">
                  <div className="flex h-full justify-end">
                    <span
                      className={cn(
                        'block h-full rounded-full transition-all',
                        progress >= 100
                          ? 'bg-gradient-to-l from-emerald-500 to-emerald-400'
                          : progress > 0
                            ? 'bg-gradient-to-l from-cyan-600 to-sky-400'
                            : 'bg-transparent',
                      )}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="pointer-events-none absolute inset-0 flex">
                    {Array.from({ length: installmentSegments }).map((_, segmentIndex) => (
                      <span
                        key={`${receivable.id}-details-segment-${segmentIndex}`}
                        className={cn(
                          'h-full flex-1 border-l border-slate-400/55 last:border-l-0',
                          segmentIndex === activeInstallmentIndex
                            ? 'bg-amber-300/25 shadow-[inset_0_0_0_2px_rgba(245,158,11,0.78)]'
                            : '',
                        )}
                      />
                    ))}
                  </div>
                </div>
                <p className="mt-1 text-left text-[10px] font-bold leading-4 text-slate-300">
                  <span style={receivableNumberStyle}>
                    {installments.length.toLocaleString('ar-EG')}
                  </span>{' '}
                  استحقاق
                </p>
              </div>
            </div>

            <div className="mt-5 flex min-w-0 items-center gap-1 overflow-x-auto rounded-full bg-slate-50/80 p-1 ring-1 ring-slate-200/70">
              {receivableDetailsTabs.map((tab) => {
                const isActive = activeDetailsTab === tab.key;

                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveDetailsTab(tab.key)}
                    className={cn(
                      'h-8 shrink-0 rounded-full px-4 text-xs font-black transition-colors',
                      isActive
                        ? 'bg-white text-blue-600 ring-1 ring-slate-200'
                        : 'text-slate-500 hover:text-slate-800',
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </SheetHeader>
        <SheetBody className="bg-white py-0">
          <section className={activeDetailsTab === 'installments' ? '' : 'px-0 py-2'}>
            {activeDetailsTab === 'installments' ? (
              <>
                {contractDetails.extraNotes ? (
                  <div className="border-b border-slate-100 bg-white pb-3 text-right">
                    <p className="text-xs font-bold leading-5 text-slate-400">
                      {contractDetails.extraNotes}
                    </p>
                  </div>
                ) : null}
                {installments.length ? (
                  <div className="overflow-hidden border-b border-slate-200 bg-white">
                    {installments.map((installment) => {
                      const installmentNumber = installment.installment_no || '--';
                      const installmentName = installment.name || installment.title || installment.notes || `القسط ${installmentNumber}`;

                      return (
                        <div
                          key={installment.id || `${receivable.id}-${installment.installment_no}`}
                          className="border-b border-slate-100 px-0 py-3 last:border-b-0"
                        >
                          <div className="flex items-center gap-3">
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-extrabold text-[#73849a]" dir="ltr" style={receivableNumberStyle}>
                              {installmentNumber}
                            </span>
                            <div className="min-w-0 w-fit max-w-[calc(100%-2.75rem)] text-right">
                              <p className="text-lg font-extrabold leading-5 text-slate-950" dir="ltr" style={receivableNumberStyle}>
                                {toNumber(installment.amount).toLocaleString('ar-EG-u-nu-latn', {
                                  minimumFractionDigits: 0,
                                  maximumFractionDigits: 2,
                                })}
                              </p>
                              <p className="flex min-w-0 items-center justify-end gap-1.5 text-[11px] font-black leading-4 text-[#73849a]">
                                <span className="truncate">{installmentName}</span>
                                <span className="h-1 w-1 shrink-0 rounded-full bg-[#b8c3d1]" />
                                <span className="shrink-0" dir="ltr" style={receivableNumberStyle}>{formatShortDate(installment.due_date)}</span>
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-8 text-center text-sm font-bold text-slate-500">
                    لا توجد استحقاقات مسجلة
                  </div>
                )}
              </>
            ) : null}

            {activeDetailsTab === 'guarantors' ? (
              guarantors.length ? (
                <div className="divide-y divide-slate-100">
                  {guarantors.map((guarantor, index) => (
                    <div key={guarantor.id || guarantor.partner_id || index} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0 text-right">
                        <p className="truncate text-sm font-black text-slate-950">{guarantor.name || `ضامن ${index + 1}`}</p>
                        <p className="mt-0.5 truncate text-xs font-bold text-[#73849a]">{guarantor.phone || 'بدون رقم هاتف'}</p>
                      </div>
                      <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-500">
                        ضامن {guarantor.order || index + 1}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-sm font-bold text-slate-400">
                  لا توجد بيانات ضامنين مسجلة
                </div>
              )
            ) : null}

            {activeDetailsTab === 'contracts' ? (
              <div className="divide-y divide-slate-100">
                <div className="py-3 text-right">
                  <p className="text-xs font-bold text-slate-400">إيصالات الأمانة</p>
                  <p className="mt-1 text-sm font-black leading-6 text-slate-950">
                    {contractDetails.trustReceiptStatus || 'لا توجد بيانات مسجلة'}
                  </p>
                </div>
                <div className="py-3 text-right">
                  <p className="text-xs font-bold text-slate-400">التوكيلات</p>
                  <p className="mt-1 text-sm font-black leading-6 text-slate-950">
                    {contractDetails.paperworkStatus || 'لا توجد بيانات مسجلة'}
                  </p>
                </div>
                <div className="py-3 text-right">
                  <p className="text-xs font-bold text-slate-400">الملاحظات</p>
                  <p className="mt-1 text-sm font-black leading-6 text-slate-950">
                    {contractDetails.extraNotes || 'لا توجد ملاحظات مسجلة'}
                  </p>
                </div>
              </div>
            ) : null}

            {activeDetailsTab === 'payments' ? (
              payments.length ? (
                <div className="divide-y divide-slate-100">
                  {payments.map((payment, index) => (
                    <div key={payment.id || index} className="flex items-center justify-between gap-4 py-3">
                      <div className="min-w-0 text-right">
                        <p className="text-base font-extrabold text-slate-950" dir="ltr" style={receivableNumberStyle}>
                          {formatPlainNumber(payment.amount)}
                        </p>
                        <p className="mt-0.5 text-xs font-bold text-[#73849a]" dir="ltr" style={receivableNumberStyle}>
                          {formatShortDate(payment.paid_at || payment.payment_date || payment.created_at)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700">
                        دفعة
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-sm font-bold text-slate-400">
                  لا توجد دفعات مسجلة
                </div>
              )
            ) : null}

            {activeDetailsTab === 'events' ? (
              events.length ? (
                <div className="divide-y divide-slate-100">
                  {events.map((event, index) => (
                    <div key={event.id || index} className="py-3 text-right">
                      <p className="text-sm font-black text-slate-950">{event.notes || event.event_type || 'حدث'}</p>
                      <p className="mt-0.5 text-xs font-bold text-[#73849a]">
                        <span dir="ltr" style={receivableNumberStyle}>{formatShortDate(event.created_at)}</span>
                        {event.createdByName ? ` · ${event.createdByName}` : ''}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-sm font-bold text-slate-400">
                  لا توجد أحداث مسجلة
                </div>
              )
            ) : null}
          </section>
        </SheetBody>
        <ReceivableContractWindow
          receivable={receivable}
          isOpen={isContractOpen}
          companyName={companyName}
          onClose={() => setIsContractOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}

function ReceivableContractWindow({ receivable, isOpen, companyName, onClose }) {
  if (!isOpen || !receivable) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        key="receivable-contract-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12, ease: 'easeOut' }}
        onClick={onClose}
        style={{ zIndex: 2147483642 }}
        className="fixed inset-0 bg-slate-950/35 backdrop-blur-sm"
      />
      <motion.div
        key="receivable-contract-window"
        initial={{ x: '100%' }}
        animate={{ x: '0%' }}
        exit={{ x: '100%' }}
        transition={{ type: 'tween', duration: 0.22, ease: [0.3, 1, 0.4, 1] }}
        style={{ zIndex: 2147483643 }}
        className="fixed inset-y-0 right-0 flex h-dvh w-full max-w-[760px] flex-col overflow-hidden bg-slate-200 shadow-2xl"
        dir="rtl"
      >
        <style>{`
          @media print {
            @page {
              size: A4;
              margin: 0;
            }

            html,
            body {
              width: 210mm !important;
              min-height: 297mm !important;
              margin: 0 !important;
              background: white !important;
            }

            body * {
              visibility: hidden !important;
            }

            .receivable-contract-print,
            .receivable-contract-print * {
              visibility: visible !important;
            }

            .receivable-contract-print {
              position: fixed !important;
              inset: 0 !important;
              width: 210mm !important;
              min-height: auto !important;
              background: white !important;
            }

            .receivable-contract-print-shell {
              padding: 0 !important;
              overflow: visible !important;
              background: white !important;
            }

            .receivable-contract-preview-wrapper {
              max-width: none !important;
              width: 210mm !important;
              padding: 0 !important;
              background: white !important;
            }

            .receivable-contract-page {
              min-height: auto !important;
              border: 0 !important;
              box-shadow: none !important;
              break-after: avoid !important;
              page-break-after: avoid !important;
            }
          }
        `}</style>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-200 px-3 py-5 pb-8 shadow-inner sm:px-5">
          <div className="receivable-contract-print-shell">
            <div className="receivable-contract-print">
              <ReceivableContractPreview
                companyName={companyName}
                receivable={receivable}
              />
            </div>
          </div>
        </div>
        <footer className="relative z-10 flex items-start justify-between gap-4 border-t-4 border-[#2f86cf] bg-white/95 px-5 py-4 text-right shadow-[0_-18px_38px_-24px_rgba(15,23,42,0.85)] backdrop-blur">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-slate-900">معاينة عقد المديونية</h2>
            <p className="text-xs font-bold text-slate-500">راجع بيانات العقد قبل الطباعة.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
              aria-label="إغلاق معاينة العقد"
              title="إغلاق"
            >
              <X className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#bdd8ee] bg-[#edf5fc] text-[#2f86cf] transition hover:bg-[#dcecf8]"
              aria-label="طباعة العقد"
              title="طباعة العقد"
            >
              <Printer className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </motion.div>
    </AnimatePresence>
  );
}
