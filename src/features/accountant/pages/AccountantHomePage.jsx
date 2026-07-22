import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  Building2,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  History,
  ImagePlus,
  Landmark,
  Loader2,
  Plus,
  Receipt,
  Search,
  UserPlus,
  WalletCards,
  X,
} from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { PartnerFormSheet } from '@/features/contacts/components/PartnerFormSheet';
import { partnersService } from '@/features/contacts/services/partners.service';
import { CashLocationSheet } from '@/features/accountant/components/CashLocationSheet';
import { LedgerAccountOperationsSheet } from '@/features/accountant/components/LedgerAccountOperationsSheet';
import { accountantService } from '@/features/accountant/services/accountant.service';
import { ShowroomSaleViewSheet } from '@/features/showroom/components/ShowroomSaleViewSheet';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const NEW_CUSTOMER_INITIAL_VALUES = {
  isCustomer: true,
  isSupplier: false,
};

const partnerAvatarIconMap = {
  Building2,
  CircleDollarSign,
  CreditCard,
  Landmark,
  Receipt,
  WalletCards,
};

function isCashAccount(account) {
  const code = String(account?.code || '').trim();
  const type = String(account?.account_type || '').toLowerCase();
  return code.startsWith('111') || type === 'cash' || type === 'cash_equivalent';
}

function isReceivableAccount(account) {
  const code = String(account?.code || '').trim();
  const type = String(account?.account_type || '').toLowerCase();
  return code.startsWith('114') || type === 'receivable' || type === 'account_receivable';
}

function getDisplayAvatarConfig({ name, displayConfig }) {
  const avatar = displayConfig?.avatar && typeof displayConfig.avatar === 'object' ? displayConfig.avatar : {};
  const text = String(avatar.text || name || '-').trim().slice(0, 2) || '-';
  const radius = Number(avatar.radius);
  const size = Number(avatar.size);
  const fontSize = Number(avatar.fontSize);
  const fontWeight = Number(avatar.fontWeight);

  return {
    text,
    type: avatar.type || (avatar.imageUrl || avatar.url || avatar.src ? 'image' : avatar.icon ? 'icon' : 'text'),
    icon: typeof avatar.icon === 'string' ? avatar.icon : '',
    imageUrl: avatar.imageUrl || avatar.url || avatar.src || '',
    bg: typeof avatar.bg === 'string' && avatar.bg.trim() ? avatar.bg : '#0F766E',
    color: typeof avatar.color === 'string' && avatar.color.trim() ? avatar.color : '#FFFFFF',
    shape: avatar.shape === 'rounded' ? 'rounded' : 'circle',
    radius: Number.isFinite(radius) ? radius : null,
    size: Number.isFinite(size) ? size : null,
    fontSize: Number.isFinite(fontSize) ? fontSize : null,
    fontWeight: Number.isFinite(fontWeight) ? fontWeight : null,
  };
}

