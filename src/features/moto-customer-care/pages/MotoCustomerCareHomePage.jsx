import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, CircleCheck, FileText, PhoneCall, ShieldCheck } from 'lucide-react';
import { PendingProcessorPaperworkDrawer } from '@/features/moto-customer-care/components/PendingProcessorPaperworkDrawer';
import { PendingCustomerNotificationDrawer } from '@/features/moto-customer-care/components/PendingCustomerNotificationDrawer';
import { CustomerNotificationDialog } from '@/features/moto-customer-care/components/CustomerNotificationDialog';
import { VaultPaperworkDrawer } from '@/features/moto-customer-care/components/VaultPaperworkDrawer';
import { PaperworkRequestDetailsDrawer } from '@/features/moto-customer-care/components/PaperworkRequestDetailsDrawer';
import { useMotoCustomerCareSales } from '@/features/moto-customer-care/hooks/useMotoCustomerCareSales';
import { useAuth } from '@/features/auth/hooks/useAuth';

const PAPERWORK_JOURNEY_STATIONS = [
  {
    id: 'preparation',
    label: 'إعداد الأوراق',
    icon: FileText,
    stages: ['preparation', 'owner_confirmation'],
  },
  {
    id: 'processor',
    label: 'عند الجهة',
    icon: Building2,
    stages: ['sent_to_processor', 'processor_ready', 'received_from_processor'],
  },
  {
    id: 'customer',
    label: 'بانتظار العميل',
    icon: PhoneCall,
    stages: ['client_notified'],
  },
  {
    id: 'finished',
    label: 'منتهي',
    icon: CircleCheck,
    stages: ['delivered', 'cancelled'],
  },
];

const PAPERWORK_INTERNAL_STAGE_LABELS = {
  preparation: 'تجهيز بيانات الورق',
  owner_confirmation: 'تحديد صاحب الورق',
  sent_to_processor: 'تم الإرسال للجهة',
  processor_ready: 'الورق جاهز عند الجهة',
  received_from_processor: 'تم استلام الورق من الجهة',
  client_notified: 'تم إبلاغ العميل',
  delivered: 'تم التسليم للعميل',
  cancelled: 'ملغي',
};

function getLicenseStatusLabel(status) {
  if (status === 'licensed') return 'مرخص';
  if (status === 'jawab') return 'جواب';
  return status || '--';
}

function getPaperLicenseSummary(license) {
  if (!license) return 'لا يوجد سجل ترخيص';

  const parts = [getLicenseStatusLabel(license.status)];
  if (license.status === 'licensed') {
    if (license.number) parts.push(`رقم ${license.number}`);
    if (license.expiresAt) parts.push(`ينتهي ${license.expiresAt}`);
    if (license.issuingAuthority) parts.push(license.issuingAuthority);
  }

  return parts.filter(Boolean).join(' / ');
}

function getElapsedStageMeta(value) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const elapsedMs = Math.max(Date.now() - date.getTime(), 0);
  const elapsedHours = Math.floor(elapsedMs / (1000 * 60 * 60));
  const elapsedDays = Math.floor(elapsedMs / (1000 * 60 * 60 * 24));
  const label = elapsedHours < 24
    ? `منذ ${Math.max(elapsedHours, 1).toLocaleString('ar-EG')} ساعة`
    : `منذ ${elapsedDays.toLocaleString('ar-EG')} يوم`;

  if (elapsedDays >= 7) return { label, className: 'bg-red-50 text-red-700 ring-red-200' };
  if (elapsedDays >= 4) return { label, className: 'bg-orange-50 text-orange-700 ring-orange-200' };
  if (elapsedDays >= 2) return { label, className: 'bg-amber-50 text-amber-700 ring-amber-200' };
  return { label, className: 'bg-sky-50 text-sky-700 ring-sky-200' };
}

