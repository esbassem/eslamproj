import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CheckCircle2, MoreVertical, Pencil, PlusCircle, Power, Store, Trash2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/core/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/core/ui/dropdown-menu';
import { Input } from '@/core/ui/input';
import { Sheet, SheetBody, SheetContent, SheetDismissButton, SheetFooter, SheetHeader, SheetTitle } from '@/core/ui/sheet';
import { ShowroomSalesCard } from '@/features/showroom/components/ShowroomSalesCard';
import { ShowroomInvoicesCard } from '@/features/showroom/components/ShowroomInvoicesCard';
import { ShowroomSaleViewSheet } from '@/features/showroom/components/ShowroomSaleViewSheet';
import { useShowroomConfig } from '@/features/showroom/context/ShowroomConfigContext';
import { showroomService } from '@/features/showroom/services/showroom.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const loadPaperworkRequestPromptSheet = () => (
  import('@/features/showroom/components/PaperworkRequestPromptSheet')
    .then((module) => ({ default: module.PaperworkRequestPromptSheet }))
);

const PaperworkRequestPromptSheet = lazy(loadPaperworkRequestPromptSheet);

const EMPTY_CONFIG_DRAFT = {
  id: null,
  name: '',
  code: '',
  branchId: '',
  journalId: '',
  isActive: true,
};

function hasLinePaperworkRequest(line) {
  return Boolean(line?.paperworkRequest || line?.paperwork_request);
}

function getSalePendingPaperworkLines(sale) {
  const lines = Array.isArray(sale?.lines) ? sale.lines : [];
  return lines.filter((line) => !hasLinePaperworkRequest(line));
}


function normalizeConfigCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function ShowroomShell({ children }) {
  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#5b1f2c] px-4 py-5 text-slate-950 [background-image:linear-gradient(135deg,#8e3948_0%,#5b1f2c_46%,#3b1119_100%)] sm:px-6 lg:px-10"
      dir="rtl"
    >
      <div className="pointer-events-none absolute inset-0 opacity-55 [background-image:radial-gradient(rgba(255,255,255,0.28)_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="pointer-events-none absolute -right-24 top-20 h-56 w-[42rem] -rotate-12 rounded-[32px] bg-white/12" />
      <div className="pointer-events-none absolute -left-28 top-36 h-44 w-[34rem] rotate-12 rounded-[32px] bg-[#f4c8cf]/18" />
      <main className="relative z-10 mx-auto w-full max-w-[1280px]">
        {children}
      </main>
    </div>
  );
}

function ShowroomEmptyState({ onCreate }) {
  return (
    <ShowroomShell>
      <div className="flex min-h-[calc(100vh-2.5rem)] items-center justify-center">
        <div className="w-full max-w-xl rounded-[28px] border border-slate-200 bg-white p-8 text-center shadow-[0_24px_60px_-36px_rgba(15,23,42,0.28)]">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
            <Store className="h-7 w-7" />
          </div>
          <h1 className="mt-5 text-2xl font-black text-slate-900">أنشئ أول نقطة معرض</h1>
          <p className="mt-2 text-sm font-bold leading-7 text-slate-500">
            لا توجد نقطة معرض نشطة بعد. أنشئ نقطة مثل إعدادات Odoo POS Configurations ثم ابدأ البيع عليها.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 text-sm font-black text-white shadow-[0_18px_28px_-20px_rgba(15,23,42,0.65)] transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-200"
          >
            <PlusCircle className="h-4 w-4" />
            إنشاء نقطة معرض
          </button>
        </div>
      </div>
    </ShowroomShell>
  );
}

