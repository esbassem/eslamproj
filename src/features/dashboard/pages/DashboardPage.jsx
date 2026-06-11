import * as Dialog from '@radix-ui/react-dialog';
import { ImagePlus, MoreHorizontal, PackagePlus, Settings, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { uiExperiments } from '@/core/config/app.config';
import { ROUTES } from '@/core/config/routes.config';
import { useI18n } from '@/core/i18n/useI18n';
import { Button } from '@/core/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/core/ui/dropdown-menu';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { PageHeader } from '@/core/ui/page-header';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDismissButton,
  SheetTitle,
} from '@/core/ui/sheet';
import { useAppContext } from '@/contexts/AppContext';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { PartnerFormSheet } from '@/features/contacts/components/PartnerFormSheet';
import { partnersService } from '@/features/contacts/services/partners.service';
import { QuickImageUploadSheet } from '@/features/dashboard/components/QuickImageUploadSheet';
import { QuickStockUnitSheet } from '@/features/dashboard/components/QuickStockUnitSheet';
import { resolveModuleIcon } from '@/features/modules/modules.navigation';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { appsService } from '@/services/apps.service';

const DEFAULT_APP_ICON_COLOR = '#64748B';
const NEW_CUSTOMER_INITIAL_VALUES = {
  isCustomer: true,
  isSupplier: false,
};

function getReadableColor(hexColor) {
  const normalized = String(hexColor || '').replace('#', '');

  if (normalized.length !== 6) {
    return '#ffffff';
  }

  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  return luminance > 0.62 ? '#0f172a' : '#ffffff';
}