function CustomerCareIntroPanel({
  pendingProcessorCount = 0,
  vaultPaperworkCount = 0,
  pendingNotificationCount = 0,
  onOpenPendingProcessorPaperwork,
  onOpenVaultPaperwork,
  onOpenPendingNotifications,
}) {
  return (
    <div className="customer-care-fade-up relative z-[45] h-auto min-h-0 overflow-visible bg-[radial-gradient(circle_at_45%_22%,rgba(14,165,233,0.14)_0%,rgba(30,64,175,0.08)_34%,transparent_58%),linear-gradient(145deg,#0b253a_0%,#081d31_52%,#05111f_100%)] px-0 pb-8 pt-16 text-right text-white sm:px-0 sm:pt-20 lg:h-full lg:overflow-hidden lg:bg-none lg:px-8 lg:pb-0 lg:pt-14 xl:px-10">
      <div className="pointer-events-none absolute inset-0 hidden sm:block">
        <span className="absolute left-[10%] top-[11%] h-7 w-7 rounded-md bg-white/12 shadow-[92px_98px_0_rgba(255,255,255,0.08),148px_32px_0_rgba(125,211,252,0.12)]" />
        <span className="absolute right-[13%] top-[34%] h-12 w-12 rounded-lg bg-white/10 shadow-[-38px_142px_0_rgba(125,211,252,0.10),92px_238px_0_rgba(255,255,255,0.08)]" />
        <span className="absolute left-[27%] top-[22%] h-px w-36 rotate-12 bg-gradient-to-r from-transparent via-sky-200/30 to-transparent" />
      </div>
      <div className="relative mt-6 px-6 sm:px-12 lg:mt-12 lg:px-6 xl:mt-16 xl:px-10">
        <p className="mb-2 text-xs font-semibold text-sky-100/65 sm:mb-3 sm:text-sm">Customer Care</p>
        <h1 className="max-w-sm text-3xl font-bold leading-tight text-white sm:text-5xl">
          خدمة عملاء الموتوسيكلات
        </h1>
        <p className="mt-3 max-w-md text-sm font-semibold leading-6 text-sky-50/65 sm:text-base sm:leading-7">
          متابعة البيع، الأوراق، وحالة القطع بعد التسليم.
        </p>
        <div className="mt-6 flex flex-wrap justify-start gap-3">
          <button
            type="button"
            onClick={onOpenPendingProcessorPaperwork}
            className="inline-flex min-h-12 items-center gap-3 rounded-xl border border-white/20 bg-white/[0.13] px-4 py-2.5 text-right text-white shadow-[0_14px_30px_rgba(3,7,18,0.16)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/[0.20] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25"
            aria-label={`الأوراق المرسلة للجهات: ${pendingProcessorCount} طلب`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-400 text-white shadow-sm">
              <Building2 className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-black leading-4 text-white">الأوراق المرسلة للجهات</span>
              <span className="mt-0.5 block text-[10px] font-bold leading-4 text-sky-100/75">
                {pendingProcessorCount.toLocaleString('ar-EG')} بانتظار الاستلام
              </span>
            </span>
          </button>
          {pendingNotificationCount > 0 ? (
            <button
              type="button"
              onClick={onOpenPendingNotifications}
              className="inline-flex min-h-12 items-center gap-3 rounded-xl border border-white/20 bg-white/[0.13] px-4 py-2.5 text-right text-white shadow-[0_14px_30px_rgba(3,7,18,0.16)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/[0.20] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25"
              aria-label={`بانتظار الإبلاغ: ${pendingNotificationCount} عميل`}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm"><PhoneCall className="h-4.5 w-4.5" /></span>
              <span className="min-w-0">
                <span className="block text-xs font-black leading-4 text-white">بانتظار الإبلاغ</span>
                <span className="mt-0.5 block text-[10px] font-bold leading-4 text-sky-100/75">{pendingNotificationCount.toLocaleString('ar-EG')} عميل</span>
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenVaultPaperwork}
            className="inline-flex min-h-12 items-center gap-3 rounded-xl border border-white/20 bg-white/[0.13] px-4 py-2.5 text-right text-white shadow-[0_14px_30px_rgba(3,7,18,0.16)] backdrop-blur-md transition hover:-translate-y-0.5 hover:border-white/35 hover:bg-white/[0.20] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/25"
            aria-label={`الأوراق الموجودة: ${vaultPaperworkCount} ورقة`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white shadow-sm">
              <ShieldCheck className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-black leading-4 text-white">الأوراق الموجودة</span>
              <span className="mt-0.5 block text-[10px] font-bold leading-4 text-sky-100/75">
                {vaultPaperworkCount.toLocaleString('ar-EG')} في الخزنة
              </span>
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

function getPaperworkCurrentStation(currentStage, stageEnteredAt) {
  const index = PAPERWORK_JOURNEY_STATIONS.findIndex((station) => station.stages.includes(currentStage));
  const normalizedIndex = index >= 0 ? index : 0;
  const progressPercent = Math.round(((normalizedIndex + 1) / PAPERWORK_JOURNEY_STATIONS.length) * 100);

  return {
    station: index >= 0 ? PAPERWORK_JOURNEY_STATIONS[index] : null,
    stageLabel: PAPERWORK_INTERNAL_STAGE_LABELS[currentStage] || currentStage || '',
    progressPercent,
    stepNumber: normalizedIndex + 1,
    totalSteps: PAPERWORK_JOURNEY_STATIONS.length,
    elapsed: getElapsedStageMeta(stageEnteredAt),
  };
}

function PaperworkCurrentStageCard({ currentStation }) {
  if (!currentStation.station) return null;

  return (
    <div className="inline-flex w-full max-w-[15.5rem] flex-col justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-right shadow-[0_10px_24px_rgba(15,23,42,0.08)] ring-1 ring-slate-100 lg:w-[15.5rem]">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="hidden max-w-full truncate text-[10px] font-black leading-4 text-slate-400 lg:block">
            مرحلة الطلب
          </span>
          <span className="mt-0.5 flex max-w-full items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-black leading-5 text-slate-950">
              {currentStation.stageLabel || currentStation.station.label}
            </span>
          </span>
        </div>
        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black leading-4 ring-1 ${currentStation.elapsed?.className || 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
          {currentStation.elapsed?.label || 'المدة غير محددة'}
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200" dir="rtl">
        <span
          className="block h-full rounded-full bg-cyan-500 transition-all"
          style={{ width: `${currentStation.progressPercent}%` }}
        />
      </div>
    </div>
  );
}

function PaperworkRequestCard({ request, onOpen }) {
  const processorName = request.processor?.name || '';
  const missingProcessor = request.license?.status === 'jawab' && !processorName;
  const licenseSummary = request.license?.status === 'jawab'
    ? `جواب تاجر: ${processorName || 'لم تحدد جهة الإصدار'}`
    : getPaperLicenseSummary(request.license);
  const currentStage = request.currentStage || request.stage?.code || '';
  const documentOwnerName = request.documentOwnerName
    || request.documentOwner?.name
    || (request.documentOwnerStatus === 'later' ? 'يُحدد لاحقًا' : 'غير محدد');
  const guardianshipCode = String(request.documentOwnerNote || '').match(/حالة الوصاية:\s*([^\n]+)/)?.[1]?.trim();
  const guardianshipLabel = {
    father_guardian: 'وصاية والده',
    mother_guardian: 'وصاية والدته',
    none: 'بدون وصاية',
  }[guardianshipCode] || guardianshipCode || '';
  const currentStation = getPaperworkCurrentStation(
    currentStage,
    request.stageEnteredAt || request.stage_entered_at || request.createdAt || request.created_at,
  );

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(request)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen?.(request);
        }
      }}
      className="relative mb-3 cursor-pointer rounded-xl border border-white/70 bg-white px-4 py-5 shadow-[0_12px_30px_rgba(15,23,42,0.12)] outline-none transition hover:bg-blue-50/55 focus-visible:bg-blue-50/55 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 lg:mb-0 lg:rounded-none lg:border-0 lg:shadow-none lg:before:absolute lg:before:inset-x-5 lg:before:top-0 lg:before:h-px lg:before:bg-slate-200 lg:first:before:hidden"
      aria-label={`عرض تفاصيل طلب أوراق ${request.productName || ''}`}
    >
      <div className="flex min-w-0 flex-col lg:min-h-[5.75rem] lg:flex-row lg:items-center lg:gap-5">
        <div className="min-w-0 lg:w-[18rem] lg:shrink-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className="min-w-0 truncate text-sm font-black text-slate-950" title={request.productName}>
              {request.productName}
            </h2>
            <span className="shrink-0 text-[10px] font-bold text-slate-500">
              باسم: {documentOwnerName}
            </span>
            {request.documentOwnerStatus !== 'later' && guardianshipLabel ? (
              <span className="shrink-0 text-[9px] font-bold text-slate-400">· {guardianshipLabel}</span>
            ) : null}
          </div>
          <div className="mt-2 flex min-w-0 items-start gap-2 lg:mt-1 lg:block">
            <div className="min-w-0 flex-1">
              <div>
                <span
                  className={`inline-flex max-w-full truncate rounded-md border px-2 py-0.5 text-xs font-black leading-5 shadow-sm ${
                    missingProcessor
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : request.license
                        ? 'border-blue-200 bg-blue-50 text-blue-800'
                        : 'border-amber-200 bg-amber-50 text-amber-800'
                  }`}
                  title={licenseSummary}
                >
                  {licenseSummary}
                </span>
              </div>
              <p className="mt-1 text-[11px] font-bold text-slate-400">
                ضمن الفاتورة
                <span className="mr-1 font-black text-slate-600">
                  {request.customer?.name || 'عميل غير محدد'}
                </span>
              </p>
            </div>
          </div>
          <div className="mt-3 flex justify-start lg:hidden">
            <PaperworkCurrentStageCard currentStation={currentStation} />
          </div>
        </div>
        <div className="hidden min-w-0 flex-1 items-center justify-center lg:flex">
          <PaperworkCurrentStageCard currentStation={currentStation} />
        </div>
      </div>
    </article>
  );
}

function PaperworkRequestsCard({ requests, isLoading, error, onOpen }) {
  return (
    <section className="customer-care-operations-window customer-care-fade-up min-h-0 px-4 pb-6 text-slate-950 sm:px-6 lg:relative lg:z-[80] lg:m-0 lg:flex lg:h-full lg:w-full lg:max-w-none lg:items-center lg:justify-center lg:justify-self-stretch lg:px-0 lg:pb-0 lg:py-10 lg:pl-20 lg:pr-28 xl:pl-28 xl:pr-36">
      <div className="relative z-10 flex h-auto min-h-0 w-full max-w-none flex-col overflow-visible rounded-none border-0 bg-transparent shadow-none lg:h-[calc(100%-0.5rem)] lg:max-w-[51rem] lg:translate-x-4 lg:translate-y-4 lg:overflow-hidden lg:rounded-t-[1.35rem] lg:rounded-b-lg lg:border lg:border-white/70 lg:bg-white lg:shadow-[0_22px_48px_rgba(3,7,18,0.22)] xl:translate-x-6">
        <div className="relative z-10 hidden min-h-[4.75rem] flex-shrink-0 items-center gap-3 bg-white px-4 py-4 text-slate-950 shadow-[0_1px_0_rgba(15,23,42,0.08),0_10px_18px_rgba(15,23,42,0.035)] after:pointer-events-none after:absolute after:inset-x-4 after:bottom-0 after:h-px after:bg-gradient-to-l after:from-transparent after:via-slate-200 after:to-transparent sm:px-7 sm:after:inset-x-7 lg:flex lg:min-h-[6.25rem] lg:px-6 lg:py-6">
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-blue-700 shadow-sm">
              <FileText className="h-6 w-6" />
            </span>
            <div className="min-w-0 text-right">
              <h2 className="truncate text-2xl font-black leading-8 text-slate-950 sm:text-3xl sm:leading-10">طلبات الأوراق</h2>
              <p className="mt-1 text-sm font-black leading-5 text-slate-500">
                أحدث الطلبات · {requests.length.toLocaleString('ar-EG')} طلب
              </p>
            </div>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-visible bg-transparent lg:bg-slate-50/70 lg:overflow-y-auto">
          {isLoading ? (
            <div className="flex h-full min-h-40 items-center justify-center bg-white px-6 text-center text-base font-black leading-7 text-slate-500">
              جاري تحميل طلبات الأوراق
            </div>
          ) : error ? (
            <div className="m-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">
              {error}
            </div>
          ) : requests.length ? (
            <div>
              {requests.map((request) => (
                <PaperworkRequestCard
                  key={request.id}
                  request={request}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ) : (
            <div className="flex h-full min-h-40 items-center justify-center bg-white px-6 text-center text-base font-black leading-7 text-slate-500">
              لا توجد طلبات أوراق حتى الآن
            </div>
          )}
          <Link
            to="/app/moto-customer-care/legacy"
            className="absolute bottom-4 left-5 text-[11px] font-bold text-slate-300 transition hover:text-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
          >
            النسخة القديمة
          </Link>
        </div>
      </div>
    </section>
  );
}

export function MotoCustomerCareHomePage() {
  const { tenant_user: tenantUser } = useAuth();
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [notificationRequest, setNotificationRequest] = useState(null);
  const [pendingProcessorPaperworkOpen, setPendingProcessorPaperworkOpen] = useState(false);
  const [vaultPaperworkOpen, setVaultPaperworkOpen] = useState(false);
  const [pendingNotificationsOpen, setPendingNotificationsOpen] = useState(false);
  const {
    tenantId,
    paperworkRequests,
    paperworkDocuments,
    paperworkReports,
    sectionStatus,
    isLoading,
    error,
    refresh,
    updatePaperworkRequestLocally,
    ensurePaperworkLoaded,
  } = useMotoCustomerCareSales({ limit: 20, enabled: true, activeSection: 'requests' });
  const recentRequests = useMemo(() => (
    [...paperworkRequests]
      .sort((left, right) => (
        new Date(right.createdAt || right.created_at || 0)
        - new Date(left.createdAt || left.created_at || 0)
      ))
      .slice(0, 20)
  ), [paperworkRequests]);
  const pendingProcessorRequestsCount = useMemo(() => (
    paperworkRequests.filter((request) => (
      ['sent_to_processor', 'processor_ready'].includes(request.currentStage)
    )).length
  ), [paperworkRequests]);
  const pendingNotificationCount = useMemo(() => (
    paperworkRequests.filter((request) => request.currentStage === 'received_from_processor').length
  ), [paperworkRequests]);

  useEffect(() => {
    if (typeof document === 'undefined') {
      return undefined;
    }

    const hasOpenRequestDetails = Boolean(selectedRequest) || Boolean(notificationRequest) || pendingProcessorPaperworkOpen || vaultPaperworkOpen || pendingNotificationsOpen;
    document.documentElement.classList.toggle('customer-care-section-open', hasOpenRequestDetails);
    document.body.classList.toggle('customer-care-section-open', hasOpenRequestDetails);

    return () => {
      document.documentElement.classList.remove('customer-care-section-open');
      document.body.classList.remove('customer-care-section-open');
    };
  }, [notificationRequest, pendingNotificationsOpen, pendingProcessorPaperworkOpen, selectedRequest, vaultPaperworkOpen]);

  return (
    <section className="relative flex min-h-0 flex-1 flex-col items-stretch overflow-y-auto overflow-x-hidden text-white lg:overflow-hidden" dir="rtl">
      <style>{`
        .customer-care-operations-window {
          font-size: 0.94rem;
        }
        .customer-care-operations-window .text-sm {
          font-size: 0.82rem;
          line-height: 1.25rem;
        }
        @media (max-width: 1023px) {
          .customer-care-app-back-button {
            display: inline-flex !important;
            top: calc(env(safe-area-inset-top) + 0.75rem) !important;
            right: 1rem !important;
          }
        }
      `}</style>
      <div className="relative z-10 grid min-h-full w-full max-w-none flex-none gap-0 overflow-visible lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(34rem,1.28fr)] lg:items-stretch lg:overflow-hidden lg:bg-[radial-gradient(circle_at_28%_18%,rgba(14,165,233,0.14)_0%,rgba(30,64,175,0.08)_32%,transparent_58%),linear-gradient(145deg,#0b253a_0%,#081d31_52%,#05111f_100%)]">
        <CustomerCareIntroPanel
          pendingProcessorCount={pendingProcessorRequestsCount}
          vaultPaperworkCount={paperworkReports.vault}
          pendingNotificationCount={pendingNotificationCount}
          onOpenPendingProcessorPaperwork={() => setPendingProcessorPaperworkOpen(true)}
          onOpenVaultPaperwork={() => {
            setVaultPaperworkOpen(true);
            ensurePaperworkLoaded();
          }}
          onOpenPendingNotifications={() => setPendingNotificationsOpen(true)}
        />
        <PaperworkRequestsCard
          requests={recentRequests}
          isLoading={isLoading}
          error={error}
          onOpen={(request) => {
            setSelectedRequest(request);
          }}
        />
      </div>
      <PaperworkRequestDetailsDrawer
        request={selectedRequest}
        open={Boolean(selectedRequest)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedRequest(null);
          }
        }}
        tenantId={tenantId}
        canManageProcessor={tenantUser?.role === 'owner'}
        onCustomerConfirmed={(confirmation) => {
          if (!selectedRequest?.id || !confirmation) return;

          const patch = {
            customerConfirmed: true,
            customerConfirmedAt: confirmation.customerConfirmedAt,
            customerConfirmedBy: confirmation.customerConfirmedBy,
            customerConfirmedByName: confirmation.customerConfirmedByName,
          };

          updatePaperworkRequestLocally(selectedRequest.id, patch);
          setSelectedRequest((current) => (
            current?.id === selectedRequest.id ? { ...current, ...patch } : current
          ));
        }}
        onRequestSent={(result) => {
          if (!selectedRequest?.id || !result) return;

          const patch = {
            currentStage: result.currentStage,
            stageEnteredAt: result.updatedAt,
            stage: {
              code: result.currentStage,
              name: 'تم الإرسال للجهة',
            },
            updatedAt: result.updatedAt,
          };

          updatePaperworkRequestLocally(selectedRequest.id, patch);
          setSelectedRequest((current) => (
            current?.id === selectedRequest.id ? { ...current, ...patch } : current
          ));
        }}
        onCustomerNotified={(result) => {
          updatePaperworkRequestLocally(result.requestId, {
            currentStage: result.currentStage,
            stageEnteredAt: result.updatedAt,
            stage: { code: result.currentStage, name: 'تم إبلاغ العميل' },
            updatedAt: result.updatedAt,
          });
          refresh();
        }}
        onDelivered={(result) => {
          updatePaperworkRequestLocally(result.requestId, {
            currentStage: result.currentStage,
            status: result.status,
            stageEnteredAt: result.updatedAt,
            stage: { code: result.currentStage, name: 'تم التسليم للعميل' },
            updatedAt: result.updatedAt,
          });
          refresh();
        }}
        onSaved={(processor) => {
          if (!selectedRequest?.id || !processor) return;

          const nextProcessor = {
            id: processor.id,
            name: processor.name,
            phone: processor.phone,
            phone1: processor.phone,
            parentName: processor.parentName || '',
            functionTitle: processor.subtitle || '',
            subtitle: processor.subtitle || '',
          };

          updatePaperworkRequestLocally(selectedRequest.id, {
            processorPartnerId: processor.id,
            processor: nextProcessor,
          });
          setSelectedRequest((current) => (
            current?.id === selectedRequest.id
              ? { ...current, processorPartnerId: processor.id, processor: nextProcessor }
              : current
          ));
        }}
        onReceived={refresh}
      />
      <PendingProcessorPaperworkDrawer
        open={pendingProcessorPaperworkOpen}
        onOpenChange={setPendingProcessorPaperworkOpen}
        requests={paperworkRequests}
        tenantId={tenantId}
        onReceived={(receivedItems = []) => {
          receivedItems.forEach((item) => {
            updatePaperworkRequestLocally(item.requestId, {
              currentStage: 'received_from_processor',
              stageEnteredAt: item.updatedAt,
              stage: {
                code: 'received_from_processor',
                name: 'تم استلام الورق من الجهة',
              },
              updatedAt: item.updatedAt,
            });
          });
          refresh();
        }}
      />
      <VaultPaperworkDrawer
        open={vaultPaperworkOpen}
        onOpenChange={setVaultPaperworkOpen}
        documents={paperworkDocuments}
        isLoading={sectionStatus.papers === 'loading'}
      />
      <PendingCustomerNotificationDrawer
        open={pendingNotificationsOpen}
        onOpenChange={setPendingNotificationsOpen}
        requests={paperworkRequests}
        onOpenRequest={(request) => {
          setNotificationRequest(request);
        }}
      />
      <CustomerNotificationDialog
        request={notificationRequest}
        open={Boolean(notificationRequest)}
        tenantId={tenantId}
        onNotified={(result) => {
          updatePaperworkRequestLocally(result.requestId, {
            currentStage: result.currentStage,
            stageEnteredAt: result.updatedAt,
            stage: { code: result.currentStage, name: 'تم إبلاغ العميل' },
            updatedAt: result.updatedAt,
          });
          refresh();
        }}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setNotificationRequest(null);
        }}
      />
    </section>
  );
}