function PartnerDisplayAvatar({ name, displayConfig, className = 'h-12 w-12 text-base', maxSize = null }) {
  const avatar = getDisplayAvatarConfig({ name, displayConfig });
  const Icon = partnerAvatarIconMap[avatar.icon] || null;
  const radiusStyle = avatar.radius != null
    ? { borderRadius: avatar.radius }
    : {};
  const configuredSize = avatar.size != null && maxSize != null
    ? Math.min(avatar.size, maxSize)
    : avatar.size;
  const sizeStyle = configuredSize != null
    ? { width: configuredSize, height: configuredSize }
    : {};

  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden font-black shadow-sm ring-1 ring-slate-200 ${
        avatar.radius == null && (avatar.shape === 'circle' ? 'rounded-full' : 'rounded-xl')
      } ${className}`}
      style={{
        backgroundColor: avatar.bg,
        color: avatar.color,
        fontSize: avatar.fontSize || undefined,
        fontWeight: avatar.fontWeight || undefined,
        ...radiusStyle,
        ...sizeStyle,
      }}
    >
      {avatar.type === 'image' && avatar.imageUrl ? (
        <img src={avatar.imageUrl} alt="" className="h-full w-full object-cover" />
      ) : avatar.type === 'icon' && Icon ? (
        <Icon className="h-1/2 w-1/2" />
      ) : (
        avatar.text
      )}
    </span>
  );
}

const approvalStatusMeta = {
  review: { label: 'قيد المراجعة', className: 'bg-amber-50 text-amber-700 ring-amber-100' },
  approved: { label: 'معتمد', className: 'bg-emerald-50 text-emerald-700 ring-emerald-100' },
  rejected: { label: 'مرفوض', className: 'bg-red-50 text-red-700 ring-red-100' },
};

function formatCurrency(value) {
  return `${Number(value ?? 0).toLocaleString('ar-EG')} ج.م`;
}

function useIsMobileViewport() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);

    update();
    media.addEventListener('change', update);

    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
}

function PaymentApprovalForm({
  tenantId,
  branchId,
  tenantUserId,
  step,
  setStep,
  selectedCustomer,
  selectedPaymentEntity,
  onSelectCustomer,
  onSelectPaymentEntity,
  onCreated,
  onClose,
  resetSignal = 0,
  entityResetSignal = 0,
}) {
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [customersError, setCustomersError] = useState('');
  const [paymentEntities, setPaymentEntities] = useState([]);
  const [selectedPaymentEntityId, setSelectedPaymentEntityId] = useState('');
  const [isLoadingPaymentEntities, setIsLoadingPaymentEntities] = useState(false);
  const [paymentEntitiesError, setPaymentEntitiesError] = useState('');
  const [isCustomerSheetOpen, setIsCustomerSheetOpen] = useState(false);
  const [isCustomerSubmitting, setIsCustomerSubmitting] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const transitionTimerRef = useRef(null);

  useEffect(() => {
    setCustomerSearch('');
    setSelectedPaymentEntityId('');
    setAmount('');
    setNote('');
    setAttachmentFile(null);
    setSubmitError('');
    onSelectPaymentEntity(null);
  }, [resetSignal]);

  useEffect(() => {
    setSelectedPaymentEntityId('');
    setAmount('');
    setNote('');
    setAttachmentFile(null);
    setSubmitError('');
  }, [entityResetSignal]);

  useEffect(() => () => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (step === 2 || !transitionTimerRef.current) return;
    window.clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = null;
  }, [step]);

  useEffect(() => {
    let mounted = true;

    setIsLoadingCustomers(true);
    setCustomersError('');

    partnersService
      .getPartners({ tenantId, filterType: 'customer', status: 'active' })
      .then((loadedCustomers) => {
        if (!mounted) return;
        setCustomers(loadedCustomers);
      })
      .catch((error) => {
        if (!mounted) return;
        setCustomers([]);
        setCustomersError(error?.message || 'تعذر تحميل العملاء.');
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingCustomers(false);
      });

    return () => {
      mounted = false;
    };
  }, [tenantId]);

  useEffect(() => {
    if (step !== 1) return undefined;

    let mounted = true;

    setIsLoadingPaymentEntities(true);
    setPaymentEntitiesError('');

    partnersService
      .getFinancerPartners({ tenantId })
      .then((loadedEntities) => {
        if (!mounted) return;
        setPaymentEntities(loadedEntities);
      })
      .catch((error) => {
        if (!mounted) return;
        setPaymentEntities([]);
        setPaymentEntitiesError(error?.message || 'تعذر تحميل جهات الدفع.');
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingPaymentEntities(false);
      });

    return () => {
      mounted = false;
    };
  }, [tenantId, step]);

  const normalizedSearch = customerSearch.trim().toLowerCase();
  const filteredCustomers = normalizedSearch
    ? customers.filter((customer) => {
      const name = String(customer?.name ?? '').toLowerCase();
      const phone = String(customer?.phone ?? customer?.phone1 ?? '').toLowerCase();
      return name.includes(normalizedSearch) || phone.includes(normalizedSearch);
    })
    : customers.slice(0, 8);

  const selectCustomer = (customer) => {
    onSelectCustomer(customer);
    setCustomerSearch(customer?.name || '');
    setStep(1);
  };

  const selectPaymentEntity = (entity) => {
    if (transitionTimerRef.current) {
      window.clearTimeout(transitionTimerRef.current);
    }

    setSelectedPaymentEntityId(entity.id);
    onSelectPaymentEntity(entity);
    setStep(2);
    transitionTimerRef.current = window.setTimeout(() => {
      setStep(3);
      transitionTimerRef.current = null;
    }, 750);
  };

  const handleCreateCustomer = async (payload) => {
    setIsCustomerSubmitting(true);

    try {
      const customer = await partnersService.createPartner({
        ...payload,
        tenantId,
        isCustomer: true,
        isSupplier: false,
      });

      setCustomers((current) => [
        customer,
        ...current.filter((item) => item.id !== customer.id),
      ]);
      selectCustomer(customer);
      setIsCustomerSheetOpen(false);

      return { ok: true, customer };
    } catch (error) {
      return { ok: false, error: error?.message || 'تعذر إضافة العميل.' };
    } finally {
      setIsCustomerSubmitting(false);
    }
  };

  const handleSubmitApproval = async () => {
    setSubmitError('');
    setIsSubmitting(true);

    try {
      const result = await accountantService.createPaymentEntityCustomerCredit({
        tenantId,
        branchId,
        userId: tenantUserId,
        customerId: selectedCustomer?.id,
        paymentEntityId: selectedPaymentEntity?.id,
        amount,
        note,
        attachmentFile,
      });

      onCreated?.({
        id: result?.move_id || crypto.randomUUID(),
        entityId: selectedPaymentEntity?.id,
        customerId: selectedCustomer?.id,
        customerName: selectedCustomer?.name || 'عميل بدون اسم',
        entityName: selectedPaymentEntity?.name || 'جهة دفع',
        entityDisplayConfig: selectedPaymentEntity?.displayConfig ?? selectedPaymentEntity?.display_config ?? null,
        amount: Number(result?.amount ?? amount),
        status: 'approved',
        dateLabel: 'الآن',
        note: note?.trim() || 'تم تسجيل القيد المحاسبي.',
      });
      onClose?.();
    } catch (error) {
      setSubmitError(error?.message || 'تعذر تسجيل العملية.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <form className="flex min-h-0 flex-1 flex-col" dir="rtl" onSubmit={(event) => event.preventDefault()}>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 0 ? (
            <div className="space-y-5">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    id="payment-approval-customer"
                    value={customerSearch}
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    placeholder="ابحث باسم العميل أو رقم الهاتف"
                    className="pr-10"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setIsCustomerSheetOpen(true)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200"
                  aria-label="إضافة عميل جديد"
                  title="إضافة عميل جديد"
                >
                  <UserPlus className="h-5 w-5" />
                </button>
              </div>

              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {isLoadingCustomers ? (
                  <div className="px-4 py-8 text-center text-sm font-bold text-slate-500">جاري تحميل العملاء...</div>
                ) : customersError ? (
                  <div className="px-4 py-8 text-center text-sm font-bold text-red-600">{customersError}</div>
                ) : filteredCustomers.length ? (
                  <div className="divide-y divide-slate-100">
                    {filteredCustomers.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => selectCustomer(customer)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-right transition hover:bg-slate-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-black text-slate-950">{customer.name || 'عميل بدون اسم'}</span>
                          <span className="mt-0.5 block truncate text-xs font-bold text-slate-500">{customer.phone || customer.phone1 || 'بدون رقم هاتف'}</span>
                        </span>
                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">اختيار</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-8 text-center text-sm font-bold text-slate-500">لا توجد نتائج مطابقة.</div>
                )}
              </div>
            </div>
          ) : step === 1 ? (
            <div className="flex min-h-full flex-col gap-4">
              <div className="px-1 text-right">
                <div className="min-w-0 text-right">
                  <p className="text-sm font-black text-slate-950">اختر الجهه التي ستتحمل المديونيه بدلا من العميل</p>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {isLoadingPaymentEntities ? (
                  <div className="flex h-full min-h-56 items-center justify-center px-4 text-center text-sm font-bold text-slate-500">
                    جاري تحميل جهات الدفع...
                  </div>
                ) : paymentEntitiesError ? (
                  <div className="flex h-full min-h-56 items-center justify-center px-4 text-center text-sm font-bold text-red-600">
                    {paymentEntitiesError}
                  </div>
                ) : paymentEntities.length ? (
                  <div className="grid grid-cols-4 gap-x-3 gap-y-5 pb-2 pt-1">
                    {paymentEntities.map((entity) => {
                      const isSelected = selectedPaymentEntityId === entity.id;

                      return (
                        <button
                          key={entity.id}
                          type="button"
                          onClick={() => selectPaymentEntity(entity)}
                          className="group flex min-w-0 flex-col items-center gap-2 rounded-xl px-1 py-2 text-center transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                          title={entity.name || 'جهة دفع بدون اسم'}
                        >
                          <PartnerDisplayAvatar
                            name={entity.name}
                            displayConfig={entity.displayConfig ?? entity.display_config}
                            className={`h-14 w-14 text-lg transition group-hover:-translate-y-0.5 ${
                              isSelected ? 'ring-4 ring-emerald-100' : 'ring-1 ring-slate-200/70'
                            }`}
                          />
                          <span className={`line-clamp-2 min-h-[2rem] w-full text-xs font-black leading-4 ${
                            isSelected ? 'text-emerald-700' : 'text-slate-700'
                          }`}>
                            {entity.name || 'جهة دفع بدون اسم'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full min-h-56 items-center justify-center px-5 text-center text-sm font-bold text-slate-500">
                    لا توجد جهات دفع نشطة مسجلة حاليًا.
                  </div>
                )}
              </div>
            </div>
          ) : step === 2 ? (
            <div className="-mx-6 -my-5 flex min-h-[calc(100%+2.5rem)] flex-1 items-center justify-center bg-white/95">
              <Loader2 className="h-10 w-10 animate-spin text-emerald-600" />
            </div>
          ) : (
            <div>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="payment-approval-amount" className="flex flex-wrap items-center gap-1 text-xs font-black text-slate-600">
                    <span>المبلغ</span>
                    <span className="font-bold text-slate-400">
                      (في حالة كيان فقط اكتب المبلغ بدون خصم الضريبه اما اي جهة اخري اكتب صافي المبلغ الفعلي الذي سنستلمه من الشركه)
                    </span>
                  </Label>
                  <Input
                    id="payment-approval-amount"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    placeholder="0.00"
                    className="h-12 text-base font-black"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="payment-approval-image" className="text-xs font-black text-slate-600">الصورة</Label>
                    <label
                      htmlFor="payment-approval-image"
                      className="flex min-h-36 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-center transition hover:border-emerald-300 hover:bg-emerald-50/50"
                    >
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm">
                        <ImagePlus className="h-5 w-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-black text-slate-900">
                          {attachmentFile ? attachmentFile.name : 'إرفاق صورة'}
                        </span>
                        <span className="mt-1 block text-xs font-bold text-slate-500">صورة إيصال أو مستند الاعتماد</span>
                      </span>
                      <input
                        id="payment-approval-image"
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)}
                      />
                    </label>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="payment-approval-note" className="text-xs font-black text-slate-600">الملاحظه</Label>
                    <textarea
                      id="payment-approval-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="اكتب ملاحظة مختصرة"
                      rows={4}
                      className="min-h-36 w-full resize-none rounded-xl border border-input bg-background px-3 py-3 text-sm font-bold text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-ring focus:ring-4 focus:ring-ring/15"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        {step === 3 ? (
          <div className="space-y-3 px-6 pb-5 pt-1">
            {submitError ? (
              <div className="rounded-xl bg-red-50 px-3 py-2 text-right text-xs font-bold leading-5 text-red-700">
                {submitError}
              </div>
            ) : null}
            <Button
              type="button"
              onClick={handleSubmitApproval}
              disabled={isSubmitting}
              className="h-12 w-full rounded-xl bg-emerald-600 text-sm font-black text-white shadow-sm hover:bg-emerald-700"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري التسجيل...
                </>
              ) : 'تأكيد'}
            </Button>
          </div>
        ) : null}
      </form>

      <PartnerFormSheet
        open={isCustomerSheetOpen}
        onOpenChange={setIsCustomerSheetOpen}
        initialValues={NEW_CUSTOMER_INITIAL_VALUES}
        onSubmit={handleCreateCustomer}
        isSubmitting={isCustomerSubmitting}
        side="right"
        hideTypeFields
        hideCompanyFields
        hideAccountingFields
        hideFooterNote
        hideCancelButton
        accentHeader
        hideDismissButton
        inlineSubmit
      />
    </>
  );
}

function SelectedCustomerHeader({ customer, paymentEntity, onBack }) {
  if (!customer) return null;

  return (
    <div className="mt-4 flex items-center gap-3 rounded-xl bg-emerald-50 px-3 py-3 text-right">
      <button
        type="button"
        onClick={onBack}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-emerald-700 shadow-sm transition hover:bg-emerald-100 focus:outline-none focus:ring-4 focus:ring-emerald-100"
        aria-label="الرجوع لاختيار عميل"
        title="الرجوع لاختيار عميل"
      >
        <ChevronRight className="h-5 w-5" />
      </button>
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-emerald-700">العميل المحدد</p>
          <p className="mt-0.5 truncate text-sm font-black text-emerald-950">{customer.name || '--'}</p>
        </div>
        {paymentEntity ? (
          <div className="flex min-w-0 items-center gap-2 border-r border-emerald-100 pr-3">
            <PartnerDisplayAvatar
              name={paymentEntity.name}
              displayConfig={paymentEntity.displayConfig ?? paymentEntity.display_config}
              className="h-8 w-8 text-xs"
            />
            <div className="min-w-0">
              <p className="text-xs font-bold text-emerald-700">الجهة المحددة</p>
              <p className="mt-0.5 truncate text-sm font-black text-emerald-950">{paymentEntity.name || '--'}</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PaymentApprovalDialog({ open, onOpenChange, tenantId, branchId, tenantUserId, onCreated }) {
  const isMobile = useIsMobileViewport();
  const [step, setStep] = useState(0);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedPaymentEntity, setSelectedPaymentEntity] = useState(null);
  const [customerResetSignal, setCustomerResetSignal] = useState(0);
  const [paymentEntityResetSignal, setPaymentEntityResetSignal] = useState(0);

  useEffect(() => {
    if (open) return;
    setStep(0);
    setSelectedCustomer(null);
    setSelectedPaymentEntity(null);
  }, [open]);

  const handleStepBack = () => {
    if (step >= 2) {
      setStep(1);
      setSelectedPaymentEntity(null);
      setPaymentEntityResetSignal((current) => current + 1);
      return;
    }

    setStep(0);
    setSelectedCustomer(null);
    setSelectedPaymentEntity(null);
    setCustomerResetSignal((current) => current + 1);
  };

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="accountant-approval-sheet h-full w-full max-w-full border-l-0 p-0" dir="rtl">
          <SheetHeader className="border-b-0 pr-6">
            <SheetTitle>اعتماد دفعه من جهه</SheetTitle>
            <SelectedCustomerHeader customer={selectedCustomer} paymentEntity={selectedPaymentEntity} onBack={handleStepBack} />
          </SheetHeader>
          <SheetBody className="flex min-h-0 flex-1 p-0">
            <PaymentApprovalForm
              tenantId={tenantId}
              branchId={branchId}
              tenantUserId={tenantUserId}
              step={step}
              setStep={setStep}
              selectedCustomer={selectedCustomer}
              selectedPaymentEntity={selectedPaymentEntity}
              onSelectCustomer={setSelectedCustomer}
              onSelectPaymentEntity={setSelectedPaymentEntity}
              onCreated={onCreated}
              onClose={() => onOpenChange(false)}
              resetSignal={customerResetSignal}
              entityResetSignal={paymentEntityResetSignal}
            />
          </SheetBody>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="accountant-approval-overlay fixed inset-0 z-50 bg-slate-950/35 backdrop-blur-sm" />
        <Dialog.Content
          className="accountant-approval-dialog-content fixed left-1/2 top-1/2 z-50 flex h-[min(38rem,88vh)] w-[min(calc(100vw-2rem),34rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
          dir="rtl"
        >
          <div className="flex items-start justify-between gap-4 px-6 py-5">
            <div className="min-w-0 text-right">
              <Dialog.Title className="text-xl font-black text-slate-950">اعتماد دفعه من جهه</Dialog.Title>
              <SelectedCustomerHeader customer={selectedCustomer} paymentEntity={selectedPaymentEntity} onBack={handleStepBack} />
            </div>
            <Dialog.Close className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <PaymentApprovalForm
            tenantId={tenantId}
            branchId={branchId}
            tenantUserId={tenantUserId}
            step={step}
            setStep={setStep}
            selectedCustomer={selectedCustomer}
            selectedPaymentEntity={selectedPaymentEntity}
            onSelectCustomer={setSelectedCustomer}
            onSelectPaymentEntity={setSelectedPaymentEntity}
            onCreated={onCreated}
            onClose={() => onOpenChange(false)}
            resetSignal={customerResetSignal}
            entityResetSignal={paymentEntityResetSignal}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ApprovalOperationRow({ operation, compact = false }) {
  const status = approvalStatusMeta[operation.status] || approvalStatusMeta.review;

  return (
    <article className={`flex items-center text-right ${compact ? 'gap-2.5 px-4 py-2.5' : 'gap-3 px-5 py-3'}`}>
      <PartnerDisplayAvatar
        name={operation.entityName}
        displayConfig={operation.entityDisplayConfig}
        className={compact
          ? 'h-6 w-6 max-h-6 max-w-6 text-[9px]'
          : 'h-7 w-7 max-h-7 max-w-7 text-[10px]'}
        maxSize={compact ? 24 : 28}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={`truncate font-black text-slate-900 ${compact ? 'text-[13px]' : 'text-sm'}`}>
            {operation.entityName || 'جهة غير محددة'}
          </p>
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-black ring-1 ring-inset ${status.className}`}>
            {status.label}
          </span>
        </div>
        <p className={`mt-0.5 truncate font-bold text-slate-500 ${compact ? 'text-[11px]' : 'text-xs'}`}>
          {operation.customerName || 'عميل غير محدد'}{operation.dateLabel ? ` · ${operation.dateLabel}` : ''}
        </p>
      </div>
      <p className={`ml-1.5 shrink-0 font-black text-slate-950 ${compact ? 'text-[13px]' : 'text-sm'}`}>
        {formatCurrency(operation.amount)}
      </p>
    </article>
  );
}

