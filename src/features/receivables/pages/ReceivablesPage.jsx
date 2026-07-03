import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  CircleDollarSign,
  Clock3,
  FileText,
  History,
  Loader2,
  Plus,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { cn } from '@/core/utils/cn';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { partnersService } from '@/features/contacts/services/partners.service';
import { receivablesApi } from '@/features/receivables/api/receivables.api';
import { ReceivableCreateSheet } from '@/features/receivables/components/ReceivableManualCreateSheet';

const statusLabels = {
  draft: 'مسودة',
  open: 'مفتوحة',
  partially_paid: 'مدفوعة جزئيًا',
  paid: 'مدفوعة',
  closed: 'مغلقة',
  cancelled: 'ملغاة',
  pending: 'معلقة',
};

const priorityLabels = {
  low: 'منخفضة',
  normal: 'عادية',
  medium: 'متوسطة',
  high: 'عالية',
  urgent: 'عاجلة',
};

const receivableTypeLabels = {
  customer: 'عميل',
  partner: 'طرف',
  employee: 'موظف',
  financer: 'ممّول',
  other: 'أخرى',
};

const sourceTypeLabels = {
  manual: 'يدوي',
  sale: 'بيع',
  invoice: 'فاتورة',
  contract: 'عقد',
  opening_balance: 'رصيد افتتاحي',
};

