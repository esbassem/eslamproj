import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  ImagePlus,
  Landmark,
  Loader2,
  Plus,
  Receipt,
  Search,
  UserPlus,
  UserRoundPlus,
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
import { accountantService } from '@/features/accountant/services/accountant.service';
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

function PartnerDisplayAvatar({ name, displayConfig, className = 'h-12 w-12 text-base' }) {
  const avatar = getDisplayAvatarConfig({ name, displayConfig });
  const Icon = partnerAvatarIconMap[avatar.icon] || null;
  const radiusStyle = avatar.radius != null
    ? { borderRadius: avatar.radius }
    : {};
  const sizeStyle = avatar.size != null
    ? { width: avatar.size, height: avatar.size }
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

const quickActions = [
  { id: 'collection', label: 'تسجيل تحصيل', icon: ArrowDownToLine },
  { id: 'supply', label: 'تسجيل توريد', icon: ArrowUpFromLine },
  { id: 'expense', label: 'مصروف سريع', icon: Receipt },
];

const emptyRows = [
  { id: 'opening', title: 'لا توجد حركات اليوم', meta: 'ابدأ بتسجيل تحصيل أو توريد', icon: ClipboardList },
  { id: 'review', title: 'المراجعة اليومية جاهزة', meta: 'سيظهر هنا ملخص الحركات بعد التسجيل', icon: CalendarClock },
];

const approvalStatuses = [
  { id: 'all', label: 'الكل' },
  { id: 'review', label: 'قيد المراجعة' },
  { id: 'approved', label: 'معتمد' },
  { id: 'rejected', label: 'مرفوض' },
];

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

function ApprovalOperationsDrawer({
  open,
  onOpenChange,
  onCreateOperation,
  operations = [],
  isLoading = false,
  total = 0,
  isLoadingTotal = false,
}) {
  const entityBalances = Array.from(operations.reduce((map, operation) => {
    const key = operation.entityId || operation.entityName || operation.id;
    const current = map.get(key) || {
      id: key,
      name: operation.entityName || 'جهة غير محددة',
      displayConfig: operation.entityDisplayConfig || null,
      amount: 0,
    };

    current.amount += Number(operation.amount || 0);
    map.set(key, current);
    return map;
  }, new Map()).values())
    .filter((entity) => entity.amount > 0)
    .sort((first, second) => second.amount - first.amount);

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
                <SheetTitle className="text-lg font-black">اعتمادات الجهات</SheetTitle>
                <p className="mt-0.5 truncate text-xs font-bold text-slate-500">رصيد الدفعات المعتمدة على جهات الدفع</p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl bg-slate-950 px-4 py-4 text-white">
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-300">إجمالي الرصيد عند الجهات</p>
              <p className="mt-1 truncate text-3xl font-black leading-10 tracking-normal">
                {isLoadingTotal ? '...' : formatCurrency(total)}
              </p>
            </div>
            <Button
              type="button"
              onClick={onCreateOperation}
              className="h-10 shrink-0 rounded-xl bg-white px-3 text-xs font-black text-slate-950 hover:bg-slate-100"
              title="إضافة اعتماد جديد"
            >
              <Plus className="h-4 w-4" />
              إضافة
            </Button>
          </div>
        </SheetHeader>

        <SheetBody className="px-5 pb-6 pt-1">
          <div className="space-y-2">
            {isLoading ? (
              <div className="flex min-h-40 items-center justify-center rounded-xl bg-slate-50 text-sm font-black text-slate-500">
                جاري تحميل أرصدة الجهات...
              </div>
            ) : entityBalances.length ? entityBalances.map((entity) => (
                <article key={entity.id} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-3 py-3 text-right">
                  <PartnerDisplayAvatar
                    name={entity.name}
                    displayConfig={entity.displayConfig}
                    className="h-12 w-12 text-base"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black text-slate-950">{entity.name}</p>
                    <p className="mt-0.5 text-xs font-bold text-slate-500">الرصيد الحالي عند الجهة</p>
                  </div>
                  <div className="shrink-0 text-left">
                    <p className="text-base font-black leading-6 text-slate-950">{formatCurrency(entity.amount)}</p>
                    <span className="mt-1 inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">
                      مستحق
                    </span>
                  </div>
                </article>
            )) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center">
                <p className="text-sm font-black text-slate-700">لا توجد عمليات اعتماد مسجلة.</p>
                <p className="mt-1 text-xs font-bold text-slate-500">ابدأ من زر عملية أخرى لإضافة أول عملية.</p>
              </div>
            )}
          </div>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function AccountantIntroPanel({ onOpenApprovals, entityReceivableTotal = 0, isLoadingEntityReceivableTotal = false }) {
  return (
    <div className="customer-care-fade-up relative z-[45] h-full min-h-0 overflow-x-hidden overflow-y-auto bg-[radial-gradient(circle_at_34%_18%,rgba(45,212,191,0.18)_0%,rgba(14,116,144,0.10)_34%,transparent_58%),linear-gradient(145deg,#12333a_0%,#102b35_52%,#071722_100%)] px-0 pb-8 pt-16 text-right text-white [-webkit-overflow-scrolling:touch] sm:px-0 sm:pt-20 lg:overflow-hidden lg:bg-none lg:px-8 lg:pb-0 lg:pt-14 xl:px-10">
      <div className="pointer-events-none absolute inset-0 hidden sm:block">
        <span className="absolute left-[9%] top-[12%] h-8 w-20 rounded-md bg-white/9 shadow-[92px_98px_0_rgba(255,255,255,0.06),148px_32px_0_rgba(45,212,191,0.08)]" />
        <span className="absolute right-[12%] top-[34%] h-14 w-24 rounded-lg bg-white/8 shadow-[-38px_142px_0_rgba(45,212,191,0.08),92px_238px_0_rgba(255,255,255,0.06)]" />
        <span className="absolute left-[27%] top-[22%] h-px w-44 bg-gradient-to-r from-transparent via-cyan-100/24 to-transparent" />
        <span className="absolute bottom-[18%] right-[18%] h-px w-56 -rotate-6 bg-gradient-to-r from-transparent via-teal-100/18 to-transparent" />
      </div>

      <div className="relative mt-6 px-6 sm:px-12 lg:mt-12 lg:px-6 xl:mt-16 xl:px-10">
        <p className="mb-2 text-xs font-semibold text-blue-100/65 sm:mb-3 sm:text-sm">Accountant Desk</p>
        <h1 className="max-w-sm text-3xl font-bold leading-tight text-white sm:text-5xl">
          المحاسب
        </h1>
        <p className="mt-3 max-w-md text-sm font-semibold leading-6 text-blue-50/70 sm:text-base sm:leading-7">
          متابعة التحصيلات، التوريدات، والعهد اليومية من شاشة واحدة سريعة.
        </p>
        <button
          type="button"
          onClick={onOpenApprovals}
          className="mt-6 flex w-full max-w-[22rem] items-stretch gap-3 rounded-2xl border border-emerald-200/35 bg-emerald-300/16 p-3 text-right text-white shadow-[0_18px_42px_rgba(3,7,18,0.18)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-emerald-100/55 hover:bg-emerald-300/22 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-100/25"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-300 text-emerald-950 shadow-sm">
            <UserRoundPlus className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-black leading-4 text-emerald-50/85">رصيدك عند الجهات</span>
            <span className="mt-1 block truncate text-2xl font-black leading-8 text-white">
              {isLoadingEntityReceivableTotal ? '...' : formatCurrency(entityReceivableTotal)}
            </span>
            <span className="mt-1 block text-[11px] font-bold leading-4 text-emerald-50/65">اضغط لعرض اعتمادات الجهات</span>
          </span>
        </button>
      </div>
    </div>
  );
}

function AccountantOperationsPanel() {
  return (
    <section className="customer-care-operations-window customer-care-fade-up min-h-0 p-5 text-slate-950 sm:p-8 lg:relative lg:z-[80] lg:m-0 lg:flex lg:h-full lg:w-full lg:max-w-none lg:items-center lg:justify-center lg:justify-self-stretch lg:py-10 lg:pl-20 lg:pr-28 xl:pl-28 xl:pr-36">
      <div className="relative z-10 flex h-full min-h-0 w-full max-w-[51rem] translate-x-4 translate-y-4 flex-col overflow-hidden rounded-[1.35rem] border border-white/70 bg-white shadow-[0_22px_48px_rgba(3,7,18,0.22)] xl:translate-x-6">
        <div className="relative z-10 flex min-h-[6.25rem] flex-shrink-0 items-center justify-between gap-3 bg-white px-6 py-6 text-slate-950 shadow-[0_1px_0_rgba(15,23,42,0.08),0_10px_18px_rgba(15,23,42,0.035)] after:pointer-events-none after:absolute after:inset-x-6 after:bottom-0 after:h-px after:bg-gradient-to-l after:from-transparent after:via-slate-200 after:to-transparent sm:px-7 sm:after:inset-x-7">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700 shadow-sm">
              <WalletCards className="h-6 w-6" />
            </span>
            <div className="min-w-0 text-right">
              <h2 className="truncate text-2xl font-black leading-8 text-slate-950 sm:text-3xl sm:leading-10">حركة اليوم</h2>
              <p className="mt-1 text-sm font-black leading-5 text-slate-500">التحصيلات والتوريدات اليومية</p>
            </div>
          </div>
          <Button type="button" className="h-11 gap-2 rounded-xl bg-blue-700 px-4 font-black text-white hover:bg-blue-800">
            <Plus className="h-4 w-4" />
            حركة جديدة
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/75 p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            {quickActions.map((action) => {
              const Icon = action.icon;

              return (
                <button
                  key={action.id}
                  type="button"
                  className="flex min-h-24 flex-col items-start justify-between rounded-xl border border-slate-200 bg-white p-4 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-md"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-black text-slate-950">{action.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-5 py-4">
              <p className="text-sm font-black text-slate-950">آخر الحركات</p>
              <p className="mt-1 text-xs font-bold text-slate-500">ستظهر أحدث عمليات المحاسب هنا فور التسجيل.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {emptyRows.map((row) => {
                const Icon = row.icon;

                return (
                  <div key={row.id} className="flex items-center gap-3 px-5 py-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">{row.title}</p>
                      <p className="mt-0.5 truncate text-xs font-bold text-slate-500">{row.meta}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function AccountantHomePage() {
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [paymentApprovalOpen, setPaymentApprovalOpen] = useState(false);
  const [approvalOperations, setApprovalOperations] = useState([]);
  const [isLoadingApprovalOperations, setIsLoadingApprovalOperations] = useState(false);
  const [entityReceivableTotal, setEntityReceivableTotal] = useState(0);
  const [isLoadingEntityReceivableTotal, setIsLoadingEntityReceivableTotal] = useState(false);
  const { tenant, tenantUser } = useWorkspace();
  const tenantId = tenant?.id ?? null;
  const tenantUserId = tenantUser?.id ?? null;
  const branchId = tenantUser?.branchId ?? tenantUser?.branch_id ?? null;

  const openNewApprovalOperation = () => {
    setPaymentApprovalOpen(true);
  };

  useEffect(() => {
    const isSectionOpen = approvalsOpen || paymentApprovalOpen;
    document.documentElement.classList.toggle('customer-care-section-open', isSectionOpen);
    document.body.classList.toggle('customer-care-section-open', isSectionOpen);

    return () => {
      document.documentElement.classList.remove('customer-care-section-open');
      document.body.classList.remove('customer-care-section-open');
    };
  }, [approvalsOpen, paymentApprovalOpen]);

  useEffect(() => {
    let mounted = true;

    if (!tenantId) {
      setEntityReceivableTotal(0);
      setApprovalOperations([]);
      setIsLoadingEntityReceivableTotal(false);
      setIsLoadingApprovalOperations(false);
      return undefined;
    }

    setIsLoadingEntityReceivableTotal(true);
    setIsLoadingApprovalOperations(true);

    Promise.all([
      accountantService.getPaymentEntityReceivableTotal({ tenantId }),
      accountantService.listPaymentEntityCustomerCredits({ tenantId }),
    ])
      .then(([total, operations]) => {
        if (!mounted) return;
        setEntityReceivableTotal(total);
        setApprovalOperations(operations);
      })
      .catch(() => {
        if (!mounted) return;
        setEntityReceivableTotal(0);
        setApprovalOperations([]);
      })
      .finally(() => {
        if (!mounted) return;
        setIsLoadingEntityReceivableTotal(false);
        setIsLoadingApprovalOperations(false);
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
      <div className="relative z-10 grid min-h-0 w-full max-w-none flex-1 gap-0 overflow-hidden lg:grid-cols-[minmax(18rem,0.72fr)_minmax(34rem,1.28fr)] lg:items-stretch lg:bg-[radial-gradient(circle_at_27%_17%,rgba(45,212,191,0.16)_0%,rgba(14,116,144,0.09)_32%,transparent_58%),linear-gradient(145deg,#12333a_0%,#102b35_52%,#071722_100%)]">
        <AccountantIntroPanel
          onOpenApprovals={() => setApprovalsOpen(true)}
          entityReceivableTotal={entityReceivableTotal}
          isLoadingEntityReceivableTotal={isLoadingEntityReceivableTotal}
        />
        <AccountantOperationsPanel />
      </div>
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
    </section>
  );
}