function InvoiceSettlementDialog({ open, onOpenChange, tenantId, invoice, onSettled }) {
  const [mode, setMode] = useState('cash');
  const [accounts, setAccounts] = useState([]);
  const [destinationAccountId, setDestinationAccountId] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;

    setMode('cash');
    setDestinationAccountId('');
    setAmount(String(invoice?.remainingAmount || ''));
    setNotes('');
    setError('');
  }, [invoice?.id, invoice?.remainingAmount, open]);

  useEffect(() => {
    let mounted = true;
    if (!open || !tenantId) return undefined;

    setIsLoadingAccounts(true);
    accountantService.listSettlementAccounts({ tenantId })
      .then((records) => {
        if (mounted) setAccounts(records);
      })
      .catch((loadError) => {
        if (mounted) setError(loadError.message || 'تعذر تحميل حسابات التسوية.');
      })
      .finally(() => {
        if (mounted) setIsLoadingAccounts(false);
      });

    return () => {
      mounted = false;
    };
  }, [open, tenantId]);

  const selectedAccount = accounts.find((account) => account.id === destinationAccountId) || null;
  const safeAmount = Number(amount || 0);
  const remainingAmount = Number(invoice?.remainingAmount || 0);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');

    if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
      setError('اكتب مبلغ صحيح أكبر من صفر.');
      return;
    }
    if (safeAmount > remainingAmount) {
      setError('المبلغ أكبر من المتبقي على الفاتورة.');
      return;
    }
    if (mode === 'account' && !destinationAccountId) {
      setError('اختر حساب التسوية.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await accountantService.settleSalesInvoiceBalance({
        tenantId,
        saleId: invoice.id,
        amount: safeAmount,
        mode,
        destinationAccountId,
        notes,
      });
      onSettled?.(result);
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError.message || 'تعذر تسجيل التسوية.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <Dialog.Portal>
        <Dialog.Overlay className="accountant-approval-overlay fixed inset-0 z-[2147483640] bg-slate-950/50 backdrop-blur-sm" />
        <Dialog.Content
          className="accountant-approval-dialog-content fixed left-1/2 top-1/2 z-[2147483641] flex max-h-[90vh] w-[min(calc(100vw-1.5rem),31rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl outline-none"
          dir="rtl"
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-lg font-black text-slate-950">تسوية الرصيد</Dialog.Title>
              <p className="mt-1 truncate text-xs font-bold text-slate-500">{invoice?.customerName || 'عميل غير محدد'}</p>
            </div>
            <Dialog.Close className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="min-h-0 overflow-y-auto p-5">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-red-50 px-4 py-3">
              <span className="text-xs font-black text-red-700">المتبقي على الفاتورة</span>
              <span className="text-lg font-black text-red-700">{formatCurrency(remainingAmount)}</span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              {[
                { id: 'cash', label: 'تحصيل نقدي', detail: 'إيداع في الخزنة الرئيسية 111001', icon: WalletCards },
                { id: 'account', label: 'تسوية على حساب', detail: 'اختيار حساب مقابل', icon: Landmark },
              ].map((option) => {
                const Icon = option.icon;
                const isActive = mode === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setMode(option.id)}
                    className={`rounded-xl border p-3 text-right transition ${
                      isActive ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-100' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <Icon className={`h-4 w-4 ${isActive ? 'text-blue-700' : 'text-slate-500'}`} />
                    <span className="mt-2 block text-sm font-black text-slate-900">{option.label}</span>
                    <span className="mt-0.5 block text-[10px] font-bold text-slate-500">{option.detail}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 space-y-4">
              {mode === 'account' ? (
                <div className="space-y-2">
                  <Label htmlFor="settlement-account" className="text-xs font-black text-slate-600">حساب التسوية</Label>
                  <select
                    id="settlement-account"
                    value={destinationAccountId}
                    onChange={(event) => setDestinationAccountId(event.target.value)}
                    disabled={isLoadingAccounts}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="">{isLoadingAccounts ? 'جاري تحميل الحسابات...' : 'اختر الحساب'}</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div className="grid grid-cols-[0.8fr_1.2fr] gap-3">
                <div className="min-w-0 space-y-2">
                  <Label htmlFor="settlement-amount" className="text-xs font-black text-slate-600">المبلغ</Label>
                  <Input
                    id="settlement-amount"
                    type="number"
                    min="0.01"
                    max={remainingAmount}
                    step="0.01"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="h-11 rounded-xl text-left text-base font-black"
                    dir="ltr"
                  />
                </div>

                <div className="min-w-0 space-y-2">
                  <Label htmlFor="settlement-notes" className="text-xs font-black text-slate-600">البيان</Label>
                  <Input
                    id="settlement-notes"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="سبب أو مرجع التسوية"
                    className="h-11 rounded-xl text-sm font-bold"
                  />
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-[10px] font-black text-slate-500">معاينة القيد</p>
              <div className="mt-2 space-y-1.5 text-xs font-bold">
                <div className="flex items-center justify-between gap-3 text-emerald-700">
                  <span>مدين: {mode === 'cash' ? '111001 — الخزنة الرئيسية' : selectedAccount ? `${selectedAccount.code} — ${selectedAccount.name}` : 'حساب التسوية'}</span>
                  <span>{formatCurrency(safeAmount)}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-red-700">
                  <span>دائن: 114001 — ذمم العملاء</span>
                  <span>{formatCurrency(safeAmount)}</span>
                </div>
              </div>
            </div>

            {error ? <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}

            <Button
              type="submit"
              disabled={isSubmitting}
              className="mt-4 h-11 w-full rounded-xl bg-blue-700 text-sm font-black text-white hover:bg-blue-800"
            >
              {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> جاري التسجيل...</> : mode === 'cash' ? 'تسجيل التحصيل' : 'اعتماد التسوية'}
            </Button>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ApprovalOperationsDrawer({
  open,
  onOpenChange,
  onCreateOperation,
  operations = [],
  isLoading = false,
  total = 0,
  isLoadingTotal = false,
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-full border-l-0 bg-white p-0 sm:max-w-xl" dir="rtl">
        <SheetHeader className="border-b-0 px-5 pb-3 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <SheetClose
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200 focus:outline-none focus:ring-4 focus:ring-slate-200"
                aria-label="رجوع"
                title="رجوع"
              >
                <ChevronRight className="h-5 w-5" />
              </SheetClose>
              <div className="min-w-0">
                <SheetTitle className="text-lg font-black">رصيدك عند الجهات</SheetTitle>
                <p className="mt-0.5 truncate text-xs font-bold text-slate-500">كل عمليات الاعتماد المسجلة لدى جهات الدفع</p>
              </div>
            </div>
            <Button
              type="button"
              onClick={onCreateOperation}
              className="h-9 shrink-0 rounded-xl bg-slate-950 px-3 text-xs font-black text-white hover:bg-slate-800"
              title="إضافة اعتماد جديد"
            >
              <Plus className="h-4 w-4" />
              إضافة
            </Button>
          </div>
        </SheetHeader>

        <SheetBody className="px-5 pb-6 pt-1">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-950">آخر العمليات</p>
                <p className="mt-1 text-xs font-bold text-slate-500">مرتبة من الأحدث إلى الأقدم.</p>
              </div>
              <div className="min-w-0 shrink-0 text-left">
                <p className="truncate text-base font-black text-slate-950">
                  {isLoadingTotal ? '...' : formatCurrency(total)}
                </p>
              </div>
            </div>
            {isLoading ? (
              <div className="flex min-h-40 items-center justify-center text-sm font-black text-slate-500">
                جاري تحميل عمليات الجهات...
              </div>
            ) : operations.length ? (
              <div className="divide-y divide-slate-100">
                {operations.map((operation) => (
                  <ApprovalOperationRow key={operation.id} operation={operation} />
                ))}
              </div>
            ) : (
              <div className="bg-slate-50 px-5 py-10 text-center">
                <p className="text-sm font-black text-slate-700">لا توجد عمليات اعتماد مسجلة.</p>
                <p className="mt-1 text-xs font-bold text-slate-500">اضغط إضافة لتسجيل أول عملية.</p>
              </div>
            )}
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function SalesInvoicesDrawer({
  open,
  onOpenChange,
  invoices = [],
  isLoading = false,
  total = 0,
  onInvoiceSelect,
  shouldKeepOpen,
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && shouldKeepOpen?.()) return;
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent
        side="right"
        className="w-full max-w-full border-l-0 bg-white p-0 sm:max-w-xl"
        dir="rtl"
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          event.preventDefault();
          if (!shouldKeepOpen?.()) onOpenChange(false);
        }}
        onFocusOutside={(event) => {
          event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (!shouldKeepOpen?.()) onOpenChange(false);
        }}
      >
        <SheetHeader className="border-b border-slate-200 px-5 pb-4 pt-5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 transition hover:bg-slate-200 focus:outline-none focus:ring-4 focus:ring-slate-200"
              aria-label="رجوع"
              title="رجوع"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-lg font-black">ذمم فواتير المبيعات</SheetTitle>
              <p className="mt-0.5 truncate text-xs font-bold text-slate-500">الفواتير التي ما زالت عليها مبالغ مستحقة</p>
            </div>
            <div className="shrink-0 text-left">
              <p className="text-[10px] font-bold text-slate-500">إجمالي الذمم</p>
              <p className="mt-0.5 text-sm font-black text-red-600">{isLoading ? '...' : formatCurrency(total)}</p>
            </div>
          </div>
        </SheetHeader>

        <SheetBody className="px-5 pb-6 pt-4">
          {isLoading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm font-black text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري تحميل فواتير المبيعات...
            </div>
          ) : invoices.length ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="divide-y divide-slate-100">
                {invoices.map((invoice) => (
                  <button
                    key={invoice.id}
                    type="button"
                    onClick={() => onInvoiceSelect?.(invoice)}
                    className="flex w-full items-center gap-3 px-4 py-3.5 text-right transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-100"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                      <Receipt className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-black text-slate-900">{invoice.customerName}</p>
                      <p className="mt-0.5 truncate text-xs font-bold text-slate-600">
                        {invoice.productNames?.length ? invoice.productNames.join('، ') : 'منتج غير محدد'}
                      </p>
                      <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">
                        {invoice.saleNumber ? `فاتورة ${invoice.saleNumber}` : 'فاتورة مبيعات'}
                        {invoice.saleDate ? ` · ${new Date(invoice.saleDate).toLocaleDateString('ar-EG')}` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-left">
                      <p className="text-sm font-black text-red-600">عليه {formatCurrency(invoice.remainingAmount)}</p>
                      <p className="mt-0.5 text-[10px] font-bold text-slate-500">من إجمالي {formatCurrency(invoice.totalAmount)}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 rotate-180 text-slate-300" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
              <p className="text-sm font-black text-slate-700">لا توجد فواتير عليها مبالغ مستحقة.</p>
              <p className="mt-1 text-xs font-bold text-slate-500">كل فواتير المبيعات مسددة حاليًا.</p>
            </div>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

const accountTypeLabels = {
  asset: 'أصول',
  current_asset: 'أصل متداول',
  asset_current: 'أصل متداول',
  non_current_asset: 'أصل غير متداول',
  liability: 'التزامات',
  current_liability: 'التزام متداول',
  liability_current: 'التزام متداول',
  equity: 'حقوق ملكية',
  income: 'إيرادات',
  revenue: 'إيرادات',
  expense: 'مصروفات',
  receivable: 'ذمم مدينة',
  payable: 'ذمم دائنة',
  cash: 'نقدية',
  cash_equivalent: 'نقدية وما في حكمها',
};

function suggestNextAccountCode(accounts, group) {
  if (!group?.id) return '';

  const numericCodes = (accounts || [])
    .filter((account) => account.group_id === group.id && /^\d+$/.test(String(account.code || '').trim()))
    .map((account) => String(account.code).trim());

  if (numericCodes.length) {
    const latestCode = numericCodes.reduce((latest, code) => (
      Number(code) > Number(latest) ? code : latest
    ));
    return String(Number(latestCode) + 1).padStart(latestCode.length, '0');
  }

  if (String(group.code || '').trim().toUpperCase() === 'TEMP') return '700001';

  const numericGroupCode = String(group.code || '').replace(/\D/g, '');
  if (!numericGroupCode) return '';

  const standardCodeLength = Math.max(
    6,
    ...(accounts || [])
      .map((account) => String(account.code || '').trim())
      .filter((accountCode) => /^\d+$/.test(accountCode))
      .map((accountCode) => accountCode.length),
  );
  const rangeStart = numericGroupCode.padEnd(standardCodeLength, '0');
  return String(Number(rangeStart) + 1).padStart(standardCodeLength, '0');
}

function TemporaryAccountDialog({ open, onOpenChange, tenantId, initialGroupId, onCreated }) {
  const [options, setOptions] = useState({ groups: [], accounts: [], accountTypes: [] });
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [name, setName] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [isGroupListOpen, setIsGroupListOpen] = useState(false);
  const [code, setCode] = useState('');
  const [accountType, setAccountType] = useState('');
  const [reconcile, setReconcile] = useState(true);
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !tenantId) return;

    let mounted = true;
    setName('');
    setSelectedGroupId('');
    setGroupSearch('');
    setCode('');
    setAccountType('');
    setReconcile(true);
    setActive(true);
    setError('');
    setIsSubmitting(false);
    setIsLoadingOptions(true);

    accountantService.getAccountCreationOptions({ tenantId })
      .then((nextOptions) => {
        if (!mounted) return;
        setOptions(nextOptions);
        const initialGroup = nextOptions.groups.find((group) => group.id === initialGroupId) || null;
        if (initialGroup) {
          setSelectedGroupId(initialGroup.id);
          setGroupSearch(initialGroup.name);
          setCode(suggestNextAccountCode(nextOptions.accounts, initialGroup));
        }

        const groupTypes = nextOptions.accounts
          .filter((account) => account.group_id === initialGroup?.id)
          .map((account) => account.account_type)
          .filter(Boolean);
        setAccountType(groupTypes[0] || nextOptions.accountTypes[0] || '');
      })
      .catch((loadError) => {
        if (!mounted) return;
        setOptions({ groups: [], accounts: [], accountTypes: [] });
        setError(loadError.message || 'تعذر تحميل بيانات إنشاء الحساب.');
      })
      .finally(() => {
        if (mounted) setIsLoadingOptions(false);
      });

    return () => {
      mounted = false;
    };
  }, [open, tenantId, initialGroupId]);

  const normalizedGroupSearch = groupSearch.trim().toLowerCase();
  const filteredGroups = options.groups.filter((group) => (
    !normalizedGroupSearch
    || String(group.name || '').toLowerCase().includes(normalizedGroupSearch)
    || String(group.code || '').toLowerCase().includes(normalizedGroupSearch)
  ));

  const selectGroup = (group) => {
    setSelectedGroupId(group.id);
    setGroupSearch(group.name);
    setCode(suggestNextAccountCode(options.accounts, group));
    const groupType = options.accounts.find((account) => account.group_id === group.id)?.account_type;
    setAccountType(groupType || options.accountTypes[0] || '');
    setIsGroupListOpen(false);
    setError('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!name.trim()) return setError('اسم الحساب مطلوب.');
    if (!selectedGroupId) return setError('اختر مجموعة الحساب.');
    if (!code.trim()) return setError('كود الحساب مطلوب.');
    if (!accountType) return setError('اختر نوع الحساب.');

    setIsSubmitting(true);
    setError('');
    try {
      const account = await accountantService.createTemporaryAccount({
        tenantId,
        groupId: selectedGroupId,
        code,
        name,
        accountType,
        reconcile,
        active,
      });
      onCreated?.(account, selectedGroupId);
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError.message || 'تعذر إنشاء الحساب.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[120] bg-slate-950/45 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[121] max-h-[calc(100vh-1.5rem)] w-[min(calc(100vw-1.5rem),32rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl outline-none" dir="rtl">
          <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
            <div>
              <Dialog.Title className="text-lg font-black text-slate-950">إضافة حساب محاسبي</Dialog.Title>
              <Dialog.Description className="mt-1 text-xs font-bold text-slate-500">أدخل بيانات الحساب وحدد مجموعته المحاسبية.</Dialog.Description>
            </div>
            <Dialog.Close className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition hover:bg-slate-200">
              <X className="h-4 w-4" />
              <span className="sr-only">إغلاق</span>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 p-5">
            <div className="space-y-2">
              <Label htmlFor="temporary-account-name" className="font-black">اسم الحساب *</Label>
              <Input id="temporary-account-name" value={name} onChange={(event) => setName(event.target.value)} disabled={isSubmitting || isLoadingOptions} placeholder="تسويات تحصيلات فواتير المبيعات" autoComplete="off" />
            </div>

            <div className="relative space-y-2">
              <Label htmlFor="temporary-account-group-search" className="font-black">مجموعة الحساب *</Label>
              <Input
                id="temporary-account-group-search"
                value={groupSearch}
                onChange={(event) => {
                  setGroupSearch(event.target.value);
                  setSelectedGroupId('');
                  setIsGroupListOpen(true);
                }}
                onFocus={() => setIsGroupListOpen(true)}
                disabled={isSubmitting || isLoadingOptions}
                placeholder={isLoadingOptions ? 'جاري تحميل المجموعات...' : 'ابحث عن مجموعة الحساب'}
                autoComplete="off"
              />
              {isGroupListOpen && !isLoadingOptions ? (
                <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-44 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                  {filteredGroups.length ? filteredGroups.map((group) => (
                    <button key={group.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectGroup(group)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-right text-sm font-bold text-slate-700 transition hover:bg-slate-50">
                      <span className="truncate">{group.name}</span>
                      <span className="shrink-0 text-[10px] font-black text-slate-400">{group.code}</span>
                    </button>
                  )) : <p className="px-3 py-4 text-center text-xs font-bold text-slate-500">لا توجد مجموعة مطابقة.</p>}
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="temporary-account-code" className="font-black">كود الحساب *</Label>
              <Input id="temporary-account-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))} disabled={isSubmitting || isLoadingOptions} placeholder="الكود المقترح تلقائيًا" inputMode="numeric" pattern="[0-9]*" autoComplete="off" dir="ltr" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="temporary-account-type" className="font-black">نوع الحساب *</Label>
              <select id="temporary-account-type" value={accountType} onChange={(event) => setAccountType(event.target.value)} disabled={isSubmitting || isLoadingOptions} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm font-bold outline-none focus:ring-2 focus:ring-ring">
                <option value="">اختر نوع الحساب</option>
                {options.accountTypes.map((type) => <option key={type} value={type}>{accountTypeLabels[type] || type}</option>)}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-sm font-black text-slate-700">قابل للتسوية</span>
                <span className={`relative h-6 w-11 rounded-full transition ${reconcile ? 'bg-blue-700' : 'bg-slate-300'}`}>
                  <input type="checkbox" checked={reconcile} onChange={(event) => setReconcile(event.target.checked)} disabled={isSubmitting} className="sr-only" />
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${reconcile ? 'left-1' : 'left-6'}`} />
                </span>
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <span className="text-sm font-black text-slate-700">نشط</span>
                <span className={`relative h-6 w-11 rounded-full transition ${active ? 'bg-emerald-600' : 'bg-slate-300'}`}>
                  <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} disabled={isSubmitting} className="sr-only" />
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition ${active ? 'left-1' : 'left-6'}`} />
                </span>
              </label>
            </div>

            {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-bold text-red-700">{error}</p> : null}

            <div className="flex justify-between gap-3 border-t border-slate-100 pt-4">
              <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>إلغاء</Button>
              <Button type="submit" disabled={isSubmitting || isLoadingOptions}>
                {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {isSubmitting ? 'جاري الحفظ...' : 'حفظ الحساب'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AccountantIntroPanel({ cashSummary, isLoadingCashSummary = false, onCashLocationSelect }) {
  return (
    <div className="customer-care-fade-up relative z-[45] h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_34%_18%,rgba(45,212,191,0.18)_0%,rgba(14,116,144,0.10)_34%,transparent_58%),linear-gradient(145deg,#12333a_0%,#102b35_52%,#071722_100%)] px-0 pb-8 pt-16 text-right text-white sm:px-0 sm:pt-20 lg:bg-none lg:px-8 lg:pb-0 lg:pt-14 xl:px-10">
      <div className="pointer-events-none absolute inset-0 hidden sm:block">
        <span className="absolute left-[9%] top-[12%] h-8 w-20 rounded-md bg-white/9 shadow-[92px_98px_0_rgba(255,255,255,0.06),148px_32px_0_rgba(45,212,191,0.08)]" />
        <span className="absolute right-[12%] top-[34%] h-14 w-24 rounded-lg bg-white/8 shadow-[-38px_142px_0_rgba(45,212,191,0.08),92px_238px_0_rgba(255,255,255,0.06)]" />
        <span className="absolute left-[27%] top-[22%] h-px w-44 bg-gradient-to-r from-transparent via-cyan-100/24 to-transparent" />
        <span className="absolute bottom-[18%] right-[18%] h-px w-56 -rotate-6 bg-gradient-to-r from-transparent via-teal-100/18 to-transparent" />
      </div>

      <div className="relative mt-6 px-4 sm:px-6 lg:mt-12 lg:px-2 xl:mt-16 xl:px-3">
        <p className="mb-2 text-xs font-semibold text-blue-100/65 sm:mb-3 sm:text-sm">Accountant Desk</p>
        <h1 className="max-w-sm text-3xl font-bold leading-tight text-white sm:text-5xl">
          المحاسب
        </h1>
        <p className="mt-3 max-w-md text-sm font-semibold leading-6 text-blue-50/70 sm:text-base sm:leading-7">
          متابعة التحصيلات، التوريدات، والعهد اليومية من شاشة واحدة سريعة.
        </p>
        <div className="mt-6 w-full max-w-[28rem] overflow-hidden rounded-xl border border-white/20 bg-white text-slate-950 shadow-[0_22px_48px_rgba(3,7,18,0.24)]">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4 text-slate-950">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-100">
                <WalletCards className="h-4 w-4" />
              </span>
              <p className="truncate text-sm font-black tracking-tight">النقدية</p>
            </div>
            <div className="min-w-0 shrink-0 text-left">
              <p className="text-[10px] font-bold text-slate-500">الرصيد الإجمالي</p>
              <p className="mt-0.5 max-w-40 truncate text-lg font-black text-slate-950">
                {isLoadingCashSummary ? '...' : formatCurrency(cashSummary?.totalBalance || 0)}
              </p>
            </div>
          </div>

          {isLoadingCashSummary ? (
            <div className="flex min-h-28 items-center justify-center px-5 text-xs font-black text-slate-500">جاري تحميل أرصدة النقدية...</div>
          ) : cashSummary?.locations?.length ? (
            <div className="divide-y divide-slate-100">
              {cashSummary.locations.map((location) => {
                const LocationIcon = location.kind === 'main' ? Landmark : WalletCards;
                return (
                  <button
                    key={location.id}
                    type="button"
                    onClick={() => onCashLocationSelect?.(location)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-right transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-teal-100"
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${location.kind === 'main' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                      <LocationIcon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-black text-slate-900">{location.name}</p>
                      <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">
                        {location.kind === 'main' ? 'الخزنة الرئيسية' : 'عهدة موظف'}
                        {location.code ? ` · ${location.code}` : ''}
                      </p>
                    </div>
                    <p className="shrink-0 text-xs font-black text-slate-950">{formatCurrency(location.balance)}</p>
                    <ChevronRight className="h-4 w-4 shrink-0 rotate-180 text-slate-300" />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="px-5 py-8 text-center text-xs font-black text-slate-600">لا توجد خزائن أو عهد نقدية متاحة.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function AccountantOperationsPanel({
  salesInvoiceSummary = { count: 0, total: 0 },
  isLoadingSalesInvoiceSummary = false,
  approvalOperations = [],
  entityReceivableTotal = 0,
  isLoadingEntityReceivableTotal = false,
  onOpenSalesInvoices,
  onOpenApprovals,
  receivableAccounts = [],
  temporaryGroup = null,
  temporaryAccounts = [],
  isLoadingTemporaryAccounts = false,
  onAddTemporaryAccount,
  onAccountSelect,
  accounts = [],
  isLoadingAccounts = false,
}) {
  const totalReceivables = Number(salesInvoiceSummary.total || 0) + Number(entityReceivableTotal || 0);
  const isLoadingReceivables = isLoadingSalesInvoiceSummary || isLoadingEntityReceivableTotal;
  const customerReceivableAccount = receivableAccounts.find((account) => account.code === '114001');
  const entityReceivableAccount = receivableAccounts.find((account) => account.code === '114002');
  const otherReceivableAccounts = receivableAccounts.filter((account) => !['114001', '114002'].includes(account.code));

  return (
    <section className="customer-care-operations-window customer-care-fade-up min-h-0 p-2 pt-5 text-slate-950 sm:p-3 sm:pt-8 lg:relative lg:z-[80] lg:m-0 lg:flex lg:h-full lg:w-full lg:max-w-none lg:items-center lg:justify-center lg:justify-self-stretch lg:py-3 lg:pe-8 lg:ps-3 lg:pt-10 xl:pe-10 xl:ps-4">
      <div className="relative z-10 grid h-full min-h-0 w-full max-w-[78rem] gap-5 xl:grid-cols-2">
        <div className="min-h-0 space-y-5 overflow-y-auto pb-1">
          <div className="w-full overflow-hidden rounded-xl border border-white/70 bg-white text-slate-950 shadow-[0_22px_48px_rgba(3,7,18,0.22)]">
            <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50 px-5 py-4 text-slate-950">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100">
                  <CircleDollarSign className="h-4 w-4" />
                </span>
                <p className="truncate text-sm font-black tracking-tight">الذمم المدينة</p>
              </div>
              <div className="min-w-0 shrink-0 text-left">
                <p className="text-[10px] font-bold text-slate-500">إجمالي الذمم</p>
                <p className="mt-0.5 max-w-40 truncate text-lg font-black text-slate-950">
                  {isLoadingReceivables ? '...' : formatCurrency(totalReceivables)}
                </p>
              </div>
            </div>

            <div className="divide-y divide-slate-100">
              <button type="button" onClick={onOpenSalesInvoices} className="flex w-full items-center gap-3 px-5 py-3 text-right transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-blue-100">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700"><Receipt className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black text-slate-900">{customerReceivableAccount?.name || 'ذمم فواتير المبيعات'}</p>
                  <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{isLoadingSalesInvoiceSummary ? 'جاري التحميل...' : `${customerReceivableAccount?.code || '114001'} · ${salesInvoiceSummary.count} فاتورة مستحقة`}</p>
                </div>
                <p className="shrink-0 text-xs font-black text-slate-950">{isLoadingSalesInvoiceSummary ? '...' : formatCurrency(salesInvoiceSummary.total)}</p>
                <ChevronRight className="h-4 w-4 shrink-0 rotate-180 text-slate-300" />
              </button>

              <button type="button" onClick={onOpenApprovals} className="flex w-full items-center gap-3 px-5 py-3 text-right transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-amber-100">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700"><Landmark className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-black text-slate-900">{entityReceivableAccount?.name || 'ذمم لدى الجهات'}</p>
                  <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{isLoadingEntityReceivableTotal ? 'جاري التحميل...' : `${entityReceivableAccount?.code || '114002'} · ${approvalOperations.length} عملية مستحقة`}</p>
                </div>
                <p className="shrink-0 text-xs font-black text-slate-950">{isLoadingEntityReceivableTotal ? '...' : formatCurrency(entityReceivableTotal)}</p>
                <ChevronRight className="h-4 w-4 shrink-0 rotate-180 text-slate-300" />
              </button>

              {otherReceivableAccounts.map((account) => (
                <div key={account.id} className="flex w-full items-center gap-3 px-5 py-3 text-right">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><CircleDollarSign className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-black text-slate-900">{account.name}</p>
                    <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{account.code} · {account.account_type || 'ذمم مدينة'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="w-full overflow-hidden rounded-xl border border-white/70 bg-white text-slate-950 shadow-[0_22px_48px_rgba(3,7,18,0.22)]">
            <div className="border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-100">
                      <History className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black tracking-tight">الحسابات المؤقتة</p>
                      <p className="mt-0.5 text-[10px] font-black text-orange-700">TEMP</p>
                    </div>
                  </div>
                </div>
                <Button type="button" size="sm" onClick={onAddTemporaryAccount} disabled={!temporaryGroup || isLoadingTemporaryAccounts} className="h-9 shrink-0 rounded-xl bg-slate-950 px-3 text-[11px] font-black text-white hover:bg-slate-800">
                  <Plus className="h-3.5 w-3.5" />
                  إضافة حساب مؤقت
                </Button>
              </div>
              <p className="mt-3 text-[11px] font-bold leading-5 text-slate-500">
                حسابات تستخدم مؤقتًا لحين تحديد المعالجة المحاسبية النهائية للمبلغ.
              </p>
            </div>

            {isLoadingTemporaryAccounts ? (
              <div className="flex min-h-28 items-center justify-center gap-2 px-5 text-xs font-black text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                جاري تحميل الحسابات المؤقتة...
              </div>
            ) : !temporaryGroup ? (
              <div className="px-5 py-8 text-center text-xs font-black text-red-600">مجموعة الحسابات ذات الكود TEMP غير موجودة.</div>
            ) : temporaryAccounts.length ? (
              <div className="divide-y divide-slate-100">
                {temporaryAccounts.map((account) => (
                  <button key={account.id} type="button" onClick={() => onAccountSelect?.(account)} className="w-full px-5 py-3.5 text-right transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-orange-100">
                    <div className="flex items-start gap-3">
                      <span className="flex min-h-8 min-w-16 shrink-0 items-center justify-center rounded-lg bg-orange-50 px-2 text-[10px] font-black text-orange-700">
                        {account.code || '--'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <p className="min-w-0 truncate text-xs font-black text-slate-900">{account.name}</p>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${account.reconcile ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                            {account.reconcile ? 'يقبل التسوية' : 'لا يقبل التسوية'}
                          </span>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${account.active ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                            {account.active ? 'نشط' : 'غير نشط'}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-[10px] font-bold text-slate-400">نوع الحساب: {account.account_type || 'غير محدد'}</p>
                      </div>
                      <div className="shrink-0 text-left">
                        <p className="text-[9px] font-bold text-slate-400">الرصيد</p>
                        <p className={`mt-0.5 text-xs font-black ${Number(account.balance || 0) < 0 ? 'text-red-600' : 'text-slate-950'}`}>
                          {formatCurrency(account.balance)}
                        </p>
                      </div>
                      <ChevronRight className="mt-2 h-4 w-4 shrink-0 rotate-180 text-slate-300" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-5 py-8 text-center">
                <p className="text-xs font-black text-slate-600">لا توجد حسابات داخل مجموعة TEMP.</p>
              </div>
            )}
          </div>
        </div>

        <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-[1.35rem] border border-white/70 bg-white shadow-[0_22px_48px_rgba(3,7,18,0.22)]">
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-100">
                <Landmark className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-black text-slate-950">الحسابات</h2>
                <p className="mt-0.5 text-[11px] font-bold text-slate-500">دليل الحسابات النشطة</p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black text-slate-600">
              {isLoadingAccounts ? '...' : accounts.length}
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/75 p-3">
            {isLoadingAccounts ? (
              <div className="flex min-h-32 items-center justify-center text-xs font-black text-slate-500">جاري تحميل الحسابات...</div>
            ) : accounts.length ? (
              <div className="space-y-2">
                {accounts.map((account) => (
                  <button key={account.id} type="button" onClick={() => onAccountSelect?.(account)} className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-right shadow-sm transition hover:border-violet-200 hover:bg-violet-50/30 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-violet-100">
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 min-w-14 shrink-0 items-center justify-center rounded-lg bg-violet-50 px-2 text-[10px] font-black text-violet-700">
                        {account.code || '--'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-black text-slate-900">{account.name}</p>
                        <p className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{account.account_type || 'حساب'}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 rotate-180 text-slate-300" />
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-4 py-10 text-center">
                <p className="text-xs font-black text-slate-600">لا توجد حسابات نشطة.</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

export function AccountantHomePage() {
  const keepSalesInvoicesOpenRef = useRef(false);
  const [salesInvoicesOpen, setSalesInvoicesOpen] = useState(false);
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [paymentApprovalOpen, setPaymentApprovalOpen] = useState(false);
  const [temporaryAccountOpen, setTemporaryAccountOpen] = useState(false);
  const [accountCreationSuccess, setAccountCreationSuccess] = useState('');
  const [approvalOperations, setApprovalOperations] = useState([]);
  const [isLoadingApprovalOperations, setIsLoadingApprovalOperations] = useState(false);
  const [entityReceivableTotal, setEntityReceivableTotal] = useState(0);
  const [isLoadingEntityReceivableTotal, setIsLoadingEntityReceivableTotal] = useState(false);
  const [salesInvoiceSummary, setSalesInvoiceSummary] = useState({ invoices: [], count: 0, total: 0 });
  const [isLoadingSalesInvoiceSummary, setIsLoadingSalesInvoiceSummary] = useState(false);
  const [cashSummary, setCashSummary] = useState(null);
  const [isLoadingCashSummary, setIsLoadingCashSummary] = useState(false);
  const [receivableAccounts, setReceivableAccounts] = useState([]);
  const [temporaryAccountsData, setTemporaryAccountsData] = useState({ group: null, accounts: [] });
  const [isLoadingTemporaryAccounts, setIsLoadingTemporaryAccounts] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(false);
  const [selectedCashLocation, setSelectedCashLocation] = useState(null);
  const [selectedLedgerAccount, setSelectedLedgerAccount] = useState(null);
  const [selectedSalesInvoice, setSelectedSalesInvoice] = useState(null);
  const [settlementInvoice, setSettlementInvoice] = useState(null);
  const { tenant, tenantUser } = useWorkspace();
  const tenantId = tenant?.id ?? null;
  const tenantUserId = tenantUser?.id ?? null;
  const branchId = tenantUser?.branchId ?? tenantUser?.branch_id ?? null;

  useEffect(() => {
    if (!accountCreationSuccess) return undefined;
    const timeoutId = window.setTimeout(() => setAccountCreationSuccess(''), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [accountCreationSuccess]);

  const openNewApprovalOperation = () => {
    setPaymentApprovalOpen(true);
  };

  const refreshCashSummary = async (selectedLocationId = null) => {
    try {
      const nextCashSummary = await accountantService.getCashLocationsSummary({ tenantId });
      setCashSummary(nextCashSummary);
      if (selectedLocationId) {
        setSelectedCashLocation(
          nextCashSummary.locations.find((location) => location.id === selectedLocationId) || null,
        );
      }
    } catch {
      // The operation is already posted; keep the current view if refreshing the summary fails.
    }
  };

  useEffect(() => {
    const isSectionOpen = salesInvoicesOpen || approvalsOpen || paymentApprovalOpen || temporaryAccountOpen || Boolean(selectedCashLocation) || Boolean(selectedLedgerAccount) || Boolean(selectedSalesInvoice) || Boolean(settlementInvoice);
    document.documentElement.classList.toggle('customer-care-section-open', isSectionOpen);
    document.body.classList.toggle('customer-care-section-open', isSectionOpen);

    return () => {
      document.documentElement.classList.remove('customer-care-section-open');
      document.body.classList.remove('customer-care-section-open');
    };
  }, [salesInvoicesOpen, approvalsOpen, paymentApprovalOpen, temporaryAccountOpen, selectedCashLocation, selectedLedgerAccount, selectedSalesInvoice, settlementInvoice]);

  useEffect(() => {
    let mounted = true;

    if (!tenantId) {
      setEntityReceivableTotal(0);
      setApprovalOperations([]);
      setSalesInvoiceSummary({ invoices: [], count: 0, total: 0 });
      setCashSummary(null);
      setIsLoadingEntityReceivableTotal(false);
      setIsLoadingApprovalOperations(false);
      setIsLoadingSalesInvoiceSummary(false);
      setIsLoadingCashSummary(false);
      setReceivableAccounts([]);
      setTemporaryAccountsData({ group: null, accounts: [] });
      setIsLoadingTemporaryAccounts(false);
      setAccounts([]);
      setIsLoadingAccounts(false);
      return undefined;
    }

    setIsLoadingEntityReceivableTotal(true);
    setIsLoadingApprovalOperations(true);
    setIsLoadingSalesInvoiceSummary(true);
    setIsLoadingCashSummary(true);
    setIsLoadingTemporaryAccounts(true);
    setIsLoadingAccounts(true);

    Promise.all([
      accountantService.getPaymentEntityReceivableTotal({ tenantId }),
      accountantService.listPaymentEntityCustomerCredits({ tenantId }),
      accountantService.getSalesInvoiceSummary({ tenantId }),
      accountantService.getCashLocationsSummary({ tenantId }),
      accountantService.listActiveAccounts({ tenantId }),
      accountantService.getTemporaryAccounts({ tenantId }),
    ])
      .then(([total, operations, invoiceSummary, nextCashSummary, nextAccounts, nextTemporaryAccountsData]) => {
        if (!mounted) return;
        setEntityReceivableTotal(total);
        setApprovalOperations(operations);
        setSalesInvoiceSummary(invoiceSummary);
        setCashSummary(nextCashSummary);
        setReceivableAccounts(nextAccounts.filter(isReceivableAccount));
        setTemporaryAccountsData(nextTemporaryAccountsData);
        const temporaryAccountIds = new Set(nextTemporaryAccountsData.accounts.map((account) => account.id));
        setAccounts(nextAccounts.filter((account) => (
          !isCashAccount(account)
          && !isReceivableAccount(account)
          && !temporaryAccountIds.has(account.id)
        )));
      })
      .catch(() => {
        if (!mounted) return;
        setEntityReceivableTotal(0);
        setApprovalOperations([]);
        setSalesInvoiceSummary({ invoices: [], count: 0, total: 0 });
        setCashSummary(null);
        setReceivableAccounts([]);
        setTemporaryAccountsData({ group: null, accounts: [] });
        setAccounts([]);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingEntityReceivableTotal(false);
        setIsLoadingApprovalOperations(false);
        setIsLoadingSalesInvoiceSummary(false);
        setIsLoadingCashSummary(false);
        setIsLoadingTemporaryAccounts(false);
        setIsLoadingAccounts(false);
      });

    return () => {
      mounted = false;
    };
  }, [tenantId]);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col items-stretch overflow-hidden text-white" dir="rtl">
      <style>{`
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
        .accountant-approval-overlay[data-state="open"],
        .sheet-overlay[data-state="open"] {
          animation: accountantApprovalFadeIn 90ms ease-out;
        }
        .accountant-approval-overlay[data-state="closed"],
        .sheet-overlay[data-state="closed"] {
          animation: accountantApprovalFadeOut 80ms ease-in;
        }
        .accountant-approval-dialog-content[data-state="open"] {
          animation: accountantApprovalDialogIn 120ms ease-out;
        }
        .accountant-approval-dialog-content[data-state="closed"] {
          animation: accountantApprovalDialogOut 90ms ease-in;
        }
        .accountant-approval-sheet[data-state="open"] {
          animation: accountantApprovalSheetIn 130ms ease-out;
        }
        .accountant-approval-sheet[data-state="closed"] {
          animation: accountantApprovalSheetOut 100ms ease-in;
        }
        @keyframes accountantApprovalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes accountantApprovalFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes accountantApprovalDialogIn {
          from {
            opacity: 0;
            transform: translate(-50%, calc(-50% + 4px)) scale(0.995);
          }
          to {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
        }
        @keyframes accountantApprovalDialogOut {
          from {
            opacity: 1;
            transform: translate(-50%, -50%) scale(1);
          }
          to {
            opacity: 0;
            transform: translate(-50%, calc(-50% + 3px)) scale(0.995);
          }
        }
        @keyframes accountantApprovalSheetIn {
          from {
            transform: translateX(8%);
          }
          to {
            transform: translateX(0);
          }
        }
        @keyframes accountantApprovalSheetOut {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(8%);
          }
        }
      `}</style>
      {accountCreationSuccess ? (
        <p role="status" className="fixed left-1/2 top-5 z-[150] -translate-x-1/2 rounded-xl border border-emerald-200 bg-emerald-50 px-5 py-3 text-sm font-black text-emerald-700 shadow-xl">
          {accountCreationSuccess}
        </p>
      ) : null}
      <div className="relative z-10 grid min-h-0 w-full max-w-none flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(21rem,0.72fr)_minmax(44rem,1.28fr)] lg:items-stretch lg:bg-[radial-gradient(circle_at_27%_17%,rgba(45,212,191,0.16)_0%,rgba(14,116,144,0.09)_32%,transparent_58%),linear-gradient(145deg,#12333a_0%,#102b35_52%,#071722_100%)]">
        <AccountantIntroPanel
          cashSummary={cashSummary}
          isLoadingCashSummary={isLoadingCashSummary}
          onCashLocationSelect={setSelectedCashLocation}
        />
        <AccountantOperationsPanel
          salesInvoiceSummary={salesInvoiceSummary}
          isLoadingSalesInvoiceSummary={isLoadingSalesInvoiceSummary}
          approvalOperations={approvalOperations}
          entityReceivableTotal={entityReceivableTotal}
          isLoadingEntityReceivableTotal={isLoadingEntityReceivableTotal}
          onOpenSalesInvoices={() => setSalesInvoicesOpen(true)}
          onOpenApprovals={() => setApprovalsOpen(true)}
          receivableAccounts={receivableAccounts}
          temporaryGroup={temporaryAccountsData.group}
          temporaryAccounts={temporaryAccountsData.accounts}
          isLoadingTemporaryAccounts={isLoadingTemporaryAccounts}
          onAddTemporaryAccount={() => setTemporaryAccountOpen(true)}
          onAccountSelect={setSelectedLedgerAccount}
          accounts={accounts}
          isLoadingAccounts={isLoadingAccounts}
        />
      </div>
      <CashLocationSheet
        location={selectedCashLocation}
        tenantId={tenantId}
        onOpenChange={(open) => {
          if (!open) setSelectedCashLocation(null);
        }}
        onOperationCreated={refreshCashSummary}
      />
      <LedgerAccountOperationsSheet
        account={selectedLedgerAccount}
        tenantId={tenantId}
        onOpenChange={(open) => {
          if (!open) setSelectedLedgerAccount(null);
        }}
      />
      <SalesInvoicesDrawer
        open={salesInvoicesOpen}
        onOpenChange={(open) => {
          if (!open && keepSalesInvoicesOpenRef.current) return;
          setSalesInvoicesOpen(open);
        }}
        invoices={salesInvoiceSummary.invoices}
        isLoading={isLoadingSalesInvoiceSummary}
        total={salesInvoiceSummary.total}
        shouldKeepOpen={() => keepSalesInvoicesOpenRef.current}
        onInvoiceSelect={(invoice) => {
          keepSalesInvoicesOpenRef.current = true;
          setSelectedSalesInvoice(invoice);
        }}
      />
      <TemporaryAccountDialog
        open={temporaryAccountOpen}
        onOpenChange={setTemporaryAccountOpen}
        tenantId={tenantId}
        initialGroupId={temporaryAccountsData.group?.id || null}
        onCreated={(account, selectedGroupId) => {
          if (selectedGroupId === temporaryAccountsData.group?.id) {
            setTemporaryAccountsData((current) => ({
              ...current,
              accounts: [...current.accounts, account].sort((first, second) => String(first.code).localeCompare(String(second.code))),
            }));
          } else if (account.active && isCashAccount(account)) {
            setCashSummary((current) => ({
              totalBalance: current?.totalBalance || 0,
              locations: [...(current?.locations || []), { ...account, kind: 'cash', balance: 0 }]
                .sort((first, second) => String(first.code).localeCompare(String(second.code))),
            }));
          } else if (account.active && isReceivableAccount(account)) {
            setReceivableAccounts((current) => [...current, account].sort((first, second) => String(first.code).localeCompare(String(second.code))));
          } else if (account.active) {
            setAccounts((current) => [...current, account].sort((first, second) => String(first.code).localeCompare(String(second.code))));
          }
          setAccountCreationSuccess('تم إنشاء الحساب بنجاح.');
        }}
      />
      <ApprovalOperationsDrawer
        open={approvalsOpen}
        onOpenChange={setApprovalsOpen}
        onCreateOperation={openNewApprovalOperation}
        operations={approvalOperations}
        isLoading={isLoadingApprovalOperations}
        total={entityReceivableTotal}
        isLoadingTotal={isLoadingEntityReceivableTotal}
      />
      <PaymentApprovalDialog
        open={paymentApprovalOpen}
        onOpenChange={setPaymentApprovalOpen}
        tenantId={tenantId}
        branchId={branchId}
        tenantUserId={tenantUserId}
        onCreated={(operation) => {
          setApprovalOperations((current) => [operation, ...current]);
          setEntityReceivableTotal((current) => current + Number(operation?.amount || 0));
        }}
      />
      <ShowroomSaleViewSheet
        sale={selectedSalesInvoice ? {
          id: selectedSalesInvoice.id,
          customer: { name: selectedSalesInvoice.customerName },
          total_amount: selectedSalesInvoice.totalAmount,
          paid_amount: selectedSalesInvoice.paidAmount,
          remaining_amount: selectedSalesInvoice.remainingAmount,
          created_at: selectedSalesInvoice.saleDate,
        } : null}
        showroomConfigId={selectedSalesInvoice?.showroomConfigId || null}
        isOpen={Boolean(selectedSalesInvoice)}
        onClose={() => {
          setSelectedSalesInvoice(null);
          setSalesInvoicesOpen(true);
          window.setTimeout(() => {
            keepSalesInvoicesOpenRef.current = false;
          }, 0);
        }}
        onSettleBalance={(sale) => {
          setSettlementInvoice({
            ...selectedSalesInvoice,
            totalAmount: Number(sale?.total_amount ?? selectedSalesInvoice?.totalAmount ?? 0),
            paidAmount: Number(sale?.paid_amount ?? selectedSalesInvoice?.paidAmount ?? 0),
            remainingAmount: Number(sale?.remaining_amount ?? selectedSalesInvoice?.remainingAmount ?? 0),
          });
          setSelectedSalesInvoice(null);
        }}
        readOnly
      />
      <InvoiceSettlementDialog
        open={Boolean(settlementInvoice)}
        onOpenChange={(open) => {
          if (!open) setSettlementInvoice(null);
        }}
        tenantId={tenantId}
        invoice={settlementInvoice}
        onSettled={(result) => {
          const settledSaleId = settlementInvoice?.id;
          const nextRemaining = Number(result?.remaining_amount || 0);
          const settledAmount = Number(result?.amount || 0);

          setSalesInvoiceSummary((current) => {
            const invoices = current.invoices
              .map((invoice) => invoice.id === settledSaleId
                ? {
                    ...invoice,
                    paidAmount: Number(result?.paid_amount ?? invoice.paidAmount),
                    remainingAmount: nextRemaining,
                  }
                : invoice)
              .filter((invoice) => invoice.remainingAmount > 0);

            return {
              invoices,
              count: invoices.length,
              total: Math.max(Number(current.total || 0) - settledAmount, 0),
            };
          });
          setSettlementInvoice(null);
        }}
      />
    </section>
  );
}
