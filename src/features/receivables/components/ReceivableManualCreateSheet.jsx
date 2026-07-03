import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CalendarDays, ChevronLeft, ChevronRight, Minus, Plus, Search, UserPlus, X } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Input } from '@/core/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { PartnerFormSheet } from '@/features/contacts/components/PartnerFormSheet';
import { createManualReceivable } from '@/features/receivables/api/createManualReceivable';
import { cn } from '@/core/utils/cn';

const NEW_CUSTOMER_INITIAL_VALUES = {
  isCustomer: true,
  isSupplier: false,
};

const GUARANTOR_PLAN_OPTIONS = [
  { value: 0, label: 'بدون' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
];

const QUICK_INSTALLMENT_COUNTS = [1, 3, 6, 12, 24];

const ARABIC_ONES = ['', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة'];
const ARABIC_TEENS = ['عشرة', 'أحد عشر', 'اثنا عشر', 'ثلاثة عشر', 'أربعة عشر', 'خمسة عشر', 'ستة عشر', 'سبعة عشر', 'ثمانية عشر', 'تسعة عشر'];
const ARABIC_TENS = ['', '', 'عشرون', 'ثلاثون', 'أربعون', 'خمسون', 'ستون', 'سبعون', 'ثمانون', 'تسعون'];
const ARABIC_HUNDREDS = ['', 'مائة', 'مئتان', 'ثلاثمائة', 'أربعمائة', 'خمسمائة', 'ستمائة', 'سبعمائة', 'ثمانمائة', 'تسعمائة'];
const ARABIC_SCALES = [
  null,
  { singular: 'ألف', dual: 'ألفان', plural: 'آلاف' },
  { singular: 'مليون', dual: 'مليونان', plural: 'ملايين' },
  { singular: 'مليار', dual: 'ملياران', plural: 'مليارات' },
];

function arabicUnderThousand(number) {
  const parts = [];
  const hundreds = Math.floor(number / 100);
  const remainder = number % 100;

  if (hundreds) parts.push(ARABIC_HUNDREDS[hundreds]);
  if (remainder) {
    if (remainder < 10) {
      parts.push(ARABIC_ONES[remainder]);
    } else if (remainder < 20) {
      parts.push(ARABIC_TEENS[remainder - 10]);
    } else {
      const ones = remainder % 10;
      const tens = Math.floor(remainder / 10);
      parts.push(ones ? `${ARABIC_ONES[ones]} و${ARABIC_TENS[tens]}` : ARABIC_TENS[tens]);
    }
  }

  return parts.join(' و');
}

function arabicNumberWords(value) {
  const safeNumber = Math.floor(Math.abs(Number(value) || 0));
  if (!safeNumber) return 'صفر';

  const groups = [];
  let remaining = safeNumber;
  while (remaining > 0) {
    groups.push(remaining % 1000);
    remaining = Math.floor(remaining / 1000);
  }

  return groups
    .map((group, index) => {
      if (!group) return '';
      if (!index) return arabicUnderThousand(group);

      const scale = ARABIC_SCALES[index];
      if (!scale) return arabicUnderThousand(group);
      if (group === 1) return scale.singular;
      if (group === 2) return scale.dual;
      if (group >= 3 && group <= 10) return `${arabicUnderThousand(group)} ${scale.plural}`;
      return `${arabicUnderThousand(group)} ${scale.singular}`;
    })
    .filter(Boolean)
    .reverse()
    .join(' و');
}

function formatArabicMoneyWords(value) {
  const safeAmount = Math.abs(Number(value) || 0);
  const pounds = Math.floor(safeAmount);
  const piasters = Math.round((safeAmount - pounds) * 100);
  const poundWords = `${arabicNumberWords(pounds)} جنيه مصري`;

  if (!piasters) return poundWords;
  return `${poundWords} و${arabicNumberWords(piasters)} قرش`;
}

function clampInstallmentCount(value, { max = 24 } = {}) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  return Math.min(Math.max(Math.round(numericValue), 1), max);
}

function addMonths(dateString, months) {
  if (!dateString) return '';
  const sourceDate = new Date(`${dateString}T00:00:00`);
  const targetYear = sourceDate.getFullYear();
  const targetMonth = sourceDate.getMonth() + months;
  const targetDay = sourceDate.getDate();
  const lastDayInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const date = new Date(targetYear, targetMonth, Math.min(targetDay, lastDayInTargetMonth));
  return toIsoDate(date);
}

function formatDisplayDate(dateString) {
  if (!dateString) return '--';
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${dateString}T00:00:00`));
}

function toIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateFromIso(dateString) {
  if (!dateString) return new Date();
  const date = new Date(`${dateString}T00:00:00`);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function formatMonthTitle(date) {
  return new Intl.DateTimeFormat('ar-EG-u-nu-latn', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function buildCalendarDays(monthDate) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = (firstDay.getDay() + 1) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let index = 0; index < startOffset; index += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  return cells;
}

function formatMoney(value) {
  return new Intl.NumberFormat('ar-EG-u-nu-latn', {
    style: 'currency',
    currency: 'EGP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

export function ReceivableCreateSheet({
  open,
  onOpenChange,
  partners = [],
  tenantId = null,
  branchId = null,
  createdBy = null,
  onCreated,
  onCreateCustomer,
  isCustomerSubmitting = false,
}) {
  const [step, setStep] = useState(0);
  const [customerName, setCustomerName] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [receivableName, setReceivableName] = useState('');
  const [amount, setAmount] = useState('');
  const [guarantorPlan, setGuarantorPlan] = useState(null);
  const [guarantorSearch, setGuarantorSearch] = useState('');
  const [selectedGuarantors, setSelectedGuarantors] = useState([]);
  const [selectedInstallmentCount, setSelectedInstallmentCount] = useState(null);
  const [manualInstallmentCount, setManualInstallmentCount] = useState('');
  const [firstDueDate, setFirstDueDate] = useState('');
  const [installmentAmount, setInstallmentAmount] = useState('');
  const [installments, setInstallments] = useState([]);
  const [trustReceiptStatus, setTrustReceiptStatus] = useState('');
  const [paperworkStatus, setPaperworkStatus] = useState('');
  const [extraNotes, setExtraNotes] = useState('');
  const [isCustomerSheetOpen, setIsCustomerSheetOpen] = useState(false);
  const [isAmountConfirmOpen, setIsAmountConfirmOpen] = useState(false);
  const [isInstallmentsConfirmOpen, setIsInstallmentsConfirmOpen] = useState(false);
  const [isSavingReceivable, setIsSavingReceivable] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [datePickerTarget, setDatePickerTarget] = useState({ type: 'default', index: null });
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [customerSheetMode, setCustomerSheetMode] = useState('customer');

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setCustomerName('');
    setSelectedCustomer(null);
    setReceivableName('');
    setAmount('');
    setGuarantorPlan(null);
    setGuarantorSearch('');
    setSelectedGuarantors([]);
    setSelectedInstallmentCount(null);
    setManualInstallmentCount('');
    setReceivableName('');
    setFirstDueDate('');
    setInstallmentAmount('');
    setInstallments([]);
    setTrustReceiptStatus('');
    setPaperworkStatus('');
    setExtraNotes('');
    setIsAmountConfirmOpen(false);
    setIsInstallmentsConfirmOpen(false);
    setIsSavingReceivable(false);
    setSaveError('');
    setIsDatePickerOpen(false);
    setDatePickerTarget({ type: 'default', index: null });
    setCalendarMonth(new Date());
    setCustomerSheetMode('customer');
  }, [open]);

  const guarantorLimit = typeof guarantorPlan === 'number' ? guarantorPlan : 0;
  const numericAmount = Number(amount);
  const formattedAmount = Number.isFinite(numericAmount)
    ? new Intl.NumberFormat('ar-EG-u-nu-arab', {
      style: 'currency',
      currency: 'EGP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(numericAmount)
    : '';
  const amountWords = formatArabicMoneyWords(numericAmount);
  const calendarDays = buildCalendarDays(calendarMonth);
  const activeInstallmentDate = datePickerTarget.type === 'installment'
    ? installments[datePickerTarget.index]?.dueDate
    : firstDueDate;
  const selectedDueDate = activeInstallmentDate ? dateFromIso(activeInstallmentDate) : null;
  const stepDescription = step === 0
    ? 'ابدأ بتحديد العميل المرتبط بهذه المديونية.'
    : step === 1
      ? ''
      : step === 2
        ? ''
        : '';

  const normalizedSearch = customerName.trim().toLowerCase();
  const filteredCustomers = normalizedSearch
    ? partners.filter((partner) => {
      const name = String(partner?.name ?? '').toLowerCase();
      const phone = String(partner?.phone ?? '').toLowerCase();
      return name.includes(normalizedSearch) || phone.includes(normalizedSearch);
    })
    : partners.slice(0, 8);

  const normalizedGuarantorSearch = guarantorSearch.trim().toLowerCase();
  const filteredGuarantors = partners
    .filter((partner) => partner?.id && partner.id !== selectedCustomer?.id)
    .filter((partner) => !selectedGuarantors.some((guarantor) => guarantor.id === partner.id))
    .filter((partner) => {
      if (!normalizedGuarantorSearch) return true;
      const name = String(partner?.name ?? '').toLowerCase();
      const phone = String(partner?.phone ?? '').toLowerCase();
      return name.includes(normalizedGuarantorSearch) || phone.includes(normalizedGuarantorSearch);
    })
    .slice(0, 8);

  const selectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setCustomerName(customer?.name || '');
    setGuarantorPlan(null);
    setSelectedGuarantors([]);
    setSelectedInstallmentCount(null);
    setManualInstallmentCount('');
    setFirstDueDate('');
    setInstallmentAmount('');
    setInstallments([]);
    setStep(1);
  };

  const addGuarantor = (guarantor) => {
    setSelectedGuarantors((current) => {
      if (current.length >= guarantorLimit || current.some((item) => item.id === guarantor.id)) return current;
      return [...current, guarantor];
    });
    setGuarantorSearch('');
  };

  const removeGuarantor = (guarantorId) => {
    setSelectedGuarantors((current) => current.filter((guarantor) => guarantor.id !== guarantorId));
  };

  const openDatePicker = (target = { type: 'default', index: null }) => {
    const targetDate = target.type === 'installment'
      ? installments[target.index]?.dueDate
      : firstDueDate;
    setDatePickerTarget(target);
    setCalendarMonth(dateFromIso(targetDate));
    setIsDatePickerOpen(true);
  };

  const changeCalendarMonth = (offset) => {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1));
  };

  const selectDueDate = (date) => {
    const nextDate = toIsoDate(date);
    if (datePickerTarget.type === 'installment') {
      setInstallments((current) => current.map((installment, index) => (
        index === datePickerTarget.index
          ? { ...installment, dueDate: nextDate, isDateEdited: true }
          : installment
      )));
    } else {
      setFirstDueDate(nextDate);
    }
    setIsDatePickerOpen(false);
  };

  const updateInstallmentAmount = (index, value) => {
    const cleanValue = value.replace(/[^0-9.]/g, '');
    setInstallments((current) => current.map((installment, installmentIndex) => (
      installmentIndex === index
        ? { ...installment, amount: cleanValue, isAmountEdited: true }
        : installment
    )));
  };

  const updateInstallmentName = (index, value) => {
    setInstallments((current) => current.map((installment, installmentIndex) => (
      installmentIndex === index
        ? { ...installment, name: value, isNameEdited: true }
        : installment
    )));
  };

  const selectInstallmentCount = (value, { manual = false } = {}) => {
    const nextCount = manual ? Number(value) : clampInstallmentCount(value);
    if (!Number.isFinite(nextCount) || nextCount < 1) {
      setSelectedInstallmentCount(null);
      if (manual) setManualInstallmentCount('');
      return;
    }
    setSelectedInstallmentCount(Math.round(nextCount));
    setManualInstallmentCount(manual ? String(Math.round(nextCount)) : '');
  };

  const selectGuarantorPlan = (value) => {
    setGuarantorPlan(value);
    setSelectedGuarantors([]);
    setGuarantorSearch('');
    if (typeof value === 'number' && value > 0) {
      setStep(3);
      return;
    }
    setStep(4);
  };

  const installmentCount = Math.max(Number(selectedInstallmentCount) || 0, 0);

  useEffect(() => {
    setInstallments((current) => Array.from({ length: installmentCount }, (_, index) => {
      const existing = current[index];
      const defaultDueDate = addMonths(firstDueDate, index);
      const defaultAmount = installmentAmount;
      const defaultName = `استحقاق ${(index + 1).toLocaleString('ar-EG-u-nu-latn')}`;

      if (!existing) {
        return {
          installmentNo: index + 1,
          name: defaultName,
          dueDate: defaultDueDate,
          amount: defaultAmount,
          isNameEdited: false,
          isDateEdited: false,
          isAmountEdited: false,
        };
      }

      return {
        ...existing,
        installmentNo: index + 1,
        name: existing.isNameEdited ? existing.name : defaultName,
        dueDate: existing.isDateEdited ? existing.dueDate : defaultDueDate,
        amount: existing.isAmountEdited ? existing.amount : defaultAmount,
      };
    }));
  }, [firstDueDate, installmentAmount, installmentCount]);

  const installmentsReady = installmentCount > 0
    && installments.length === installmentCount
    && installments.every((installment) => installment.name.trim() && installment.dueDate && Number(installment.amount) > 0);
  const receivableAmountCents = Math.round((Number(amount) || 0) * 100);
  const installmentsTotalCents = installments.reduce((total, installment) => (
    total + Math.round((Number(installment.amount) || 0) * 100)
  ), 0);
  const installmentsDifferenceCents = installmentsTotalCents - receivableAmountCents;
  const installmentsBalanced = installmentsReady && installmentsDifferenceCents === 0;
  const installmentsBalanceMessage = installmentsReady && !installmentsBalanced
    ? installmentsDifferenceCents > 0
      ? `مجموع الاستحقاقات أكبر من إجمالي المديونية بقيمة ${formatMoney(installmentsDifferenceCents / 100)}.`
      : `مجموع الاستحقاقات أقل من إجمالي المديونية بقيمة ${formatMoney(Math.abs(installmentsDifferenceCents) / 100)}.`
    : '';
  const canContinue = step === 0
    ? Boolean(selectedCustomer)
    : step === 1
      ? Boolean(receivableName.trim() && Number(amount))
      : step === 2
        ? guarantorPlan !== null
        : step === 3
          ? selectedGuarantors.length === guarantorLimit
          : step === 4
            ? Boolean(selectedInstallmentCount)
            : step === 5
              ? installmentsBalanced
              : true;

  const handleBack = () => {
    setStep((current) => {
      if (current === 4 && guarantorLimit <= 0) return 2;
      return Math.max(current - 1, 0);
    });
  };

  const handleContinue = () => {
    if (!canContinue) return;
    if (step === 1) {
      setIsAmountConfirmOpen(true);
      return;
    }
    if (step === 2) {
      setStep(typeof guarantorPlan === 'number' && guarantorPlan > 0 ? 3 : 4);
      return;
    }
    if (step === 4) {
      setStep(5);
      return;
    }
    if (step === 5) {
      setStep(6);
      return;
    }
    if (step === 6) {
      setSaveError('');
      setIsInstallmentsConfirmOpen(true);
      return;
    }
    setStep((current) => Math.min(current + 1, 6));
  };

  const confirmAmountAndContinue = () => {
    setIsAmountConfirmOpen(false);
    setStep(2);
  };

  const buildNotes = () => {
    const noteParts = [
      trustReceiptStatus.trim() ? `حالة إيصالات الأمانة: ${trustReceiptStatus.trim()}` : '',
      paperworkStatus.trim() ? `الموقف الورقي: ${paperworkStatus.trim()}` : '',
      extraNotes.trim() ? `ملاحظات إضافية: ${extraNotes.trim()}` : '',
    ].filter(Boolean);

    return noteParts.join('\n') || null;
  };

  const buildManualReceivablePayload = () => {
    const hasPaymentPlan = installments.length > 0;
    const payloadTenantId = selectedCustomer?.tenantId ?? selectedCustomer?.tenant_id ?? tenantId ?? null;
    const payloadBranchId = selectedCustomer?.branchId ?? selectedCustomer?.branch_id ?? branchId ?? null;

    return {
      tenant_id: payloadTenantId,
      branch_id: payloadBranchId,
      partner_id: selectedCustomer?.id ?? null,
      receivable_type: 'customer',
      source_type: 'manual',
      title: receivableName.trim(),
      total_amount: Number(amount) || 0,
      priority: 'normal',
      assigned_to: null,
      created_by: createdBy ?? null,
      notes: buildNotes(),
      has_payment_plan: hasPaymentPlan,
      plan_title: hasPaymentPlan ? 'الخطة الأصلية' : null,
      start_date: hasPaymentPlan ? firstDueDate || installments[0]?.dueDate || null : null,
      installments: hasPaymentPlan
        ? installments.map((installment) => ({
          installment_no: installment.installmentNo,
          due_date: installment.dueDate,
          amount: Number(installment.amount) || 0,
          notes: installment.name.trim(),
        }))
        : [],
      guarantors: selectedGuarantors.map((guarantor, index) => ({
        partner_id: guarantor.id,
        guarantor_order: index + 1,
      })),
    };
  };

  const validateManualReceivablePayload = (payload) => {
    if (!payload.tenant_id) return 'لا يمكن إنشاء مديونية بدون تحديد الشركة.';
    if (!payload.partner_id) return 'اختر العميل.';
    if (!payload.title) return 'اكتب اسم المديونية.';
    if (Number(payload.total_amount) <= 0) return 'إجمالي المديونية يجب أن يكون أكبر من صفر.';

    if (payload.has_payment_plan) {
      if (!payload.installments.length) return 'أضف استحقاق واحد على الأقل.';
      const totalCents = Math.round(Number(payload.total_amount) * 100);
      const installmentsCents = payload.installments.reduce((total, installment) => (
        total + Math.round(Number(installment.amount) * 100)
      ), 0);

      if (installmentsCents !== totalCents) return 'مجموع الاستحقاقات يجب أن يساوي إجمالي المديونية.';
      if (payload.installments.some((installment) => !installment.due_date || Number(installment.amount) <= 0)) {
        return 'كل استحقاق يجب أن يحتوي على تاريخ ومبلغ أكبر من صفر.';
      }
    }

    return '';
  };

  const confirmInstallmentsAndSave = async () => {
    const payload = buildManualReceivablePayload();
    const validationError = validateManualReceivablePayload(payload);

    if (validationError) {
      setSaveError(validationError);
      return;
    }

    setIsSavingReceivable(true);
    setSaveError('');
    const result = await createManualReceivable(payload);
    setIsSavingReceivable(false);

    if (!result.ok) {
      setSaveError(result.error || 'تعذر إنشاء المديونية.');
      return;
    }

    setIsInstallmentsConfirmOpen(false);
    onOpenChange?.(false);
    await onCreated?.(result.data);
  };

  const handleCustomerCreate = async (payload) => {
    if (!onCreateCustomer) {
      return { ok: false, error: 'إضافة العملاء غير متاحة الآن.' };
    }

    const result = await onCreateCustomer(payload);
    if (result?.ok && result.customer) {
      if (customerSheetMode === 'guarantor') {
        addGuarantor(result.customer);
      } else {
        selectCustomer(result.customer);
      }
      setIsCustomerSheetOpen(false);
    }
    return result;
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <style>{`
          .receivable-create-sheet {
            left: 50% !important;
            top: 50% !important;
            height: min(88vh, 760px) !important;
            width: min(calc(100vw - 2rem), 48rem) !important;
            max-width: 48rem !important;
            border: 1px solid rgba(226, 232, 240, 0.92) !important;
            border-radius: 1.5rem;
            box-shadow: 0 28px 80px rgba(2, 6, 23, 0.30), 0 0 0 1px rgba(255,255,255,0.55);
            transform-origin: center;
          }
          .receivable-create-sheet[data-state='open'] {
            animation: receivableCreateFlashIn 240ms cubic-bezier(0.16, 1, 0.3, 1) both !important;
          }
          .receivable-create-sheet[data-state='closed'] {
            animation: receivableCreateFlashOut 130ms ease-in both !important;
          }
          .receivable-date-picker-content[data-state='open'] {
            animation: receivableDatePickerIn 220ms cubic-bezier(0.16, 1, 0.3, 1) both;
          }
          .receivable-date-picker-content[data-state='closed'] {
            animation: receivableDatePickerOut 140ms ease-in both;
          }
          @keyframes receivableCreateFlashIn {
            0% {
              opacity: 0;
              transform: translate(-50%, -47%) scale(0.965);
              filter: brightness(1.08);
            }
            62% {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1.012);
              filter: brightness(1.02);
            }
            100% {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1);
              filter: brightness(1);
            }
          }
          @keyframes receivableCreateFlashOut {
            from {
              opacity: 1;
              transform: translate(-50%, -50%) scale(1);
            }
            to {
              opacity: 0;
              transform: translate(-50%, -49%) scale(0.985);
            }
          }
          @keyframes receivableDatePickerIn {
            from {
              opacity: 0;
              transform: translate(-50%, 1.25rem);
            }
            to {
              opacity: 1;
              transform: translate(-50%, 0);
            }
          }
          @keyframes receivableDatePickerOut {
            from {
              opacity: 1;
              transform: translate(-50%, 0);
            }
            to {
              opacity: 0;
              transform: translate(-50%, 1rem);
            }
          }
        `}</style>
        <SheetContent
          side="left"
          className="receivable-create-sheet max-w-2xl"
          dir="rtl"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <SheetDismissButton />
          <SheetHeader className={cn('border-b-0 bg-white px-7 pt-6', step === 3 || step === 5 ? 'pb-2' : 'pb-6')}>
            <SheetTitle className="text-2xl font-black tracking-tight text-slate-950">مديونية جديدة</SheetTitle>
            {step > 0 ? (
              <div className="mt-3 flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100"
                  aria-label="رجوع"
                  title="رجوع"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
                {step > 0 && selectedCustomer ? (
                  <>
                    <div className="flex min-w-0 max-w-[18rem] items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-right">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-slate-950">{selectedCustomer.name || '--'}</p>
                        <p className="mt-0.5 truncate text-[11px] font-bold text-[#668097]">{selectedCustomer.phone || 'بدون رقم هاتف'}</p>
                      </div>
                    </div>
                    {Number(amount) > 0 ? (
                      <div className="flex shrink-0 items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-right shadow-sm">
                        <div className="border-r-2 border-slate-300 pr-3">
                          <p className="text-[10px] font-black text-slate-500">قيمة المديونية</p>
                          <p className="mt-0.5 text-sm font-black text-slate-950" dir="ltr">{formatMoney(amount)}</p>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
            {stepDescription ? <p className="mt-2 text-sm font-black text-slate-500">{stepDescription}</p> : null}
          </SheetHeader>
          <SheetBody className={cn('min-h-0 bg-white px-7 pb-6', step === 3 || step === 5 ? 'overflow-hidden pt-2' : 'pt-6')}>
            {step === 0 ? (
              <div className="mx-auto w-full max-w-[520px]">
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#668097]" />
                    <Input
                      value={customerName}
                      onChange={(event) => {
                        setCustomerName(event.target.value);
                        setSelectedCustomer(null);
                      }}
                      placeholder="ابحث عن عميل"
                      className="h-[52px] rounded-xl border border-slate-200 bg-white px-5 pr-11 text-base font-bold text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:ring-slate-200"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setCustomerSheetMode('customer');
                      setIsCustomerSheetOpen(true);
                    }}
                    className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200"
                    aria-label="إضافة عميل جديد"
                    title="إضافة عميل جديد"
                  >
                    <UserPlus className="h-5 w-5" />
                  </button>
                </div>

                {filteredCustomers.length > 0 ? (
                  <div className="mt-4 max-h-[320px] overflow-y-auto rounded-xl border border-[#e6c8cf] bg-white shadow-[0_18px_34px_-30px_rgba(78,24,35,0.28)]">
                    {filteredCustomers.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        onClick={() => selectCustomer(customer)}
                        className={cn(
                          'block w-full border-b border-[#f1dde1] px-4 py-3 text-right transition last:border-b-0 hover:bg-[#fcf6f7]',
                          selectedCustomer?.id === customer.id ? 'bg-slate-100 text-slate-900' : 'text-slate-900',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-black">{customer.name}</span>
                            {selectedCustomer?.id === customer.id ? (
                              <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black text-white">مختار</span>
                            ) : null}
                          </span>
                          <span className="mt-1 grid grid-cols-[76px_1fr] gap-2 text-xs font-bold text-[#668097]">
                            <span className="text-[#8aa0b3]">الهاتف</span>
                            <span className="truncate">{customer.phone || 'بدون رقم هاتف'}</span>
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-[#c5ddef] bg-[#f7fbff] px-5 py-4 text-sm font-bold text-[#668097]">
                    لا يوجد عملاء مطابقون.
                  </div>
                )}
              </div>
            ) : step === 1 ? (
              <div className="w-full">
                <div className="mx-auto w-full max-w-[520px] space-y-4">
                  <div className="space-y-2">
                    <label className="block text-sm font-black text-slate-800" htmlFor="receivable-name">
                      اسم المديونية
                    </label>
                    <Input
                      id="receivable-name"
                      value={receivableName}
                      onChange={(event) => setReceivableName(event.target.value)}
                      placeholder="مثال: مديونية شراء موتوسيكل"
                      className="h-[52px] rounded-2xl border border-slate-200 bg-white px-5 text-right text-base font-black text-slate-950 placeholder:text-slate-400 focus:border-slate-400 focus:ring-slate-200"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-black text-slate-800" htmlFor="receivable-amount">
                      إجمالي قيمة المديونية حاليًا
                    </label>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">
                        ج.م
                      </span>
                      <Input
                        id="receivable-amount"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="h-[58px] rounded-2xl border border-slate-200 bg-white px-5 pl-14 text-right text-2xl font-black text-slate-950 placeholder:text-slate-300 focus:border-slate-400 focus:ring-slate-200"
                      />
                    </div>
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={handleContinue}
                  disabled={!canContinue}
                  className="mx-auto mt-6 flex h-12 w-full max-w-[520px] rounded-2xl bg-slate-950 text-base font-black text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  متابعة
                </Button>
              </div>
            ) : step === 2 ? (
              <div className="w-full">
                <div className="mx-auto w-full max-w-[520px] rounded-2xl border border-slate-200 bg-slate-50 p-5">
                  <div className="mb-5">
                    <p className="text-base font-black text-slate-950">عدد الضامنين</p>
                    <p className="mt-1 text-sm font-bold text-slate-500">اختر العدد المطلوب قبل تحديد الأسماء.</p>
                  </div>

                  <div className="grid grid-cols-5 gap-2">
                    {GUARANTOR_PLAN_OPTIONS.map((option) => (
                      <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => selectGuarantorPlan(option.value)}
                        className={cn(
                          'flex h-14 items-center justify-center rounded-xl border text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-slate-100',
                          guarantorPlan === option.value
                            ? 'border-slate-950 bg-slate-950 text-white shadow-sm'
                            : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-100',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => selectGuarantorPlan('later')}
                    className={cn(
                      'mt-4 h-11 w-full rounded-xl border text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-slate-100',
                      guarantorPlan === 'later'
                        ? 'border-slate-950 bg-white text-slate-950 shadow-sm'
                        : 'border-transparent bg-transparent text-slate-500 hover:bg-white hover:text-slate-800',
                    )}
                  >
                    التحديد لاحقًا
                  </button>
                </div>
              </div>
            ) : step === 3 ? (
              <div className="h-full min-h-0 w-full">
                <div className="grid h-full min-h-0 gap-5 lg:grid-cols-[minmax(14rem,0.84fr)_minmax(0,1.16fr)]">
                  <section className="flex min-h-0 min-w-0 flex-col border-l border-slate-200 bg-slate-50 p-4">
                    <div className="flex gap-2">
                      <div className="relative min-w-0 flex-1">
                        <Search className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#668097]" />
                        <Input
                          value={guarantorSearch}
                          onChange={(event) => setGuarantorSearch(event.target.value)}
                          placeholder="ابحث عن ضامن"
                          disabled={selectedGuarantors.length >= guarantorLimit}
                          className="h-[52px] rounded-xl border border-slate-200 bg-white px-5 pr-11 text-base font-bold text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomerSheetMode('guarantor');
                          setIsCustomerSheetOpen(true);
                        }}
                        disabled={selectedGuarantors.length >= guarantorLimit}
                        className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300"
                        aria-label="إضافة ضامن جديد"
                        title="إضافة ضامن جديد"
                      >
                        <UserPlus className="h-5 w-5" />
                      </button>
                    </div>

                    {selectedGuarantors.length >= guarantorLimit ? (
                      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm font-bold text-amber-800">
                        تم الوصول للعدد المحدد للضامنين.
                      </div>
                    ) : filteredGuarantors.length ? (
                      <div className="mt-4 min-h-0 flex-1 overflow-y-auto border-y border-slate-200 bg-white">
                        {filteredGuarantors.map((guarantor) => (
                          <button
                            key={guarantor.id}
                            type="button"
                            onClick={() => addGuarantor(guarantor)}
                            className="block w-full border-b border-slate-100 px-1 py-3 text-right text-slate-900 transition last:border-b-0 hover:bg-slate-50"
                          >
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-black">{guarantor.name}</span>
                              <span className="mt-1 grid grid-cols-[76px_1fr] gap-2 text-xs font-bold text-[#668097]">
                                <span className="text-[#8aa0b3]">الهاتف</span>
                                <span className="truncate">{guarantor.phone || 'بدون رقم هاتف'}</span>
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-[#c5ddef] bg-[#f7fbff] px-5 py-4 text-sm font-bold text-[#668097]">
                        لا يوجد ضامنين مطابقين.
                      </div>
                    )}
                  </section>

                  <section className="flex min-h-0 min-w-0 flex-col">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-slate-950">الضامنين المختارين</p>
                        <p className="mt-1 text-sm font-bold text-slate-500">يمكن المتابعة بدون ضامنين.</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600" dir="ltr">
                        {selectedGuarantors.length}/{guarantorLimit}
                      </span>
                    </div>

                    {selectedGuarantors.length ? (
                      <div className="min-h-0 flex-1 overflow-y-auto border-y border-slate-200">
                        {selectedGuarantors.map((guarantor) => (
                          <div
                            key={guarantor.id}
                            className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-100 bg-white px-1 py-3 last:border-b-0"
                          >
                            <div className="min-w-0 text-right">
                              <p className="truncate text-sm font-black text-slate-950">{guarantor.name}</p>
                              <p className="mt-0.5 truncate text-xs font-bold text-[#668097]">{guarantor.phone || 'بدون رقم هاتف'}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => removeGuarantor(guarantor.id)}
                              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-4 focus:ring-red-100"
                              aria-label={`حذف ${guarantor.name}`}
                              title="حذف الضامن"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex min-h-40 flex-1 items-center justify-center border-y border-dashed border-slate-200 bg-white px-4 py-5 text-center text-sm font-bold leading-6 text-slate-500">
                        لم يتم اختيار ضامنين بعد.
                      </div>
                    )}

                    <Button
                      type="button"
                      onClick={handleContinue}
                      disabled={!canContinue}
                      className="mt-5 h-12 w-full rounded-2xl bg-slate-950 text-base font-black text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      متابعة
                    </Button>
                  </section>
                </div>
              </div>
            ) : step === 4 ? (
              <div className="w-full">
                <div className="mx-auto w-full max-w-[520px]">
                  <div className="mb-5">
                    <p className="text-base font-black text-slate-950">خطة السداد</p>
                    <p className="mt-1 text-sm font-bold text-slate-500">حدد عدد الاستحقاقات لهذه المديونية.</p>
                  </div>

                  <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="grid grid-cols-[3rem_1fr_3rem] items-end gap-3">
                      <button
                        type="button"
                        onClick={() => selectInstallmentCount((selectedInstallmentCount || 1) - 1)}
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-100"
                        aria-label="تقليل عدد الاستحقاقات"
                        title="تقليل"
                      >
                        <Minus className="h-4 w-4" />
                      </button>

                      <div className="min-w-0">
                        <label className="mb-2 block text-center text-sm font-black text-slate-700" htmlFor="installment-count">
                          عدد الاستحقاقات
                        </label>
                        <Input
                          id="installment-count"
                          value={selectedInstallmentCount ?? ''}
                          onChange={(event) => {
                            const nextValue = event.target.value.replace(/[^0-9]/g, '');
                            setManualInstallmentCount(nextValue);
                            selectInstallmentCount(nextValue, { manual: true });
                          }}
                          inputMode="numeric"
                          placeholder="0"
                          className="h-16 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-center text-4xl font-black text-slate-950 placeholder:text-slate-300 focus:border-slate-400 focus:ring-slate-200"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => selectInstallmentCount((selectedInstallmentCount || 0) + 1)}
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-100"
                        aria-label="زيادة عدد الاستحقاقات"
                        title="زيادة"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="mt-4 grid grid-cols-5 gap-2">
                      {QUICK_INSTALLMENT_COUNTS.map((count) => (
                        <button
                          key={count}
                          type="button"
                          onClick={() => selectInstallmentCount(count)}
                          className={cn(
                            'h-9 rounded-xl border text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-slate-100',
                            selectedInstallmentCount === count && !manualInstallmentCount
                              ? 'border-slate-950 bg-slate-950 text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
                          )}
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-3">
	                    <Button
	                      type="button"
	                      onClick={() => {
	                        setSelectedInstallmentCount(null);
	                        setManualInstallmentCount('');
	                        setFirstDueDate('');
	                        setInstallmentAmount('');
	                        setInstallments([]);
	                        setStep(6);
	                      }}
	                      className="h-12 rounded-2xl border border-slate-200 bg-white text-base font-black text-slate-700 shadow-none hover:bg-slate-50"
	                    >
                      تخطي الآن
                    </Button>
                    <Button
                      type="button"
                      onClick={handleContinue}
                      disabled={!canContinue}
                      className="h-12 rounded-2xl bg-slate-950 text-base font-black text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      متابعة
                    </Button>
                  </div>
                </div>
              </div>
            ) : step === 5 ? (
              <div className="h-full min-h-0 w-full">
                <div className="grid h-full min-h-0 gap-5 lg:grid-cols-[minmax(14rem,0.86fr)_minmax(0,1.14fr)]">
                  <section className="min-h-0 border-l border-slate-200 bg-slate-50 p-4">
                    <div className="space-y-3">
                      <div>
                        <label className="mb-1.5 block text-xs font-black text-slate-600" htmlFor="first-due-date-trigger">
                          تاريخ أول استحقاق
                        </label>
                        <button
                          id="first-due-date-trigger"
                          type="button"
                          onClick={() => openDatePicker({ type: 'default', index: null })}
                          className={cn(
                            'flex h-11 w-full items-center justify-between gap-3 rounded-xl border bg-white px-3 text-right text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-slate-100',
                            firstDueDate ? 'border-slate-200 text-slate-950 hover:bg-slate-50' : 'border-red-200 text-red-600 hover:bg-red-50',
                          )}
                        >
                          <CalendarDays className="h-4 w-4 shrink-0 text-slate-400" />
                          <span className="min-w-0 truncate">
                            {firstDueDate ? formatDisplayDate(firstDueDate) : 'اختر تاريخ أول استحقاق'}
                          </span>
                        </button>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-black text-slate-600" htmlFor="installment-amount">
                          قيمة كل استحقاق
                        </label>
                        <div className="relative">
                          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                            ج.م
                          </span>
                          <Input
                            id="installment-amount"
                            value={installmentAmount}
                            onChange={(event) => setInstallmentAmount(event.target.value.replace(/[^0-9.]/g, ''))}
                            inputMode="decimal"
                            className="h-11 rounded-xl border border-slate-200 bg-white px-3 pl-10 text-right text-sm font-black text-slate-950 focus:border-slate-400 focus:ring-slate-200"
                          />
                        </div>
                      </div>
                    </div>

                  </section>

                  <section className="relative flex min-h-0 min-w-0 flex-col">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-black text-slate-950">الاستحقاقات</p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600" dir="ltr">
                        {installmentCount}
                      </span>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto border-y border-slate-200 bg-white pb-20">
                      {installments.map((installment, index) => (
                        <div
                          key={installment.installmentNo}
                          className="border-b border-slate-100 px-1 py-2.5 last:border-b-0"
                        >
                          <div className="grid grid-cols-[3.2rem_1fr_7.75rem] items-center gap-2">
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-center text-xs font-black text-slate-600" dir="ltr">
                              #{installment.installmentNo}
                            </span>
                            <div className="min-w-0 text-right">
                              <Input
                                value={installment.name}
                                onChange={(event) => updateInstallmentName(index, event.target.value)}
                                placeholder="اسم الاستحقاق"
                                className={cn(
                                  'h-8 rounded-lg border bg-white px-2 text-right text-sm font-black focus:border-slate-400 focus:ring-slate-200',
                                  installment.name.trim()
                                    ? 'border-transparent text-slate-950 hover:border-slate-200'
                                    : 'border-red-100 text-red-600 placeholder:text-red-500',
                                )}
                              />
                              <button
                                type="button"
                                onClick={() => openDatePicker({ type: 'installment', index })}
                                className={cn(
                                  'mt-1 flex h-8 max-w-full items-center gap-2 rounded-lg border px-2 text-xs font-black transition focus:outline-none focus:ring-4 focus:ring-slate-100',
                                  installment.dueDate
                                    ? 'border-transparent bg-slate-50 text-[#668097] hover:border-slate-200 hover:bg-white'
                                    : 'border-red-100 bg-red-50 text-red-600 hover:border-red-200',
                                )}
                              >
                                <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">
                                  {installment.dueDate ? formatDisplayDate(installment.dueDate) : 'أدخل تاريخ أول استحقاق'}
                                </span>
                              </button>
                            </div>
                            <div className="relative">
                              <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400">
                                ج.م
                              </span>
                              <Input
                                value={installment.amount}
                                onChange={(event) => updateInstallmentAmount(index, event.target.value)}
                                inputMode="decimal"
                                placeholder="أدخل القيمة"
                                className={cn(
                                  'h-10 rounded-xl border bg-white px-2 pl-8 text-right text-xs font-black focus:border-slate-400 focus:ring-slate-200',
                                  Number(installment.amount) > 0
                                    ? 'border-slate-200 text-slate-950'
                                    : 'border-red-100 text-red-600 placeholder:text-red-500',
                                )}
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-white via-white to-white/70 pt-5">
                      <div className="pointer-events-auto border-t border-slate-200 bg-white px-1 py-3 shadow-[0_-18px_36px_-28px_rgba(15,23,42,0.65)]">
                        <Button
                          type="button"
                          onClick={handleContinue}
                          disabled={!canContinue}
                          className="h-12 w-full rounded-2xl bg-slate-950 text-base font-black text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          متابعة
                        </Button>
                        {installmentsBalanceMessage ? (
                          <p className="mt-2 text-center text-xs font-black leading-5 text-red-600">
                            {installmentsBalanceMessage}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            ) : (
              <div className="mx-auto w-full max-w-[560px]">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-black text-slate-700" htmlFor="trust-receipt-status">
                      حالة إيصالات الأمانة
                    </label>
                    <Input
                      id="trust-receipt-status"
                      value={trustReceiptStatus}
                      onChange={(event) => setTrustReceiptStatus(event.target.value)}
                      placeholder="مثال: تم الاستلام / جاري التجهيز / غير مطلوب"
                      className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-right text-sm font-black text-slate-950 placeholder:text-slate-400 focus:border-slate-400 focus:ring-slate-200"
                    />
	                  </div>

	                  <div>
	                    <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
	                      <label className="text-sm font-black text-slate-700" htmlFor="paperwork-status">
	                        الموقف الورقي
	                      </label>
	                      <span className="text-xs font-bold text-slate-400">
	                        للذي سيبقى للعميل عندنا مثل ورق، حظر بيع، توكيل
	                      </span>
	                    </div>
	                    <Input
	                      id="paperwork-status"
	                      value={paperworkStatus}
	                      onChange={(event) => setPaperworkStatus(event.target.value)}
	                      placeholder="مثال: له ورق وحظر بيع / له توكيل فقط"
	                      className="h-12 rounded-2xl border border-slate-200 bg-white px-4 text-right text-sm font-black text-slate-950 placeholder:text-slate-400 focus:border-slate-400 focus:ring-slate-200"
	                    />
	                  </div>

                  <div>
                    <label className="mb-1.5 block text-sm font-black text-slate-700" htmlFor="receivable-extra-notes">
                      ملاحظات إضافية
                    </label>
                    <textarea
                      id="receivable-extra-notes"
                      value={extraNotes}
                      onChange={(event) => setExtraNotes(event.target.value)}
                      placeholder="أي تفاصيل إضافية مرتبطة بالمديونية"
                      className="min-h-[130px] w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 text-right text-sm font-black leading-7 text-slate-950 outline-none placeholder:text-slate-400 focus:border-slate-400 focus:ring-4 focus:ring-slate-200"
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  onClick={handleContinue}
                  className="mt-5 h-12 w-full rounded-2xl bg-slate-950 text-base font-black text-white shadow-sm hover:bg-slate-800"
                >
                  متابعة
                </Button>
              </div>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      <PartnerFormSheet
        open={isCustomerSheetOpen}
        onOpenChange={setIsCustomerSheetOpen}
        initialValues={NEW_CUSTOMER_INITIAL_VALUES}
        onSubmit={handleCustomerCreate}
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

      <Dialog.Root open={isAmountConfirmOpen} onOpenChange={setIsAmountConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-slate-950/35 backdrop-blur-sm" />
          <Dialog.Content
            dir="rtl"
            className="fixed left-1/2 top-1/2 z-[90] w-[min(calc(100vw-2rem),26rem)] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-slate-200 bg-white p-6 text-right shadow-[0_28px_80px_rgba(15,23,42,0.28)] outline-none"
            onEscapeKeyDown={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
            <Dialog.Title className="text-lg font-black text-slate-950">تأكيد قيمة المديونية</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm font-bold leading-6 text-slate-500">
              راجع المبلغ قبل المتابعة للخطوة التالية.
            </Dialog.Description>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5">
              <p className="text-sm font-black text-slate-500">قيمة المديونية</p>
              <p className="mt-2 text-3xl font-black text-slate-950" dir="ltr">{formattedAmount}</p>
              <p className="mt-3 text-sm font-black leading-7 text-slate-700">{amountWords}</p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Button
                type="button"
                onClick={() => setIsAmountConfirmOpen(false)}
                className="h-11 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-700 shadow-none hover:bg-slate-50"
              >
                تعديل
              </Button>
              <Button
                type="button"
                onClick={confirmAmountAndContinue}
                className="h-11 rounded-2xl bg-slate-950 text-sm font-black text-white shadow-sm hover:bg-slate-800"
              >
                تأكيد
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={isInstallmentsConfirmOpen} onOpenChange={setIsInstallmentsConfirmOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[80] bg-slate-950/35 backdrop-blur-sm" />
          <Dialog.Content
            dir="rtl"
            className="fixed left-1/2 top-1/2 z-[90] flex max-h-[min(88vh,44rem)] w-[min(calc(100vw-2rem),42rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-3xl border border-slate-200 bg-white p-0 text-right shadow-[0_28px_80px_rgba(15,23,42,0.30)] outline-none"
            onEscapeKeyDown={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()}
          >
	            <div className="border-b border-slate-100 px-6 py-5">
	              <Dialog.Title className="text-xl font-black text-slate-950">تأكيد المديونية</Dialog.Title>
	              <Dialog.Description className="mt-1 text-sm font-bold text-slate-500">
	                راجع البيانات قبل حفظ المديونية.
	              </Dialog.Description>
	            </div>

            <div className="grid gap-3 px-6 py-4 sm:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black text-slate-500">العميل</p>
                <p className="mt-1 truncate text-sm font-black text-slate-950">{selectedCustomer?.name || '--'}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black text-slate-500">اسم المديونية</p>
                <p className="mt-1 truncate text-sm font-black text-slate-950">{receivableName || '--'}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[11px] font-black text-slate-500">إجمالي المديونية</p>
                <p className="mt-1 text-sm font-black text-slate-950" dir="ltr">{formatMoney(amount)}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-white">
                <p className="text-[11px] font-black text-white/65">عدد الاستحقاقات</p>
                <p className="mt-1 text-sm font-black" dir="ltr">{installmentCount}</p>
              </div>
            </div>

            <div className="grid gap-3 px-6 pb-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-black text-slate-500">إيصالات الأمانة</p>
                <p className="mt-1 truncate text-sm font-black text-slate-950">{trustReceiptStatus || 'غير محدد'}</p>
              </div>
	              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
	                <p className="text-[11px] font-black text-slate-500">الموقف الورقي</p>
	                <p className="mt-1 truncate text-sm font-black text-slate-950">{paperworkStatus || 'غير محدد'}</p>
	              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-[11px] font-black text-slate-500">ملاحظات</p>
                <p className="mt-1 truncate text-sm font-black text-slate-950">{extraNotes || 'لا توجد'}</p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto border-y border-slate-100">
              {installments.length ? (
                <>
                  <div className="sticky top-0 z-10 grid grid-cols-[2.5rem_minmax(0,1fr)_5.75rem_6.25rem] gap-2 border-b border-slate-100 bg-white px-4 py-2 text-[11px] font-black text-slate-400 sm:grid-cols-[3rem_minmax(0,1fr)_8rem_8rem] sm:px-6">
                    <span>#</span>
                    <span>الاستحقاق</span>
                    <span>التاريخ</span>
                    <span className="text-left">القيمة</span>
                  </div>
                  {installments.map((installment) => (
                    <div
                      key={`confirm-${installment.installmentNo}`}
                      className="grid grid-cols-[2.5rem_minmax(0,1fr)_5.75rem_6.25rem] items-center gap-2 border-b border-slate-100 px-4 py-3 last:border-b-0 sm:grid-cols-[3rem_minmax(0,1fr)_8rem_8rem] sm:px-6"
                    >
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-center text-xs font-black text-slate-600" dir="ltr">
                        {installment.installmentNo}
                      </span>
                      <p className="min-w-0 truncate text-sm font-black text-slate-950">{installment.name}</p>
                      <p className="text-xs font-black text-[#668097]">{formatDisplayDate(installment.dueDate)}</p>
                      <p className="text-left text-sm font-black text-slate-950" dir="ltr">{formatMoney(installment.amount)}</p>
                    </div>
                  ))}
                </>
              ) : (
                <div className="flex min-h-32 items-center justify-center px-6 py-8 text-center text-sm font-black leading-7 text-slate-500">
                  سيتم حفظ المديونية بدون خطة سداد أو استحقاقات.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 px-6 py-5">
              {saveError ? (
                <div className="col-span-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black leading-6 text-red-700">
                  {saveError}
                </div>
              ) : null}
              <Button
                type="button"
                onClick={() => {
                  setSaveError('');
                  setIsInstallmentsConfirmOpen(false);
                }}
                disabled={isSavingReceivable}
                className="h-12 rounded-2xl border border-slate-200 bg-white text-base font-black text-slate-700 shadow-none hover:bg-slate-50"
              >
                تعديل
              </Button>
              <Button
                type="button"
                onClick={confirmInstallmentsAndSave}
                disabled={isSavingReceivable}
                className="h-12 rounded-2xl bg-slate-950 text-base font-black text-white shadow-sm hover:bg-slate-800 disabled:cursor-wait disabled:bg-slate-300"
              >
                {isSavingReceivable ? 'جاري الحفظ...' : 'تأكيد وحفظ'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={isDatePickerOpen} onOpenChange={setIsDatePickerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[95] bg-slate-950/30 backdrop-blur-sm" />
          <Dialog.Content
            dir="rtl"
            className="receivable-date-picker-content fixed bottom-4 left-1/2 z-[100] w-[min(calc(100vw-2rem),28rem)] rounded-3xl border border-slate-200 bg-white p-5 text-right shadow-[0_28px_80px_rgba(15,23,42,0.30)] outline-none"
          >
            <div className="flex items-center justify-between gap-3">
              <Dialog.Title className="text-lg font-black text-slate-950">
                {datePickerTarget.type === 'installment'
                  ? `تاريخ استحقاق ${(datePickerTarget.index + 1).toLocaleString('ar-EG-u-nu-latn')}`
                  : 'اختيار تاريخ الاستحقاق'}
              </Dialog.Title>
              <button
                type="button"
                onClick={() => setIsDatePickerOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-100"
                aria-label="إغلاق"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 flex items-center justify-between rounded-2xl bg-slate-50 p-2">
              <button
                type="button"
                onClick={() => changeCalendarMonth(-1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-100"
                aria-label="الشهر السابق"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <p className="text-base font-black text-slate-950">{formatMonthTitle(calendarMonth)}</p>
              <button
                type="button"
                onClick={() => changeCalendarMonth(1)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-slate-100"
                aria-label="الشهر التالي"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-black text-slate-400">
              {['س', 'ح', 'ن', 'ث', 'ر', 'خ', 'ج'].map((dayName) => (
                <span key={dayName} className="py-1">{dayName}</span>
              ))}
            </div>

            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarDays.map((date, index) => {
                const isoDate = date ? toIsoDate(date) : '';
                const isSelected = selectedDueDate && date && toIsoDate(selectedDueDate) === isoDate;
                const isToday = date && toIsoDate(new Date()) === isoDate;
                return date ? (
                  <button
                    key={isoDate}
                    type="button"
                    onClick={() => selectDueDate(date)}
                    className={cn(
                      'flex h-10 items-center justify-center rounded-xl text-sm font-black transition focus:outline-none focus:ring-4 focus:ring-slate-100',
                      isSelected
                        ? 'bg-slate-950 text-white shadow-sm'
                        : isToday
                          ? 'bg-slate-100 text-slate-950'
                          : 'text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    {date.getDate().toLocaleString('ar-EG-u-nu-latn')}
                  </button>
                ) : (
                  <span key={`blank-${index}`} className="h-10" />
                );
              })}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button
                type="button"
                onClick={() => {
                  const today = new Date();
                  setCalendarMonth(today);
                  selectDueDate(today);
                }}
                className="h-11 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-700 shadow-none hover:bg-slate-50"
              >
                اليوم
              </Button>
              <Button
                type="button"
                onClick={() => {
                  if (datePickerTarget.type === 'installment') {
                    setInstallments((current) => current.map((installment, index) => (
                      index === datePickerTarget.index
                        ? { ...installment, dueDate: '', isDateEdited: true }
                        : installment
                    )));
                  } else {
                    setFirstDueDate('');
                  }
                  setIsDatePickerOpen(false);
                }}
                className="h-11 rounded-2xl bg-slate-950 text-sm font-black text-white shadow-sm hover:bg-slate-800"
              >
                مسح التاريخ
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