export function DashboardPage() {
  const { t } = useI18n();
  const { tenant } = useWorkspace();
  const { apps, appsStatus, appsError, installApp, uninstallApp } = useAppContext();
  const { user, tenant_user: tenantUser } = useAuth();
  const isOwner = tenantUser?.role === 'owner';
  const navigate = useNavigate();
  const [launchingApp, setLaunchingApp] = useState(null);
  const launchTimeoutRef = useRef(null);
  const [uninstallDialog, setUninstallDialog] = useState({ open: false, app: null });
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [installingAppId, setInstallingAppId] = useState(null);
  const [toast, setToast] = useState(null);
  const [catalogApps, setCatalogApps] = useState([]);
  const [catalogStatus, setCatalogStatus] = useState('idle');
  const [catalogError, setCatalogError] = useState(null);
  const [selectedCatalogApp, setSelectedCatalogApp] = useState(null);
  const [isCustomerSheetOpen, setIsCustomerSheetOpen] = useState(false);
  const [isCustomerSubmitting, setIsCustomerSubmitting] = useState(false);
  const [isImageUploadSheetOpen, setIsImageUploadSheetOpen] = useState(false);
  const [isStockUnitSheetOpen, setIsStockUnitSheetOpen] = useState(false);
  const dashboardApps = apps.filter((app) => app.code !== 'dashboard');
  const launcherApps = dashboardApps.some((app) => app.code === 'settings') || !isOwner
    ? dashboardApps
    : [
        ...dashboardApps,
        {
          id: 'launcher-settings',
          code: 'settings',
          name: 'الإعدادات',
          titleKey: 'navigation.settings',
          icon: Settings,
          iconColor: DEFAULT_APP_ICON_COLOR,
          href: ROUTES.settings,
        },
      ];
  const firstName = user?.fullName?.trim()?.split(' ')[0];
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'صباح الخير' : hour < 17 ? 'مساء الخير' : 'مساء النور';
  const dateStr = now.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' });

  useEffect(() => {
    const viewportMeta = document.querySelector('meta[name="viewport"]');
    if (!viewportMeta) return undefined;

    const previousViewport = viewportMeta.getAttribute('content') || 'width=device-width, initial-scale=1.0';
    viewportMeta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no');

    const preventPinchZoom = (event) => {
      if (event.touches?.length > 1) {
        event.preventDefault();
      }
    };
    const preventGestureZoom = (event) => {
      event.preventDefault();
    };

    document.addEventListener('touchmove', preventPinchZoom, { passive: false });
    document.addEventListener('gesturestart', preventGestureZoom, { passive: false });
    document.addEventListener('gesturechange', preventGestureZoom, { passive: false });

    return () => {
      viewportMeta.setAttribute('content', previousViewport);
      document.removeEventListener('touchmove', preventPinchZoom);
      document.removeEventListener('gesturestart', preventGestureZoom);
      document.removeEventListener('gesturechange', preventGestureZoom);
    };
  }, []);

  useEffect(() => {
    if (!toast) return undefined;

    const timerId = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(timerId);
  }, [toast]);

  useEffect(
    () => () => {
      if (launchTimeoutRef.current) {
        window.clearTimeout(launchTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    let mounted = true;

    if (!tenant?.id || !isOwner) {
      setCatalogApps([]);
      setCatalogStatus('idle');
      setCatalogError(null);
      return undefined;
    }

    setCatalogStatus('loading');
    setCatalogError(null);

    appsService
      .getApplicationModulesWithTenantState(tenant.id)
      .then((items) => {
        if (!mounted) {
          return;
        }

        setCatalogApps(items);
        setCatalogStatus('ready');
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }

        setCatalogApps([]);
        setCatalogStatus('error');
        setCatalogError(error);
      });

    return () => {
      mounted = false;
    };
  }, [isOwner, tenant?.id]);

  const handleLaunchApp = (event, item) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    setLaunchingApp(item);
    launchTimeoutRef.current = window.setTimeout(() => navigate(item.href), 85);
  };

  const openUninstallDialog = (app) => {
    setUninstallDialog({ open: true, app });
  };

  const handleConfirmUninstall = async () => {
    const app = uninstallDialog.app;

    if (!app) {
      return;
    }

    setIsUninstalling(true);

    try {
      await uninstallApp(app);
      setCatalogApps((items) =>
        items.map((item) =>
          item.id === app.id
            ? {
                ...item,
                tenantState: 'uninstalled',
                isInstalled: false,
                uninstalledAt: new Date().toISOString(),
              }
            : item,
        ),
      );
      setToast({ tone: 'success', message: 'تمت إزالة تثبيت التطبيق.' });
      setUninstallDialog({ open: false, app: null });
    } catch (error) {
      setToast({ tone: 'error', message: error.message || 'تعذر إزالة تثبيت التطبيق. حاول مرة أخرى.' });
    } finally {
      setIsUninstalling(false);
    }
  };

  const handleInstallApp = async (app) => {
    setInstallingAppId(app.id);

    try {
      await installApp(app);
      setCatalogApps((items) =>
        items.map((item) =>
          item.id === app.id
            ? {
                ...item,
                tenantState: 'installed',
                isInstalled: true,
                installedAt: new Date().toISOString(),
                uninstalledAt: null,
              }
            : item,
        ),
      );
      setToast({ tone: 'success', message: 'تم تثبيت التطبيق.' });
      return true;
    } catch (error) {
      setToast({ tone: 'error', message: error.message || 'تعذر تثبيت التطبيق. حاول مرة أخرى.' });
      return false;
    } finally {
      setInstallingAppId(null);
    }
  };

  const handleCreateCustomer = async (payload) => {
    if (!tenant?.id) {
      return { ok: false, error: 'لا توجد شركة نشطة.' };
    }

    try {
      setIsCustomerSubmitting(true);
      await partnersService.createPartner({
        tenantId: tenant.id,
        ...payload,
        isCustomer: true,
        customerRank: 1,
        isSupplier: Boolean(payload.isSupplier),
        supplierRank: payload.isSupplier ? 1 : 0,
      });
      setIsCustomerSheetOpen(false);
      setToast({ tone: 'success', message: 'تم تسجيل العميل.' });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'تعذر إضافة العميل.' };
    } finally {
      setIsCustomerSubmitting(false);
    }
  };

  if (uiExperiments.homeLauncherNavigation) {
    return (
      <div className="relative flex min-h-[calc(100dvh-5.5rem)] w-full flex-col items-center overflow-hidden px-4 pb-6 pt-3 text-slate-700 sm:min-h-[calc(100vh-9rem)] sm:px-10 sm:pb-2 sm:pt-5 lg:px-16 lg:pt-6">
        <style>{`
          @keyframes fadeUp {
            from { opacity: 0; transform: translateY(12px); }
            to   { opacity: 1; transform: translateY(0); }
          }
          .fade-up { animation: fadeUp 0.24s ease both; }
          .app-launching { transform: scale(0.985); filter: brightness(1.04); }
        `}</style>

        <div className="pointer-events-none absolute inset-0 hidden sm:block">
          <span className="absolute left-[8%] top-[18%] h-7 w-7 rounded-md bg-slate-200/60 shadow-[7px_34px_0_rgba(226,232,240,0.75),14px_68px_0_rgba(226,232,240,0.55)]" />
          <span className="absolute right-[9%] top-[28%] h-12 w-12 rounded-lg bg-slate-200/70 shadow-[-34px_92px_0_rgba(148,163,184,0.42),28px_224px_0_rgba(226,232,240,0.55)]" />
          <span className="absolute bottom-[12%] left-[14%] h-5 w-5 rounded bg-slate-200/70 shadow-[270px_-6px_0_rgba(226,232,240,0.75),288px_18px_0_rgba(226,232,240,0.55)]" />
          <span className="absolute right-[17%] top-[11%] h-4 w-4 rounded bg-slate-300/70 shadow-[28px_-18px_0_rgba(226,232,240,0.75)]" />
          <span className="absolute left-[18%] top-[9%] h-24 w-24 rounded-[1.75rem] border border-white/70 bg-white/35 shadow-[0_22px_55px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-sm" />
          <span className="absolute right-[20%] bottom-[18%] h-20 w-20 rounded-[1.5rem] border border-white/70 bg-white/40 shadow-[0_20px_48px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-sm" />
          <span className="absolute left-[7%] bottom-[28%] h-11 w-11 rounded-xl bg-red-400/18 shadow-[24px_-82px_0_rgba(248,113,113,0.14),92px_120px_0_rgba(248,113,113,0.10)]" />
          <span className="absolute right-[7%] top-[47%] h-9 w-9 rounded-lg bg-red-500/16 shadow-[-66px_-120px_0_rgba(248,113,113,0.12),-18px_156px_0_rgba(248,113,113,0.10)]" />
          <span className="absolute left-[32%] top-[24%] h-px w-44 rotate-12 bg-gradient-to-r from-transparent via-red-400/45 to-transparent" />
          <span className="absolute right-[25%] top-[16%] h-px w-36 -rotate-12 bg-gradient-to-r from-transparent via-red-400/40 to-transparent" />
          <span className="absolute bottom-[9%] right-[36%] h-px w-52 rotate-6 bg-gradient-to-r from-transparent via-red-300/35 to-transparent" />
          <span className="absolute left-[42%] top-[13%] h-3 w-3 rounded-sm bg-red-400/35 shadow-[34px_22px_0_rgba(248,113,113,0.22),-28px_210px_0_rgba(248,113,113,0.16)]" />
          <span className="absolute right-[13%] bottom-[11%] h-3 w-3 rounded-sm bg-slate-300/65 shadow-[18px_0_0_rgba(226,232,240,0.75),36px_0_0_rgba(226,232,240,0.55),0_-18px_0_rgba(226,232,240,0.65),18px_-18px_0_rgba(248,113,113,0.18)]" />
        </div>

        <section className="relative z-10 grid w-full max-w-6xl gap-5 sm:gap-4 lg:grid-cols-[minmax(0,0.82fr)_minmax(30rem,38rem)] lg:items-start">
          <div className="fade-up text-right lg:pt-2" dir="rtl" style={{ animationDelay: '0s' }}>
            <p className="mb-2 text-xs font-semibold text-slate-500 sm:mb-4 sm:text-sm">{dateStr}</p>
            <h1 className="max-w-xl text-3xl font-bold leading-tight text-slate-900 sm:text-6xl">
              {greeting}
              {firstName ? `، ${firstName}` : ''}
            </h1>
            <p className="mt-2 max-w-lg text-sm font-semibold leading-6 text-slate-700 sm:mt-5 sm:text-xl sm:leading-8">
              يوم جديد لتنظيم عملك واتخاذ قرارات أوضح.
            </p>
            <p className="mt-1 max-w-md text-xs font-medium leading-6 text-slate-500 sm:mt-3 sm:text-base sm:leading-7">
              {tenant?.name ? `مساحة عمل ${tenant.name}` : 'اختر التطبيق الذي تريد العمل عليه.'}
            </p>
              <QuickCreateTools
                onCreateCustomer={() => setIsCustomerSheetOpen(true)}
                onCreateStockUnit={() => setIsStockUnitSheetOpen(true)}
                onOpenImageUpload={() => setIsImageUploadSheetOpen(true)}
              />
          </div>

          <div className="fade-up w-full lg:mt-16" dir="rtl" style={{ animationDelay: '0.06s' }}>
            {appsStatus === 'loading' || appsStatus === 'idle' ? (
              <div className="rounded-2xl border border-white/75 bg-white/55 py-16 shadow-[0_18px_45px_rgba(15,23,42,0.10)] backdrop-blur-md">
                <LoadingSpinner title="جاري التحميل…" />
              </div>
            ) : appsError ? (
              <div className="rounded-2xl border border-white/80 bg-white/70 p-6 text-center text-sm text-slate-600 shadow-[0_20px_55px_rgba(15,23,42,0.10)]">
                تعذر تحميل التطبيقات المثبتة. حاول تحديث الصفحة أو مراجعة الاتصال.
              </div>
            ) : launcherApps.length ? (
              <div>
                <div className="mb-4 inline-flex items-center border-r-2 border-red-500 pr-2 text-xs font-extrabold text-slate-700 sm:mb-2">
                  تطبيقاتي المثبتة
                </div>
                <div className="grid w-full grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 sm:gap-3">
                  {launcherApps.map((item, i) => {
                    const Icon = resolveModuleIcon(item.icon);
                    const title = item.title ?? item.name ?? t(item.titleKey);
                    const isLaunching = launchingApp?.href === item.href;
                    const canUninstall =
                      isOwner &&
                      item.isRemovable !== false &&
                      item.id &&
                      !String(item.id).startsWith('launcher-') &&
                      !String(item.id).startsWith('fallback-');
                    return (
                      <div
                        key={item.href}
                        className="fade-up group relative min-h-0 sm:min-h-28"
                        style={{ animationDelay: isLaunching ? '0s' : `${0.06 + i * 0.035}s` }}
                      >
                        <Link
                          to={item.href}
                          onClick={(event) => handleLaunchApp(event, { ...item, title, Icon })}
                          className={`relative flex aspect-square min-h-0 flex-col items-center justify-center gap-2 overflow-hidden rounded-[1.65rem] p-3 text-white shadow-lg ring-1 ring-white/10 transition-all duration-150 ease-out hover:shadow-[0_12px_24px_rgba(15,23,42,0.14)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/60 sm:aspect-auto sm:min-h-28 sm:items-stretch sm:justify-between sm:gap-0 sm:rounded-2xl sm:p-4 ${isLaunching ? 'app-launching z-20 ring-2 ring-white/60' : ''}`}
                          style={{ backgroundColor: item.iconColor || DEFAULT_APP_ICON_COLOR }}
                        >
                          <span className={`pointer-events-none absolute inset-0 bg-white/14 transition-opacity duration-200 ${isLaunching ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                          <div className="flex h-12 w-12 items-center justify-center rounded-[1.1rem] bg-white/18 shadow-[inset_0_1px_0_rgba(255,255,255,0.25)] backdrop-blur-sm transition group-hover:bg-white/24 sm:h-11 sm:w-11 sm:rounded-xl">
                            <Icon className="h-6 w-6 stroke-[2.1] sm:h-5 sm:w-5" />
                          </div>
                          <span className="block max-w-full break-words text-center text-xs font-bold leading-tight text-white drop-shadow-sm sm:truncate sm:text-right sm:text-sm">{title}</span>
                        </Link>
                        {canUninstall ? (
                          <div className="absolute left-2 top-2 z-30">
                            <DropdownMenu dir="rtl">
                              <DropdownMenuTrigger asChild>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 rounded-full bg-white/16 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] backdrop-blur-md hover:bg-white/26"
                                  aria-label={`خيارات ${title}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" className="min-w-40 rounded-xl">
                                <DropdownMenuItem
                                  className="justify-start text-red-700 focus:bg-red-50 focus:text-red-700"
                                  onSelect={() => openUninstallDialog({ ...item, title })}
                                >
                                  إزالة التثبيت
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4 inline-flex items-center border-r-2 border-red-500 pr-2 text-xs font-extrabold text-slate-700 sm:mb-2">
                  تطبيقاتي المثبتة
                </div>
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white/60 p-8 text-center text-sm text-slate-400 shadow-[0_20px_55px_rgba(15,23,42,0.08)]">
                  لا توجد تطبيقات مثبتة بعد.
                </div>
              </div>
            )}
          </div>
        </section>

        <AppCatalogSection
          apps={catalogApps}
          status={catalogStatus}
          error={catalogError}
          installingAppId={installingAppId}
          selectedApp={selectedCatalogApp}
          onSelectApp={setSelectedCatalogApp}
          onSelectedAppChange={setSelectedCatalogApp}
          onInstall={handleInstallApp}
        />

        <UninstallAppDialog
          open={uninstallDialog.open}
          onOpenChange={(open) => setUninstallDialog((current) => ({ open, app: open ? current.app : null }))}
          onConfirm={handleConfirmUninstall}
          isSubmitting={isUninstalling}
        />
        <PartnerFormSheet
          open={isCustomerSheetOpen}
          onOpenChange={setIsCustomerSheetOpen}
          initialValues={NEW_CUSTOMER_INITIAL_VALUES}
          onSubmit={handleCreateCustomer}
          isSubmitting={isCustomerSubmitting}
          side="right"
          hideTypeFields
          hideAccountingFields
          hideFooterNote
          hideCancelButton
          accentHeader
          hideDismissButton
          inlineSubmit
        />
        <QuickImageUploadSheet
          open={isImageUploadSheetOpen}
          onOpenChange={setIsImageUploadSheetOpen}
          tenantId={tenant?.id}
          onUploaded={() => setToast({ tone: 'success', message: 'تم رفع الصورة.' })}
        />
        <QuickStockUnitSheet
          open={isStockUnitSheetOpen}
          onOpenChange={setIsStockUnitSheetOpen}
          tenantId={tenant?.id}
          userId={tenantUser?.id || null}
          onSaved={() => setToast({ tone: 'success', message: 'تم تسجيل الوحدة.' })}
        />
        <FloatingNotice notice={toast} onClose={() => setToast(null)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.description')}
        primaryAction={t('dashboard.primaryAction')}
        secondaryAction={t('dashboard.secondaryAction')}
      />
    </div>
  );
}

function QuickCreateTools({ onCreateCustomer, onCreateStockUnit, onOpenImageUpload }) {
  const tools = [
    {
      title: 'تسجيل منتج',
      onClick: onCreateStockUnit,
      Icon: PackagePlus,
      color: '#2563eb',
    },
    {
      title: 'تسجيل عميل',
      onClick: onCreateCustomer,
      Icon: UserPlus,
      color: '#059669',
    },
    {
      title: 'رفع صورة سريع',
      onClick: onOpenImageUpload,
      Icon: ImagePlus,
      color: '#7c3aed',
    },
  ];

  return (
    <div className="mt-5 max-w-sm sm:mt-6">
      <div className="flex flex-wrap gap-2.5">
        {tools.map(({ title, href, onClick, Icon, color }) => {
          const content = (
            <>
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]"
                style={{ backgroundColor: color }}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="whitespace-nowrap text-sm font-black text-slate-950">{title}</span>
            </>
          );
          const className = 'group inline-flex h-12 items-center gap-2.5 rounded-2xl border border-white/80 bg-white/74 px-3.5 text-right shadow-[0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur-md transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_16px_34px_rgba(15,23,42,0.12)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white/70';

          return href ? (
            <Link
              key={title}
              to={href}
              className={className}
            >
              {content}
            </Link>
          ) : (
            <button
              key={title}
              type="button"
              onClick={onClick}
              className={className}
            >
              {content}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UninstallAppDialog({ open, onOpenChange, onConfirm, isSubmitting }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30 backdrop-blur-sm" />
        <Dialog.Content
          dir="rtl"
          className="fixed left-1/2 top-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/80 bg-white p-6 text-right shadow-[0_28px_70px_-32px_rgba(15,23,42,0.55)] outline-none"
        >
          <Dialog.Title className="text-lg font-extrabold text-slate-950">إزالة تثبيت التطبيق؟</Dialog.Title>
          <Dialog.Description className="mt-3 text-sm font-medium leading-6 text-slate-600">
            سيتم إخفاء التطبيق من تطبيقاتك، ولن يتم حذف بياناته.
          </Dialog.Description>
          <div className="mt-6 flex items-center justify-end gap-3">
            <Button type="button" variant="secondary" disabled={isSubmitting} onClick={() => onOpenChange(false)}>
              إلغاء
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              disabled={isSubmitting}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              {isSubmitting ? 'جار الإزالة…' : 'إزالة التثبيت'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AppCatalogSection({ apps, status, error, installingAppId, selectedApp, onSelectApp, onSelectedAppChange, onInstall }) {
  const suggestedApps = apps.filter((app) => app.tenantState !== 'installed');

  if (status !== 'ready' || error || suggestedApps.length === 0) {
    return null;
  }

  return (
    <section className="relative z-10 mt-7 w-full max-w-6xl text-right sm:mt-6" dir="rtl">
      <div className="mb-4 flex items-end justify-between gap-4 sm:mb-3">
        <div>
          <h2 className="inline-flex items-center border-r-2 border-red-500 pr-2 text-xs font-extrabold text-slate-700 sm:rounded-lg sm:border sm:border-r sm:border-slate-200 sm:bg-white/75 sm:px-3 sm:py-1.5 sm:text-sm sm:text-slate-900 sm:shadow-[0_10px_28px_rgba(15,23,42,0.07)] sm:backdrop-blur-sm">
            تطبيقات المنصة المقترحة
          </h2>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {suggestedApps.map((app) => (
          <CatalogAppCard
            key={app.id}
            app={app}
            onOpen={() => onSelectApp(app)}
          />
        ))}
      </div>

      <CatalogAppDetailsSheet
        app={selectedApp}
        open={Boolean(selectedApp)}
        isInstalling={Boolean(selectedApp && installingAppId === selectedApp.id)}
        onOpenChange={(open) => onSelectedAppChange(open ? selectedApp : null)}
        onInstall={onInstall}
      />
    </section>
  );
}

function CatalogAppCard({ app, onOpen }) {
  const Icon = resolveModuleIcon(app.icon);
  const stateMeta = getCatalogStateMeta(app.tenantState);
  const appColor = app.iconColor || DEFAULT_APP_ICON_COLOR;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group flex min-h-32 w-full flex-col items-center justify-center gap-2 rounded-[1.35rem] border px-3 py-4 text-center shadow-[0_14px_34px_rgba(15,23,42,0.07)] transition hover:-translate-y-0.5 hover:shadow-[0_20px_42px_rgba(15,23,42,0.12)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 sm:min-h-20 sm:flex-row sm:justify-between sm:gap-3 sm:rounded-2xl sm:px-4 sm:py-3 sm:text-right ${stateMeta.cardClass}`}
    >
      <div className="flex min-w-0 flex-col items-center gap-2 sm:flex-row sm:gap-3">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.1rem] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)] sm:h-10 sm:w-10 sm:rounded-xl"
          style={{ backgroundColor: appColor }}
        >
          <Icon className="h-6 w-6 stroke-[2.1] sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0">
          <div className="break-words text-xs font-extrabold leading-5 text-slate-900 sm:truncate sm:text-sm">{app.name}</div>
          <div className="mt-0.5 hidden truncate text-xs font-semibold text-slate-500 sm:block">{app.description || app.code}</div>
        </div>
      </div>
      {stateMeta.label ? (
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[0.68rem] font-extrabold sm:text-xs ${stateMeta.badgeClass}`}>
          {stateMeta.label}
        </span>
      ) : null}
    </button>
  );
}

function CatalogAppDetailsSheet({ app, open, isInstalling, onOpenChange, onInstall }) {
  const Icon = resolveModuleIcon(app?.icon);
  const appColor = app?.iconColor || DEFAULT_APP_ICON_COLOR;
  const headerTextColor = getReadableColor(appColor);
  const isLightHeader = headerTextColor === '#0f172a';
  const surfaceColor = isLightHeader ? 'rgba(255,255,255,0.46)' : 'rgba(255,255,255,0.14)';
  const surfaceBorderColor = isLightHeader ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.18)';
  const mutedHeaderTextColor = isLightHeader ? 'rgba(15,23,42,0.68)' : 'rgba(255,255,255,0.72)';
  const installButtonBg = isLightHeader ? '#0f172a' : '#ffffff';
  const installButtonText = isLightHeader ? '#ffffff' : '#0f172a';
  const canInstall = app?.tenantState !== 'installed' && app?.installable !== false;
  const description = app?.description || 'تطبيق مصمم لإضافة إمكانيات تشغيلية جديدة لمساحة العمل الخاصة بك.';
  const stateLabel = app?.tenantState === 'uninstalled' ? 'متاح لإعادة التثبيت' : 'متاح للتثبيت';

  const handleInstall = async () => {
    if (!app || !canInstall) {
      return;
    }

    const installed = await onInstall(app);

    if (installed) {
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full max-w-full overflow-hidden border-r border-slate-200 bg-white p-0 sm:max-w-[560px]" dir="rtl">
        <SheetDismissButton
          className="left-auto right-4 top-4 z-20 border-transparent shadow-none"
          style={{
            backgroundColor: surfaceColor,
            borderColor: surfaceBorderColor,
            color: headerTextColor,
          }}
        />
        {app ? (
          <div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
            <div className="px-5 pb-5 pt-12 sm:px-7 sm:pb-7" style={{ backgroundColor: appColor, color: headerTextColor }}>
              <div className="mb-6 flex items-center justify-between gap-4 sm:mb-8">
                <div
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black"
                  style={{ backgroundColor: surfaceColor, border: `1px solid ${surfaceBorderColor}` }}
                >
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: headerTextColor }} />
                  {stateLabel}
                </div>
              </div>

              <div className="flex items-start gap-4 sm:gap-5">
                <div className="shrink-0">
                  <div
                    className="flex h-20 w-20 items-center justify-center rounded-[1.35rem] sm:h-24 sm:w-24 sm:rounded-[1.45rem]"
                    style={{
                      backgroundColor: surfaceColor,
                      border: `1px solid ${surfaceBorderColor}`,
                      color: headerTextColor,
                    }}
                  >
                    <Icon className="h-10 w-10 stroke-[2.05] sm:h-12 sm:w-12" />
                  </div>
                </div>

                <div className="min-w-0 flex-1 pt-1">
                  <div className="text-xs font-black uppercase tracking-wide" style={{ color: mutedHeaderTextColor }}>
                    {app.code}
                  </div>
                  <SheetTitle className="mt-1 text-2xl font-black leading-tight tracking-tight sm:text-3xl" style={{ color: headerTextColor }}>
                    {app.name}
                  </SheetTitle>
                  <p className="mt-2 text-xs font-bold leading-6 sm:mt-3 sm:text-sm sm:leading-7" style={{ color: mutedHeaderTextColor }}>
                    {description}
                  </p>
                </div>
              </div>

              <div
                className="mt-6 flex items-center justify-between gap-3 rounded-2xl p-3 sm:mt-7 sm:gap-4 sm:p-4"
                style={{ backgroundColor: surfaceColor, border: `1px solid ${surfaceBorderColor}` }}
              >
                <div className="min-w-0">
                  <div className="text-sm font-black" style={{ color: headerTextColor }}>
                    تثبيت التطبيق
                  </div>
                  <div className="mt-1 text-xs font-bold" style={{ color: mutedHeaderTextColor }}>
                    سيظهر ضمن تطبيقاتك المثبتة مباشرة.
                  </div>
                </div>
                <Button
                  type="button"
                  disabled={!canInstall || isInstalling}
                  onClick={handleInstall}
                  className="h-10 shrink-0 rounded-xl px-4 text-sm font-black shadow-none sm:px-5"
                  style={{ backgroundColor: installButtonBg, color: installButtonText }}
                >
                  {isInstalling ? 'جار التثبيت…' : 'تثبيت'}
                </Button>
              </div>
            </div>

            <SheetBody className="border-t border-slate-200 px-5 py-5 sm:px-7 sm:py-6">
              <section>
                <h3 className="text-sm font-black text-slate-950">عن التطبيق</h3>
                <p className="mt-3 text-sm font-semibold leading-7 text-slate-600">
                  يتم تفعيل التطبيق داخل مساحة العمل الحالية ويظهر في قائمة تطبيقاتك بعد اكتمال التثبيت.
                </p>
              </section>

              <section className="mt-7">
                <h3 className="text-sm font-black text-slate-950">ملاحظات التثبيت</h3>
                <p className="mt-3 text-sm font-semibold leading-7 text-slate-600">
                  يتم ربط التطبيق بمساحة العمل الحالية، ويمكن إزالته لاحقًا بدون حذف بياناته التشغيلية.
                </p>
              </section>
            </SheetBody>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function getCatalogStateMeta(state) {
  if (state === 'installed') {
    return {
      label: 'مثبت',
      cardClass: 'border-emerald-100 bg-emerald-50/75',
      iconClass: 'bg-emerald-100 text-emerald-700',
      badgeClass: 'bg-emerald-600 text-white',
    };
  }

  if (state === 'uninstalled') {
    return {
      label: '',
      cardClass: 'border-slate-200 bg-white/70 opacity-80',
      iconClass: 'bg-slate-100 text-slate-500',
      badgeClass: 'bg-slate-200 text-slate-700',
    };
  }

  return {
    label: 'غير مثبت',
    cardClass: 'border-amber-100 bg-amber-50/70',
    iconClass: 'bg-amber-100 text-amber-700',
    badgeClass: 'bg-amber-500 text-white',
  };
}

function FloatingNotice({ notice, onClose }) {
  if (!notice) return null;

  const classes =
    notice.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-red-200 bg-red-50 text-red-800';

  return (
    <div className="fixed bottom-5 left-5 z-50 max-w-sm" dir="rtl">
      <div className={`flex items-start gap-3 rounded-lg border px-4 py-3 text-sm font-semibold shadow-[0_18px_50px_-30px_rgba(15,23,42,0.45)] ${classes}`}>
        <span className="leading-6">{notice.message}</span>
        <button
          type="button"
          onClick={onClose}
          className="mr-2 rounded-md px-2 text-base leading-5 opacity-70 transition hover:bg-white/70 hover:opacity-100"
          aria-label="إغلاق الإشعار"
        >
          ×
        </button>
      </div>
    </div>
  );
}
