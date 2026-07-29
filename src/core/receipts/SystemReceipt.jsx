import { forwardRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { cn } from '@/core/utils/cn';

const RECEIPT_TYPE_LABELS = {
  invoice_collection: 'إيصال تحصيل فاتورة',
  installment_collection: 'إيصال تحصيل قسط',
  purchase_payment: 'إيصال دفع مشتريات',
  payment: 'إيصال دفع',
  receipt: 'إيصال استلام',
};

function formatReceiptMoney(value, currency = 'ج.م') {
  return `${Number(value || 0).toLocaleString('ar-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`;
}

function formatReceiptDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ReceiptDetail({ label, value, className }) {
  if (!value) return null;
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[10px] font-bold text-slate-400">{label}</p>
      <p className="mt-1 break-words text-xs font-black text-slate-800">{value}</p>
    </div>
  );
}

/**
 * General-purpose financial receipt used across the system.
 *
 * receipt shape:
 * {
 *   type, title, number, issuedAt, amount, currency,
 *   company: { name, subtitle, taxNumber, phone },
 *   party: { label, name, detail },
 *   account: { label, name },
 *   reference: { label, value },
 *   previousPayments: [{ id, amount, date, label }],
 *   balance: { label, value },
 *   notes, issuedBy, metadata: [{ label, value }]
 * }
 */
export const SystemReceipt = forwardRef(function SystemReceipt(
  { receipt = {}, className },
  ref,
) {
  const {
    type = 'receipt',
    title,
    number,
    issuedAt,
    amount,
    currency = 'ج.م',
    company = {},
    party = {},
    account = {},
    reference = {},
    previousPayments = [],
    balance = null,
    notes,
    issuedBy,
    metadata = [],
  } = receipt;

  const receiptTitle = title || RECEIPT_TYPE_LABELS[type] || RECEIPT_TYPE_LABELS.receipt;

  return (
    <article
      ref={ref}
      dir="rtl"
      className={cn(
        'system-receipt mx-auto w-full max-w-[390px] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-950 shadow-[0_18px_50px_rgba(15,23,42,0.12)]',
        className,
      )}
    >
      <header className="border-b border-slate-100 px-4 pb-4 pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {company.name ? <p className="truncate text-sm font-black">{company.name}</p> : null}
            {company.subtitle ? <p className="mt-0.5 text-[10px] font-bold text-slate-400">{company.subtitle}</p> : null}
          </div>
          <div className="shrink-0 text-left">
            <h1 className="text-xs font-black text-slate-900">{receiptTitle}</h1>
            {number ? <p className="mt-0.5 text-[9px] font-bold text-slate-400">رقم {number}</p> : null}
            <p className="mt-0.5 text-[8px] font-bold text-slate-400">{formatReceiptDate(issuedAt)}</p>
          </div>
        </div>

        <div className="px-2 pb-1 pt-5 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]" />
            <span className="text-[9px] font-black text-emerald-700">تم التحصيل بنجاح</span>
          </div>
          <p className="mt-3 text-[30px] font-black tracking-[-0.04em] text-slate-950">
            {formatReceiptMoney(amount, currency)}
          </p>
          {notes ? <p className="mx-auto mt-1 max-w-[280px] truncate text-[10px] font-bold text-slate-500">{notes}</p> : null}
        </div>
      </header>

      <div className="space-y-3 px-4 py-4">
        <section className="grid grid-cols-2 gap-x-4 gap-y-3">
          <ReceiptDetail label={party.label || 'الطرف'} value={party.name} />
          <ReceiptDetail label={account.label || 'الحساب'} value={account.name} />
          <ReceiptDetail label={reference.label || 'المرجع'} value={reference.value} />
          <ReceiptDetail label="تم التسجيل بواسطة" value={issuedBy || '—'} />
          {metadata.map((field, index) => (
            <ReceiptDetail key={field.id || `${field.label}-${index}`} label={field.label} value={field.value} />
          ))}
        </section>

        {previousPayments.length ? (
          <section>
            <p className="mb-1.5 text-[10px] font-black text-slate-500">الدفعات السابقة</p>
            <div className="grid grid-cols-2 gap-1.5">
              {previousPayments.map((payment, index) => (
                <div key={payment.id || index} className="rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2">
                  <p className="text-[10px] font-black text-emerald-700">
                    {formatReceiptMoney(payment.amount, currency)}
                  </p>
                  <p className="mt-0.5 truncate text-[8px] font-bold text-slate-400">
                    {payment.label || formatReceiptDate(payment.date)}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {balance?.value ? (
          <section className="flex items-center justify-between gap-4 rounded-xl bg-slate-950 px-3.5 py-3 text-white">
            <p className="text-[9px] font-bold text-white/55">{balance.label || 'الرصيد المتبقي'}</p>
            <p className="text-sm font-black">{balance.value}</p>
          </section>
        ) : null}

      </div>

      {company.taxNumber || company.phone ? (
        <footer className="border-t border-slate-100 px-4 py-3 text-left text-[8px] font-bold text-slate-400">
          <p>{company.taxNumber ? `الرقم الضريبي: ${company.taxNumber}` : null}</p>
          <p className="mt-1">{company.phone || null}</p>
        </footer>
      ) : null}
    </article>
  );
});

export const systemReceiptUtils = {
  formatMoney: formatReceiptMoney,
  formatDate: formatReceiptDate,
  typeLabels: RECEIPT_TYPE_LABELS,
};

export function SystemReceiptDialog({ open, onOpenChange, receipt, isLoading = false }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-slate-950/45 backdrop-blur-sm" />
        <Dialog.Content
          dir="rtl"
          className="fixed inset-x-3 top-1/2 z-[100] max-h-[96vh] -translate-y-1/2 overflow-y-auto bg-transparent p-0 outline-none sm:left-1/2 sm:right-auto sm:w-full sm:max-w-[390px] sm:-translate-x-1/2"
        >
          <Dialog.Title className="sr-only">معاينة الإيصال</Dialog.Title>
          <div className="system-receipt-print-root relative">
            <Dialog.Close className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-slate-100/90 text-slate-500 shadow-sm backdrop-blur transition hover:bg-slate-200 hover:text-slate-900 print:hidden">
              <X className="h-4 w-4" />
              <span className="sr-only">إغلاق</span>
            </Dialog.Close>
            <SystemReceipt receipt={receipt} />
            {isLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-white/90 text-slate-600 backdrop-blur-sm">
                <Loader2 className="h-6 w-6 animate-spin text-slate-900" />
                <p className="mt-3 text-xs font-black">جاري تجهيز الإيصال...</p>
                <p className="mt-1 text-[10px] font-bold text-slate-400">يتم تحميل تفاصيل الفاتورة والدفعات</p>
              </div>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