const installmentInitialState = {
  installment_no: '',
  due_date: '',
  amount: '',
  notes: '',
};

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ج.م`;
}

function formatDate(value) {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium' }).format(date);
}

function toNumber(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function normalizeArabicNumber(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776));
}

function moneyInputValue(value) {
  return normalizeArabicNumber(value).replace(/[^0-9.]/g, '');
}

function labelFor(map, value, fallback = 'غير محدد') {
  return map[value] ?? value ?? fallback;
}

function statusVariant(status) {
  if (['open', 'paid', 'closed'].includes(status)) return 'success';
  if (['draft', 'pending', 'partially_paid'].includes(status)) return 'warning';
  return 'default';
}

function priorityClass(priority) {
  if (['high', 'urgent'].includes(priority)) return 'bg-rose-50 text-rose-700';
  if (priority === 'medium') return 'bg-amber-50 text-amber-700';
  if (priority === 'low') return 'bg-slate-100 text-slate-600';
  return 'bg-teal-50 text-teal-700';
}

function MetricCard({ icon: Icon, title, value, hint, tone = 'slate' }) {
  const tones = {
    slate: 'bg-slate-950 text-white',
    teal: 'bg-teal-600 text-white',
    amber: 'bg-amber-500 text-white',
    rose: 'bg-rose-600 text-white',
    indigo: 'bg-blue-600 text-white',
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-500">{title}</p>
          <p className="mt-3 truncate text-2xl font-black text-slate-950" dir="ltr">{value}</p>
          {hint ? <p className="mt-1 text-xs font-bold text-slate-400">{hint}</p> : null}
        </div>
        <span className={cn('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', tones[tone])}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </section>
  );
}

function EmptyPanel({ title, description }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center">
      <p className="font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}

function FieldValue({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-slate-900">{value || '--'}</p>
    </div>
  );
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

function ReceivableInfoLine({ label, value, dir, tone = 'slate' }) {
  const toneClass = tone === 'danger'
    ? 'text-rose-700'
    : tone === 'warning'
      ? 'text-amber-700'
      : 'text-slate-950';

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs leading-5">
      <span className="flex-shrink-0 font-bold text-slate-400">{label} :</span>
      <span className={cn('min-w-0 truncate font-black', toneClass)} dir={dir}>{value}</span>
    </div>
  );
}

function OperationsCard({ receivables, onOpen, onCreate, canCreate = false }) {
  return (
    <section className="customer-care-operations-window customer-care-fade-up min-h-0 p-5 text-slate-950 sm:p-8 lg:relative lg:z-[80] lg:m-0 lg:flex lg:h-full lg:w-full lg:max-w-none lg:items-center lg:justify-center lg:justify-self-stretch lg:py-10 lg:pl-20 lg:pr-28 xl:pl-28 xl:pr-36">
      <div className="relative z-10 flex h-full min-h-0 w-full max-w-[51rem] translate-x-4 translate-y-4 flex-col overflow-hidden rounded-[1.35rem] border border-white/70 bg-white shadow-[0_22px_48px_rgba(3,7,18,0.22)] lg:h-[calc(100%-0.5rem)] xl:translate-x-6">
      <div className="relative z-10 flex min-h-[6.25rem] flex-shrink-0 items-center justify-between gap-3 bg-white px-6 py-6 text-slate-950 shadow-[0_1px_0_rgba(15,23,42,0.08),0_10px_18px_rgba(15,23,42,0.035)] after:pointer-events-none after:absolute after:inset-x-6 after:bottom-0 after:h-px after:bg-gradient-to-l after:from-transparent after:via-slate-200 after:to-transparent sm:px-7 sm:after:inset-x-7">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-cyan-100 bg-cyan-50 text-cyan-700 shadow-sm">
            <FileText className="h-6 w-6" />
          </span>
          <div className="min-w-0 text-right">
            <h2 className="truncate text-2xl font-black leading-8 text-slate-950 sm:text-3xl sm:leading-10">مديونيات مسجلة يدويًا</h2>
            <p className="mt-1 text-sm font-black leading-5 text-slate-500">
              أحدث العمليات · {receivables.length.toLocaleString('ar-EG')} عملية
            </p>
          </div>
        </div>
        {canCreate ? (
          <Button
            type="button"
            onClick={onCreate}
            className="h-11 flex-shrink-0 rounded-xl bg-slate-950 px-4 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            <span>مديونية جديدة</span>
          </Button>
        ) : null}
      </div>

	      <div className="min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto bg-slate-50/70">
	        {receivables.length ? (
	          receivables.map((receivable, index) => {
	            const progress = paymentProgressPercent(receivable);
	            const installmentSegments = Math.max(receivable.installments?.length || 0, 1);
	            const activeInstallmentIndex = currentInstallmentIndex(receivable);
	            return (
		            <button
		              key={receivable.id}
		              type="button"
		              onClick={() => onOpen(receivable.id)}
		              className={cn(
		                'block w-full px-6 py-5 text-right transition focus:outline-none focus-visible:bg-cyan-50 sm:px-7',
		                index % 2 === 0 ? 'bg-white hover:bg-cyan-50/50' : 'bg-slate-50 hover:bg-cyan-50/60',
		              )}
			            >
		              <div className="min-w-0">
		                <p className="truncate text-lg font-black leading-6 text-slate-950">{receivable.partnerName || 'طرف غير محدد'}</p>
		                <div className="mt-1 flex min-w-0 items-center gap-2">
		                  <p className="truncate text-sm font-black text-slate-500">{receivable.title || labelFor(sourceTypeLabels, receivable.source_type)}</p>
	                  <span className="inline-flex flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-black text-slate-500">
	                    {labelFor(sourceTypeLabels, receivable.source_type)}
		                  </span>
			                </div>
			              </div>
		              <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-[13rem_minmax(0,1fr)]" dir="rtl">
		                <aside className="min-w-0 space-y-1.5 border-l border-slate-100 pl-4 pr-2">
		                  <ReceivableInfoLine label="المستحق حاليًا" value={formatMoney(receivable.dueAmount)} dir="ltr" tone={receivable.dueAmount > 0 ? 'warning' : 'slate'} />
		                  <ReceivableInfoLine label="المتأخر" value={formatMoney(receivable.overdueAmount)} dir="ltr" tone={receivable.overdueAmount > 0 ? 'danger' : 'slate'} />
		                </aside>
		                <div className="min-w-0 -translate-y-4 text-right">
		                  <div className="mb-1 flex items-center justify-start gap-2 text-sm font-black" dir="ltr">
			                    <span className="text-slate-700">{formatMoney(receivable.total_amount)}</span>
			                    <span className="text-slate-300">/</span>
			                    <span className="text-emerald-700">{formatMoney(receivable.paid_amount)}</span>
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
			                        key={`${receivable.id}-segment-${segmentIndex}`}
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
		                    {(receivable.installments?.length || 0).toLocaleString('ar-EG')} استحقاق
		                  </p>
		                </div>
		              </div>
	            </button>
	            );
	          })
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center bg-white px-6 text-center text-base font-black leading-7 text-slate-500">
            لا توجد مديونيات حتى الآن
          </div>
        )}
      </div>
      </div>
    </section>
  );
}

function ReceivablesIntroPanel() {
  return (
    <div className="customer-care-fade-up relative z-[45] h-full min-h-0 overflow-x-hidden overflow-y-auto bg-[radial-gradient(circle_at_45%_22%,rgba(34,211,238,0.20)_0%,rgba(14,116,144,0.10)_34%,transparent_58%),linear-gradient(145deg,#17283a_0%,#101f30_52%,#0a1420_100%)] px-0 pb-8 pt-16 text-right text-white [-webkit-overflow-scrolling:touch] sm:px-0 sm:pt-20 lg:overflow-hidden lg:bg-none lg:px-8 lg:pb-0 lg:pt-14 xl:px-10">
      <div className="pointer-events-none absolute inset-0 hidden sm:block">
        <span className="absolute left-[10%] top-[11%] h-7 w-7 rounded-md bg-white/12 shadow-[92px_98px_0_rgba(255,255,255,0.08),148px_32px_0_rgba(125,211,252,0.12)]" />
        <span className="absolute right-[13%] top-[34%] h-12 w-12 rounded-lg bg-white/10 shadow-[-38px_142px_0_rgba(125,211,252,0.10),92px_238px_0_rgba(255,255,255,0.08)]" />
        <span className="absolute left-[27%] top-[22%] h-px w-36 rotate-12 bg-gradient-to-r from-transparent via-sky-200/30 to-transparent" />
      </div>
      <div className="relative mt-6 px-6 sm:px-12 lg:mt-12 lg:px-6 xl:mt-16 xl:px-10">
        <p className="mb-2 text-xs font-semibold text-cyan-100/80 sm:mb-3 sm:text-sm">Receivables</p>
        <h1 className="max-w-sm text-3xl font-bold leading-tight text-white sm:text-5xl">
          المديونيات
        </h1>
        <p className="mt-3 max-w-md text-sm font-semibold leading-6 text-cyan-50/74 sm:text-base sm:leading-7">
          متابعة رأس المديونية، مواعيد الاستحقاق، وسجل الأحداث الإدارية.
        </p>
      </div>
    </div>
  );
}

function InstallmentForm({ receivable, onSubmit, isSaving, error }) {
  const [form, setForm] = useState(() => ({
    ...installmentInitialState,
    installment_no: String((receivable?.installments?.length ?? 0) + 1),
  }));

  useEffect(() => {
    setForm({
      ...installmentInitialState,
      installment_no: String((receivable?.installments?.length ?? 0) + 1),
    });
  }, [receivable?.id, receivable?.installments?.length]);

  const setField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSubmit(form);
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-semibold text-slate-900">إضافة استحقاق</p>
        <CalendarClock className="h-4 w-4 text-slate-500" />
      </div>
      {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label>رقم الاستحقاق</Label>
          <Input value={form.installment_no} inputMode="numeric" onChange={(event) => setField('installment_no', moneyInputValue(event.target.value))} required />
        </div>
        <div className="space-y-2">
          <Label>تاريخ الاستحقاق</Label>
          <Input type="date" value={form.due_date} onChange={(event) => setField('due_date', event.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>المبلغ</Label>
          <Input value={form.amount} inputMode="decimal" onChange={(event) => setField('amount', moneyInputValue(event.target.value))} required />
        </div>
        <div className="space-y-2">
          <Label>ملاحظات</Label>
          <Input value={form.notes} onChange={(event) => setField('notes', event.target.value)} placeholder="اختياري" />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button type="submit" size="sm" disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          إضافة استحقاق
        </Button>
      </div>
    </form>
  );
}

function ReceivableDetailsSheet({ receivable, events, open, onOpenChange, onAddInstallment, isSavingInstallment, installmentError }) {
  if (!receivable) return null;

  const customerPhone = receivable.partner?.phone
    || receivable.partner?.phone1
    || receivable.partner?.phone2
    || '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="max-w-4xl" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pr-6">
          <div className="min-w-0 pl-12">
            <SheetTitle className="truncate text-2xl font-black text-slate-950">
              {receivable.partnerName || 'طرف غير محدد'}
            </SheetTitle>
            {customerPhone ? (
              <p className="mt-1 truncate text-xs font-bold text-slate-400" dir="ltr">
                {customerPhone}
              </p>
            ) : null}
          </div>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}

export function ReceivablesPage() {
  const { tenant, tenant_user: tenantUser } = useAuth();
  const tenantId = tenant?.id ?? null;
  const currentTenantUserId = tenantUser?.id ?? null;
  const currentBranchId = tenantUser?.branch_id ?? tenantUser?.branchId ?? null;
  const canCreateReceivable = tenantUser?.role === 'owner';
  const [state, setState] = useState({
    receivables: [],
    installments: [],
    eventsByReceivableId: new Map(),
    partners: [],
    users: [],
    branches: [],
  });
  const [selectedId, setSelectedId] = useState(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCustomerSubmitting, setIsCustomerSubmitting] = useState(false);
  const [isSavingInstallment, setIsSavingInstallment] = useState(false);
  const [installmentError, setInstallmentError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const loadData = useCallback(async () => {
    if (!tenantId) return;

    try {
      const result = await receivablesApi.loadWorkspace(tenantId);
      setState(result);
    } catch (err) {
      console.error(err);
    }
  }, [tenantId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!successMessage) return undefined;
    const timeout = window.setTimeout(() => setSuccessMessage(''), 3500);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  useEffect(() => {
    if (!canCreateReceivable && isCreateOpen) {
      setIsCreateOpen(false);
    }
  }, [canCreateReceivable, isCreateOpen]);

  const selectedReceivable = useMemo(
    () => state.receivables.find((receivable) => receivable.id === selectedId) ?? null,
    [selectedId, state.receivables],
  );

  const recentReceivables = useMemo(() => (
    [...state.receivables].sort((left, right) => (
      new Date(right.opened_at || right.created_at || 0) - new Date(left.opened_at || left.created_at || 0)
    ))
  ), [state.receivables]);

  const handleAddInstallment = async (form) => {
    if (!selectedReceivable) return;

    setIsSavingInstallment(true);
    setInstallmentError('');
    try {
      await receivablesApi.addInstallment({
        ...form,
        tenantId,
        receivableId: selectedReceivable.id,
        createdBy: currentTenantUserId,
      });
      await loadData();
    } catch (err) {
      setInstallmentError(err.message || 'تعذر إضافة الاستحقاق.');
    } finally {
      setIsSavingInstallment(false);
    }
  };

  const handleCreateCustomer = async (payload) => {
    if (!tenantId) {
      return { ok: false, error: 'لا توجد شركة نشطة.' };
    }

    try {
      setIsCustomerSubmitting(true);
      const createdCustomer = await partnersService.createPartner({
        tenantId,
        ...payload,
        isCustomer: true,
        customerRank: 1,
        isSupplier: Boolean(payload.isSupplier),
        supplierRank: payload.isSupplier ? 1 : 0,
      });
      const normalizedCustomer = {
        ...createdCustomer,
        phone: createdCustomer.phone || createdCustomer.phone1 || createdCustomer.phone2 || '',
      };

      setState((current) => ({
        ...current,
        partners: [
          normalizedCustomer,
          ...current.partners.filter((partner) => partner.id !== normalizedCustomer.id),
        ],
      }));

      return { ok: true, customer: normalizedCustomer };
    } catch (err) {
      return { ok: false, error: err.message || 'تعذر إضافة العميل.' };
    } finally {
      setIsCustomerSubmitting(false);
    }
  };

  const handleManualReceivableCreated = async () => {
    await loadData();
    setSuccessMessage('تم حفظ المديونية اليدوية بنجاح.');
  };

  return (
    <section className="relative flex min-h-0 flex-1 flex-col items-stretch overflow-hidden text-white" dir="rtl">
      <style>{`
        @keyframes customerCareMobileSaleEntryIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .customer-care-operations-window {
          font-size: 0.94rem;
        }
        .customer-care-operations-window .text-xs {
          font-size: 0.72rem;
          line-height: 1.1rem;
        }
        .customer-care-operations-window .text-sm {
          font-size: 0.82rem;
          line-height: 1.25rem;
        }
        .customer-care-operations-window .text-lg {
          font-size: 1rem;
          line-height: 1.5rem;
        }
        .customer-care-operations-window .text-xl {
          font-size: 1.08rem;
          line-height: 1.55rem;
        }
        .customer-care-operations-window .sm\\:text-2xl {
          font-size: 1.2rem;
          line-height: 1.7rem;
        }
      `}</style>
      <div className="relative z-10 grid min-h-0 w-full max-w-none flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(18rem,0.72fr)_minmax(34rem,1.28fr)] lg:items-stretch lg:bg-[radial-gradient(circle_at_28%_18%,rgba(34,211,238,0.18)_0%,rgba(14,116,144,0.10)_32%,transparent_58%),linear-gradient(145deg,#17283a_0%,#101f30_52%,#0a1420_100%)]">
        <ReceivablesIntroPanel />
        <OperationsCard
          receivables={recentReceivables}
          onOpen={setSelectedId}
          onCreate={() => {
            if (canCreateReceivable) setIsCreateOpen(true);
          }}
          canCreate={canCreateReceivable}
        />
      </div>
      {successMessage ? (
        <div className="pointer-events-none absolute left-1/2 top-5 z-[140] w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-center text-sm font-black text-emerald-700 shadow-[0_18px_40px_rgba(15,23,42,0.16)]">
          {successMessage}
        </div>
      ) : null}

      {canCreateReceivable ? (
        <ReceivableCreateSheet
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          partners={state.partners}
          tenantId={tenantId}
          branchId={currentBranchId}
          createdBy={currentTenantUserId}
          onCreated={handleManualReceivableCreated}
          onCreateCustomer={handleCreateCustomer}
          isCustomerSubmitting={isCustomerSubmitting}
        />
      ) : null}

      <ReceivableDetailsSheet
        receivable={selectedReceivable}
        events={selectedReceivable ? state.eventsByReceivableId.get(selectedReceivable.id) ?? [] : []}
        open={Boolean(selectedReceivable)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setSelectedId(null);
            setInstallmentError('');
          }
        }}
        onAddInstallment={handleAddInstallment}
        isSavingInstallment={isSavingInstallment}
        installmentError={installmentError}
      />
    </section>
  );
}