function ShowroomConfigSheet({ open, onOpenChange, configs, config, onSaved }) {
  const { tenant } = useWorkspace();
  const [draft, setDraft] = useState(EMPTY_CONFIG_DRAFT);
  const [branches, setBranches] = useState([]);
  const [journals, setJournals] = useState([]);
  const [isLoadingLookups, setIsLoadingLookups] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setDraft(config ? {
      id: config.id,
      name: config.name ?? '',
      code: config.code ?? '',
      branchId: config.branch_id ?? '',
      journalId: config.journal_id ?? '',
      isActive: config.is_active !== false,
    } : EMPTY_CONFIG_DRAFT);
    setError('');
  }, [config]);

  useEffect(() => {
    if (!open || !tenant?.id) return undefined;

    let mounted = true;
    setIsLoadingLookups(true);

    Promise.all([
      showroomService.listBranches({ tenantId: tenant.id }).catch(() => []),
      showroomService.listPaymentJournals({ tenantId: tenant.id }).catch(() => []),
    ]).then(([nextBranches, nextJournals]) => {
      if (!mounted) return;
      setBranches(nextBranches);
      setJournals(nextJournals);
    }).finally(() => {
      if (mounted) setIsLoadingLookups(false);
    });

    return () => {
      mounted = false;
    };
  }, [open, tenant?.id]);

  useEffect(() => {
    reset();
  }, [open, reset]);

  const saveConfig = async (event) => {
    event.preventDefault();

    if (!tenant?.id || isSaving) return;

    const code = normalizeConfigCode(draft.code);
    const duplicate = configs.some((item) => normalizeConfigCode(item.code) === code && item.id !== draft.id);

    if (!draft.name.trim()) {
      setError('اكتب اسم نقطة المعرض.');
      return;
    }

    if (!code) {
      setError('اكتب كود نقطة المعرض.');
      return;
    }

    if (duplicate) {
      setError('كود نقطة المعرض مستخدم بالفعل داخل نفس الشركة.');
      return;
    }

    setIsSaving(true);
    setError('');

    try {
      const payload = {
        tenantId: tenant.id,
        name: draft.name,
        code,
        branchId: draft.branchId || null,
        journalId: draft.journalId || null,
        isActive: draft.isActive,
      };

      const savedConfig = draft.id
        ? await showroomService.updateConfig(draft.id, payload)
        : await showroomService.createConfig(payload);

      await onSaved?.(savedConfig);
      onOpenChange(false);
    } catch (err) {
      setError(err.message || 'تعذر حفظ نقطة المعرض.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="max-w-md" dir="rtl">
        <SheetDismissButton />
        <SheetHeader className="pr-6 text-right">
          <SheetTitle className="text-[#173653]">{draft.id ? 'تعديل نقطة معرض' : 'إضافة نقطة معرض'}</SheetTitle>
          <p className="text-sm font-bold text-[#668097]">أدخل بيانات النقطة وسيتم تحديث الكروت مباشرة.</p>
        </SheetHeader>
        <form onSubmit={saveConfig} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="space-y-4">
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-black text-red-700">
                {error}
              </div>
            ) : null}

            <div>
              <label className="mb-2 block text-xs font-black text-[#668097]">الاسم</label>
              <Input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                className="border-[#c5ddef] font-bold"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-black text-[#668097]">الكود</label>
              <Input
                value={draft.code}
                onChange={(event) => setDraft((current) => ({ ...current, code: normalizeConfigCode(event.target.value) }))}
                className="border-[#c5ddef] font-bold uppercase"
              />
            </div>

            <div>
              <label className="mb-2 block text-xs font-black text-[#668097]">الفرع</label>
              <select
                value={draft.branchId}
                onChange={(event) => setDraft((current) => ({ ...current, branchId: event.target.value }))}
                disabled={isLoadingLookups}
                className="h-11 w-full rounded-xl border border-[#e6c8cf] bg-white px-3 text-sm font-bold text-[#4d1f28] outline-none focus:ring-4 focus:ring-[#f1d7dc]"
              >
                <option value="">بدون فرع</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-xs font-black text-[#668097]">جورنال التحصيل</label>
              <select
                value={draft.journalId}
                onChange={(event) => setDraft((current) => ({ ...current, journalId: event.target.value }))}
                disabled={isLoadingLookups}
                className="h-11 w-full rounded-xl border border-[#e6c8cf] bg-white px-3 text-sm font-bold text-[#4d1f28] outline-none focus:ring-4 focus:ring-[#f1d7dc]"
              >
                <option value="">بدون جورنال</option>
                {journals.map((journal) => <option key={journal.id} value={journal.id}>{journal.name} ({journal.code})</option>)}
              </select>
            </div>

            <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#c5ddef] bg-[#f7fbff] px-4 py-3 text-sm font-black text-[#173653]">
              <span>نشطة</span>
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}
                className="h-4 w-4"
              />
            </label>
          </SheetBody>
          <SheetFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={isSaving}>
              إلغاء
            </Button>
            <Button type="submit" disabled={isSaving} className="bg-[#9b3645] font-black text-white hover:bg-[#862f3d]">
              {isSaving ? 'جار الحفظ...' : draft.id ? 'حفظ التعديل' : 'إضافة نقطة'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function ShowroomConfigChooser({ configs, onSelect }) {
  return (
    <ShowroomShell>
      <div className="mx-auto flex min-h-[calc(100vh-2.5rem)] max-w-4xl flex-col justify-center py-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-white">
          <div>
            <h1 className="text-2xl font-black sm:text-3xl">اختر نقطة المعرض</h1>
            <p className="mt-1 text-sm font-bold text-white/78">سيتم تشغيل البيع والفواتير على النقطة المختارة فقط.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {configs.map((config) => (
            <button
              key={config.id}
              type="button"
              onClick={() => onSelect(config)}
              className="rounded-[18px] border border-white/55 bg-white/95 p-5 text-right shadow-[0_24px_54px_-36px_rgba(15,52,93,0.9)] transition hover:-translate-y-0.5 hover:bg-white focus:outline-none focus:ring-4 focus:ring-white/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h2
                    className="text-lg font-black leading-6 text-[#173653]"
                    style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                  >
                    {config.name}
                  </h2>
                  <p className="mt-1 text-xs font-black text-[#668097]">{config.code}</p>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-700">نشطة</span>
              </div>
              <p className="mt-5 text-sm font-black text-[#9b3645]">دخول نقطة البيع</p>
            </button>
          ))}
        </div>
      </div>
    </ShowroomShell>
  );
}

function ShowroomConfigsHome({
  configs,
  isLoading,
  error,
  actionError,
  configUsageById,
  currentConfigId,
  onBack,
  onOpenConfig,
  onCreateConfig,
  onEditConfig,
  onToggleConfig,
  onDeleteConfig,
}) {
  const displayError = actionError || error;

  return (
    <ShowroomShell>
      <div className="mx-auto min-h-[calc(100vh-2.5rem)] max-w-5xl py-8">
        <header className="mb-7 rounded-[24px] border border-white/35 bg-white/10 px-4 py-4 text-white backdrop-blur-sm sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3 text-right">
              <button
                type="button"
                aria-label="رجوع"
                onClick={onBack}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/45 bg-white/12 text-white shadow-[0_16px_34px_-24px_rgba(21,66,116,0.9)] backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
              >
                <ArrowRight className="h-5 w-5" />
              </button>
              <div>
                <p className="text-xs font-black uppercase text-white/75">Showroom Point</p>
                <h1 className="mt-1 text-2xl font-black sm:text-3xl">نقاط المعرض</h1>
                <p className="mt-1 text-sm font-bold text-white/80">واجهة أسهل لإدارة النقاط والدخول السريع للبيع.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onCreateConfig}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/45 bg-white/12 px-4 text-sm font-black text-white shadow-[0_16px_34px_-24px_rgba(21,66,116,0.9)] backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            >
              <PlusCircle className="h-4 w-4" />
              إضافة نقطة
            </button>
          </div>
        </header>

        {displayError ? (
          <div className="mb-4 rounded-xl border border-white/35 bg-white/90 px-4 py-3 text-sm font-black text-red-600">
            {displayError}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-[18px] border border-white/45 bg-white/90 px-5 py-10 text-center text-sm font-black text-[#668097]">
            جاري تحميل نقاط المعرض...
          </div>
        ) : configs.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {configs.map((config) => {
              const isActive = config.is_active !== false;
              const isCurrent = currentConfigId === config.id;
              const hasActivity = Boolean(configUsageById?.[config.id]);
              const canDelete = !hasActivity;

              return (
                <div
                  key={config.id}
                  role="button"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => isActive && onOpenConfig(config)}
                  onKeyDown={(event) => {
                    if (!isActive) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onOpenConfig(config);
                    }
                  }}
                  className={`min-h-[170px] rounded-[22px] border border-[#d8e8f5] bg-[linear-gradient(180deg,#ffffff_0%,#f8fcff_100%)] p-5 text-right shadow-[0_26px_50px_-40px_rgba(20,82,138,0.58)] transition hover:-translate-y-0.5 hover:border-[#b6d7ee] ${isActive ? '' : 'opacity-70 hover:translate-y-0'}`}
                >
                  <div className="flex h-full flex-col justify-between gap-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2
                          className="text-lg font-black tracking-tight leading-6 text-[#16314d]"
                          style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                        >
                          {config.name || 'نقطة معرض'}
                        </h2>
                        <p className="mt-1 text-xs font-black text-[#5c7992]">{config.code || 'بدون كود'}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {isActive ? 'نشطة' : 'معطلة'}
                        </span>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              onClick={(event) => event.stopPropagation()}
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#ead5d9] bg-white text-[#81626a] transition hover:bg-[#fbf1f3] hover:text-[#4d1f28] focus:outline-none focus:ring-4 focus:ring-[#f1d7dc]"
                              aria-label="إعدادات نقطة المعرض"
                              title="إعدادات نقطة المعرض"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-44 rounded-xl" onClick={(event) => event.stopPropagation()}>
                            <DropdownMenuItem onSelect={() => onEditConfig(config)} className="gap-2 font-bold">
                              <span>تعديل</span>
                              <Pencil className="h-4 w-4 text-[#668097]" />
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => onToggleConfig(config)} className="gap-2 font-bold">
                              <span>{isActive ? 'تعطيل النقطة' : 'تفعيل النقطة'}</span>
                              {isActive ? (
                                <Power className="h-4 w-4 text-[#668097]" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                              )}
                            </DropdownMenuItem>
                            {canDelete ? (
                              <DropdownMenuItem onSelect={() => onDeleteConfig(config)} className="gap-2 font-bold text-red-600 focus:bg-red-50 focus:text-red-700">
                                <span>حذف</span>
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem disabled className="gap-2 font-bold text-slate-400">
                                <span>الحذف متاح قبل أول عملية فقط</span>
                                <Trash2 className="h-4 w-4" />
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-black text-[#2a78b8] transition hover:text-[#173653] disabled:cursor-not-allowed disabled:text-[#8aa0b3]">
                        {isActive ? 'دخول نقطة البيع' : 'فعّل النقطة من الإعدادات'}
                      </span>
                      {isCurrent ? (
                        <span className="rounded-full bg-[#fbf1f3] px-2.5 py-1 text-[11px] font-black text-[#9b3645]">محددة</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-[22px] border border-white/55 bg-white/95 p-8 text-center shadow-[0_32px_70px_-38px_rgba(15,52,93,0.95)]">
            <Store className="mx-auto h-12 w-12 text-[#9b3645]" />
            <h2 className="mt-4 text-xl font-black text-[#173653]">لا توجد نقاط معرض بعد</h2>
            <p className="mt-2 text-sm font-bold text-[#668097]">ابدأ بإضافة أول نقطة معرض.</p>
            <button
              type="button"
              onClick={onCreateConfig}
              className="mt-6 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#9b3645] px-5 text-sm font-black text-white transition hover:bg-[#862f3d]"
            >
              <PlusCircle className="h-4 w-4" />
              إضافة نقطة
            </button>
          </div>
        )}
      </div>
    </ShowroomShell>
  );
}


export function ShowroomSellPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tenant } = useWorkspace();
  const {
    configs,
    activeConfigs,
    currentShowroomConfig,
    currentShowroomConfigId,
    isLoadingConfigs,
    configsError,
    selectConfig,
    reloadConfigs,
  } = useShowroomConfig();
  const [sales, setSales] = useState([]);
  const [isSalesLoading, setIsSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState('');
  const [selectedSale, setSelectedSale] = useState(null);
  const [paperworkPromptSale, setPaperworkPromptSale] = useState(null);
  const [dismissedPaperworkPromptSaleId, setDismissedPaperworkPromptSaleId] = useState(null);
  const [isCreateConfigOpen, setIsCreateConfigOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  const [configUsageById, setConfigUsageById] = useState({});
  const [configActionError, setConfigActionError] = useState('');
  const isHomeRoute = location.pathname.replace(/\/+$/, '') === '/app/showroom_point';

  useEffect(() => {
    if (!isHomeRoute || isLoadingConfigs || activeConfigs.length !== 1) {
      return;
    }

    const onlyConfig = activeConfigs[0];
    if (!onlyConfig) {
      return;
    }

    selectConfig(onlyConfig);
    navigate('/app/showroom_point/new', { replace: true });
  }, [activeConfigs, isHomeRoute, isLoadingConfigs, navigate, selectConfig]);

  useEffect(() => {
    if (!tenant?.id || !configs.length) {
      setConfigUsageById({});
      return;
    }

    let mounted = true;
    showroomService.listConfigActivity({
      tenantId: tenant.id,
      configIds: configs.map((config) => config.id),
    }).then((activityMap) => {
      if (!mounted) return;
      setConfigUsageById(activityMap || {});
    }).catch(() => {
      if (!mounted) return;
      setConfigUsageById({});
    });

    return () => {
      mounted = false;
    };
  }, [configs, tenant?.id]);

  const loadSales = useCallback(async () => {
    if (!tenant?.id || !currentShowroomConfigId) {
      setSales([]);
      setIsSalesLoading(false);
      return;
    }

    setIsSalesLoading(true);
    setSalesError('');

    try {
      const nextSales = await showroomService.getSales({
        tenantId: tenant.id,
        showroomConfigId: currentShowroomConfigId,
      });
      setSales(nextSales);
    } catch (error) {
      setSales([]);
      setSalesError(error.message || 'تعذر تحميل عمليات البيع.');
    } finally {
      setIsSalesLoading(false);
    }
  }, [currentShowroomConfigId, tenant?.id]);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let timeoutId = null;
    let idleId = null;
    const preload = () => {
      loadPaperworkRequestPromptSheet().catch(() => {});
    };

    if ('requestIdleCallback' in window) {
      idleId = window.requestIdleCallback(preload, { timeout: 1600 });
    } else {
      timeoutId = window.setTimeout(preload, 700);
    }

    return () => {
      if (idleId) window.cancelIdleCallback?.(idleId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (isSalesLoading || paperworkPromptSale) {
      return;
    }

    const latestSale = sales[0] || null;
    if (
      latestSale
      && latestSale.id !== dismissedPaperworkPromptSaleId
      && getSalePendingPaperworkLines(latestSale).length
    ) {
      setPaperworkPromptSale(latestSale);
    }
  }, [dismissedPaperworkPromptSaleId, isSalesLoading, paperworkPromptSale, sales]);

  const salesStats = useMemo(() => {
    const total = sales.reduce((sum, sale) => sum + Number(sale.total_amount || sale.totalAmount || 0), 0);
    return {
      count: sales.length,
      total,
    };
  }, [sales]);

  const handleSaleCreated = async (sale) => {
    if (!tenant?.id) {
      return { ok: false, error: 'لا توجد شركة نشطة.' };
    }

    if (!currentShowroomConfigId) {
      return { ok: false, error: 'اختر نقطة معرض أولاً.' };
    }

    try {
      const savedSale = await showroomService.createSale({
        tenantId: tenant.id,
        customerId: sale.customer?.id || null,
        items: sale.items,
        totalAmount: sale.totalAmount,
        paidAmount: sale.paidAmount,
        paymentMethodId: sale.paymentMethodId,
        contractNote: sale.contractNote,
        showroomConfigId: currentShowroomConfigId,
      });

      setSales((current) => [savedSale, ...current.filter((item) => item.id !== savedSale.id)]);
      setDismissedPaperworkPromptSaleId(null);
      if (getSalePendingPaperworkLines(savedSale).length) {
        setPaperworkPromptSale(savedSale);
      }
      return { ok: true, sale: savedSale };
    } catch (error) {
      return { ok: false, error: error.message || 'تعذر حفظ عملية البيع.' };
    }
  };

  const handleSaleDeleted = (saleId) => {
    setSales((current) => current.filter((item) => item.id !== saleId));
    setSelectedSale(null);
  };

  const handlePaperworkPromptSaved = useCallback(({ saleId, saleLineId, paperworkRequest }) => {
    if (!saleId || !saleLineId || !paperworkRequest?.id) return;

    const normalizeLine = (line) => (
      line?.id === saleLineId
        ? {
            ...line,
            paperworkRequest,
            paperwork_request: paperworkRequest,
          }
        : line
    );

    const normalizeSale = (sale) => (
      sale?.id === saleId
        ? {
            ...sale,
            lines: Array.isArray(sale.lines) ? sale.lines.map(normalizeLine) : sale.lines,
          }
        : sale
    );

    setSales((current) => current.map(normalizeSale));
    setSelectedSale((current) => normalizeSale(current));
    setPaperworkPromptSale((current) => {
      const nextSale = normalizeSale(current);
      return nextSale && getSalePendingPaperworkLines(nextSale).length ? nextSale : null;
    });
  }, []);

  if (isHomeRoute) {
    return (
      <>
        <ShowroomConfigsHome
          configs={configs}
          isLoading={isLoadingConfigs}
          error={configsError}
          actionError={configActionError}
          configUsageById={configUsageById}
          currentConfigId={currentShowroomConfigId}
          onBack={() => navigate(-1)}
          onCreateConfig={() => {
            setConfigActionError('');
            setIsCreateConfigOpen(true);
          }}
          onEditConfig={(config) => {
            setConfigActionError('');
            setEditingConfig(config);
            setIsCreateConfigOpen(true);
          }}
          onToggleConfig={async (config) => {
            if (!tenant?.id) return;

            try {
              const nextActive = config.is_active === false;
              await showroomService.toggleConfigActive({
                tenantId: tenant.id,
                id: config.id,
                isActive: nextActive,
              });

              if (!nextActive && currentShowroomConfigId === config.id) {
                selectConfig(null);
              }

              setConfigActionError('');
              await reloadConfigs();
            } catch (error) {
              setConfigActionError(error.message || 'تعذر تحديث حالة نقطة المعرض.');
            }
          }}
          onDeleteConfig={async (config) => {
            if (!tenant?.id) return;

            if (configUsageById[config.id]) {
              setConfigActionError('لا يمكن حذف النقطة بعد تسجيل عمليات عليها. يمكنك تعطيلها فقط.');
              return;
            }

            const isConfirmed = window.confirm(`هل أنت متأكد من حذف نقطة المعرض "${config.name || 'بدون اسم'}" نهائياً؟`);
            if (!isConfirmed) {
              return;
            }

            try {
              await showroomService.deleteConfig({
                tenantId: tenant.id,
                id: config.id,
              });

              if (currentShowroomConfigId === config.id) {
                selectConfig(null);
              }

              setConfigActionError('');
              await reloadConfigs();
            } catch (error) {
              setConfigActionError(error.message || 'تعذر حذف نقطة المعرض.');
            }
          }}
          onOpenConfig={(config) => {
            setConfigActionError('');
            selectConfig(config);
            navigate('/app/showroom_point/new');
          }}
        />
        <ShowroomConfigSheet
          open={isCreateConfigOpen}
          onOpenChange={(open) => {
            setIsCreateConfigOpen(open);
            if (!open) setEditingConfig(null);
          }}
          configs={configs}
          config={editingConfig}
          onSaved={async (savedConfig) => {
            await reloadConfigs();
            if (savedConfig.is_active !== false) {
              selectConfig(savedConfig);
            }
          }}
        />
      </>
    );
  }

  if (isLoadingConfigs) {
    return (
      <ShowroomShell>
        <div className="flex min-h-[calc(100vh-2.5rem)] items-center justify-center text-sm font-black text-white">
          جاري تحميل نقاط المعرض...
        </div>
      </ShowroomShell>
    );
  }

  if (!currentShowroomConfigId) {
    if (!activeConfigs.length) {
      return (
        <>
          <ShowroomEmptyState onCreate={() => setIsCreateConfigOpen(true)} />
          <ShowroomConfigSheet
            open={isCreateConfigOpen}
            onOpenChange={(open) => {
              setIsCreateConfigOpen(open);
              if (!open) setEditingConfig(null);
            }}
            configs={configs}
            config={editingConfig}
            onSaved={async (createdConfig) => {
              await reloadConfigs();
              selectConfig(createdConfig);
            }}
          />
        </>
      );
    }

    return (
      <ShowroomConfigChooser
        configs={activeConfigs}
        onSelect={selectConfig}
      />
    );
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#5b1f2c] px-4 py-5 text-slate-950 [background-image:linear-gradient(135deg,#8e3948_0%,#5b1f2c_46%,#3b1119_100%)] sm:px-6 lg:px-10"
      dir="rtl"
    >
      <style>{`
        @keyframes showroomBackdropIn {
          from { opacity: 0; transform: scale(1.025); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes showroomHeaderIn {
          from { opacity: 0; transform: translateY(-14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes showroomPanelIn {
          from { opacity: 0; transform: translateY(26px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .showroom-backdrop-in { animation: showroomBackdropIn 0.32s ease-out both; }
        .showroom-header-in { animation: showroomHeaderIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .showroom-panel-in { animation: showroomPanelIn 0.34s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>
      <div className="pointer-events-none absolute inset-0 opacity-55 [background-image:radial-gradient(rgba(255,255,255,0.28)_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="showroom-backdrop-in pointer-events-none absolute -right-24 top-20 h-56 w-[42rem] -rotate-12 rounded-[32px] bg-white/12" />
      <div className="showroom-backdrop-in pointer-events-none absolute -left-28 top-36 h-44 w-[34rem] rotate-12 rounded-[32px] bg-[#f4c8cf]/18" style={{ animationDelay: '0.03s' }} />
      <div className="showroom-backdrop-in pointer-events-none absolute bottom-[-4rem] right-12 h-36 w-[34rem] -rotate-6 rounded-[28px] bg-white/10" style={{ animationDelay: '0.06s' }} />
      <div className="showroom-backdrop-in pointer-events-none absolute left-10 top-12 hidden h-28 w-44 rounded-[22px] border border-white/30 bg-white/10 backdrop-blur-sm md:block" style={{ animationDelay: '0.08s' }} />
      <div className="pointer-events-none absolute left-16 top-20 hidden h-2.5 w-12 rounded-full bg-[#f0a6b0] md:block" />
      <div className="pointer-events-none absolute left-16 top-32 hidden grid-cols-2 gap-3 md:grid">
        <span className="h-12 w-16 rounded-xl border border-white/24 bg-white/10" />
        <span className="h-12 w-16 rounded-xl border border-white/20 bg-white/8" />
        <span className="h-12 w-16 rounded-xl border border-white/20 bg-white/8" />
        <span className="h-12 w-16 rounded-xl border border-white/20 bg-white/8" />
      </div>
      <div className="pointer-events-none absolute bottom-12 right-10 hidden h-px w-80 bg-white/55 md:block" />
      <div className="pointer-events-none absolute bottom-16 right-16 hidden h-px w-48 bg-[#f4d35e]/70 md:block" />
      <main className="relative z-10 mx-auto w-full max-w-[1280px]">
        <header className="showroom-header-in mb-3 flex flex-wrap items-center justify-between gap-3 px-1 text-white sm:px-0">
          <div className="flex min-w-0 items-center gap-3 text-right">
            <button
              type="button"
              aria-label="رجوع"
              onClick={() => navigate(-1)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/25 bg-white/10 text-white backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            >
              <ArrowRight className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black leading-tight text-white sm:text-2xl">نقطة المعرض</h1>
                <span className="rounded-full bg-white/12 px-2 py-0.5 text-[10px] font-black text-white/80 backdrop-blur">Live Workspace</span>
              </div>
              <p className="hidden text-[11px] font-semibold text-white/70 sm:block">واجهة بيع احترافية بترتيب واضح ومظهر مؤسسي هادئ</p>
            </div>
          </div>
          <div className="flex w-full items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-3 py-1.5 backdrop-blur sm:w-auto sm:min-w-[17rem]">
            <Store className="h-4 w-4 shrink-0 text-white/80" />
            <div className="min-w-0 flex-1">
              <label htmlFor="showroom-config" className="sr-only">نقطة المعرض</label>
              <select
                id="showroom-config"
                value={currentShowroomConfigId}
                onChange={(event) => {
                  const nextConfig = activeConfigs.find((config) => config.id === event.target.value) ?? null;
                  selectConfig(nextConfig);
                }}
                disabled={isLoadingConfigs || activeConfigs.length < 2}
                className="h-9 w-full rounded-xl border border-white/20 bg-white/95 px-3 text-xs font-black text-slate-800 outline-none transition focus:ring-4 focus:ring-white/25 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {activeConfigs.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.name || config.code || 'نقطة معرض'}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              aria-label="إضافة نقطة جديدة"
              title="إضافة نقطة جديدة"
              onClick={() => {
                setEditingConfig(null);
                setIsCreateConfigOpen(true);
              }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/20 bg-white/95 text-slate-700 transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-white/25"
            >
              <PlusCircle className="h-4 w-4" />
            </button>
          </div>
        </header>

        {configsError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-black text-red-600 shadow-sm">
            {configsError}
          </div>
        ) : null}

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px] xl:gap-7">
          <div className="showroom-panel-in overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_60px_-34px_rgba(15,23,42,0.18)] xl:col-start-1">
            <ShowroomSalesCard onSaleCreated={handleSaleCreated} showroomConfig={currentShowroomConfig} />
          </div>
          <div className="showroom-panel-in overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_28px_60px_-34px_rgba(15,23,42,0.18)] xl:col-start-2" style={{ animationDelay: '0.04s' }}>
            <ShowroomInvoicesCard
              invoices={sales}
              stats={salesStats}
              isLoading={isSalesLoading}
              error={salesError}
              onInvoiceSelect={setSelectedSale}
              onPaperworkRequestSelect={(saleToUpdate) => {
                if (saleToUpdate && getSalePendingPaperworkLines(saleToUpdate).length) {
                  setDismissedPaperworkPromptSaleId(null);
                  setPaperworkPromptSale(saleToUpdate);
                }
              }}
            />
          </div>
        </div>
      </main>
      <ShowroomSaleViewSheet
        sale={selectedSale}
        isOpen={Boolean(selectedSale)}
        onClose={() => setSelectedSale(null)}
        onDeleted={handleSaleDeleted}
        onPaperworkRequestOpen={(saleToUpdate) => {
          if (saleToUpdate && getSalePendingPaperworkLines(saleToUpdate).length) {
            setDismissedPaperworkPromptSaleId(null);
            setSelectedSale(null);
            setPaperworkPromptSale(saleToUpdate);
          }
        }}
      />
      {paperworkPromptSale ? (
        <Suspense fallback={null}>
          <PaperworkRequestPromptSheet
            open={Boolean(paperworkPromptSale)}
            sale={paperworkPromptSale}
            onOpenChange={(open) => {
              if (open) return;
              setPaperworkPromptSale((current) => (
                current && getSalePendingPaperworkLines(current).length ? current : null
              ));
            }}
            onSaved={handlePaperworkPromptSaved}
            onIgnored={(ignoredSale) => {
              setDismissedPaperworkPromptSaleId(ignoredSale?.id || null);
              setPaperworkPromptSale(null);
            }}
          />
        </Suspense>
      ) : null}
      <ShowroomConfigSheet
        open={isCreateConfigOpen}
        onOpenChange={(open) => {
          setIsCreateConfigOpen(open);
          if (!open) setEditingConfig(null);
        }}
        configs={configs}
        config={editingConfig}
        onSaved={async (savedConfig) => {
          await reloadConfigs();
          if (savedConfig.is_active !== false) {
            selectConfig(savedConfig);
          }
        }}
      />
    </div>
  );
}
