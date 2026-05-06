import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Coins, Eye, History, LogIn, LockKeyhole, ShoppingCart, Store } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { ROUTES } from '@/core/config/routes.config';
import { useI18n } from '@/core/i18n/useI18n';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { ResourcePageShell } from '@/core/ui/resource-page-shell';
import { posService } from '@/features/pos/api/pos.api';
import { CloseSessionSheet } from '@/features/pos/components/CloseSessionSheet';
import { CreatePosLocationSheet } from '@/features/pos/components/CreatePosLocationSheet';
import { OpenSessionSheet } from '@/features/pos/components/OpenSessionSheet';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

const EMPTY_OPEN_SESSIONS = {};

function formatMoney(value) {
  return `${Number(value ?? 0).toLocaleString()} EGP`;
}

function formatDate(value, fallback) {
  return value ? new Date(value).toLocaleString() : fallback;
}

function getTranslatedError(error, t, fallbackKey) {
  if (error?.message?.startsWith('pos.')) {
    return t(error.message);
  }

  return error?.message || t(fallbackKey);
}

export function PosOverview() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { tenant, tenantUser } = useWorkspace();
  const [configs, setConfigs] = useState([]);
  const [openSessionsByConfigId, setOpenSessionsByConfigId] = useState(EMPTY_OPEN_SESSIONS);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isCreateSheetOpen, setIsCreateSheetOpen] = useState(false);
  const [isOpenSessionSheetOpen, setIsOpenSessionSheetOpen] = useState(false);
  const [isCloseSessionSheetOpen, setIsCloseSessionSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState(null);
  const [selectedSession, setSelectedSession] = useState(null);
  const [activeView, setActiveView] = useState('list');
  const [sessions, setSessions] = useState([]);
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState('');

  const selectedOpenSession = selectedConfig ? openSessionsByConfigId[selectedConfig.id] ?? null : null;

  const configsWithSessions = useMemo(
    () =>
      configs.map((config) => ({
        ...config,
        openSession: openSessionsByConfigId[config.id] ?? null,
      })),
    [configs, openSessionsByConfigId],
  );

  const loadPosState = useCallback(async () => {
    if (!tenant?.id) {
      setConfigs([]);
      setOpenSessionsByConfigId(EMPTY_OPEN_SESSIONS);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPageError('');

    try {
      const [nextConfigs, openSessions] = await Promise.all([
        posService.listConfigs(tenant.id),
        posService.listOpenSessions({ tenantId: tenant.id }),
      ]);
      const nextOpenSessionsByConfigId = {};

      openSessions.forEach((session) => {
        if (!nextOpenSessionsByConfigId[session.posConfigId]) {
          nextOpenSessionsByConfigId[session.posConfigId] = session;
        }
      });

      setConfigs(nextConfigs);
      setOpenSessionsByConfigId(nextOpenSessionsByConfigId);
    } catch (error) {
      setPageError(error.message || t('pos.messages.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t, tenant?.id]);

  const loadSessions = useCallback(async () => {
    if (!tenant?.id || !selectedConfig?.id) {
      setSessions([]);
      return;
    }

    setIsSessionsLoading(true);
    setSessionsError('');

    try {
      const nextSessions = await posService.listSessions({ tenantId: tenant.id, posConfigId: selectedConfig.id });
      setSessions(nextSessions);
    } catch (error) {
      setSessionsError(error.message || t('pos.messages.sessionsLoadError'));
    } finally {
      setIsSessionsLoading(false);
    }
  }, [selectedConfig?.id, t, tenant?.id]);

  useEffect(() => {
    loadPosState();
  }, [loadPosState]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const resetToList = () => {
    setSelectedConfig(null);
    setSelectedSession(null);
    setActiveView('list');
    setSessionsError('');
  };

  const handleCreateConfig = async (payload) => {
    if (!tenant?.id) {
      return { ok: false, error: t('pos.messages.loadError') };
    }

    try {
      setIsSubmitting(true);
      setPageError('');
      setSuccessMessage('');
      const createdConfig = await posService.createConfig({
        tenantId: tenant.id,
        ...payload,
      });

      setConfigs((current) => [createdConfig, ...current]);
      setSuccessMessage(t('pos.messages.createSuccess'));
      setIsCreateSheetOpen(false);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || t('pos.messages.createError') };
    } finally {
      setIsSubmitting(false);
    }
  };

  const startOpeningSession = (config) => {
    setSelectedConfig(config);
    setSelectedSession(null);
    setIsOpenSessionSheetOpen(true);
  };

  const handleOpenSession = async (payload) => {
    if (!tenant?.id || !tenantUser?.id || !selectedConfig?.id) {
      return { ok: false, error: t('pos.messages.userMissing') };
    }

    try {
      setIsSubmitting(true);
      setPageError('');
      setSuccessMessage('');
      const openedSession = await posService.openSession({
        tenantId: tenant.id,
        posConfigId: selectedConfig.id,
        userId: tenantUser.id,
        ...payload,
      });

      setOpenSessionsByConfigId((current) => ({ ...current, [selectedConfig.id]: openedSession }));
      setSelectedSession(openedSession);
      setIsOpenSessionSheetOpen(false);
      setSuccessMessage(t('pos.messages.openSuccess'));
      await loadSessions();
      navigate(`${ROUTES.adminPos}/${selectedConfig.id}/session/${openedSession.id}/sell`);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: getTranslatedError(error, t, 'pos.messages.openError') };
    } finally {
      setIsSubmitting(false);
    }
  };

  const showSessionDetails = (config, session) => {
    setSelectedConfig(config);
    setSelectedSession(session);
    setActiveView('details');
  };

  const showSalePlaceholder = (config, session) => {
    navigate(`${ROUTES.adminPos}/${config.id}/session/${session.id}/sell`);
  };

  const showSessionsHistory = (config) => {
    setSelectedConfig(config);
    setSelectedSession(null);
    setActiveView('history');
  };

  const startClosingSession = (config, session) => {
    setSelectedConfig(config);
    setSelectedSession(session);
    setIsCloseSessionSheetOpen(true);
  };

  const handleCloseSession = async ({ closingBalance }) => {
    if (!tenant?.id || !selectedSession?.id) {
      return { ok: false, error: t('pos.messages.closeError') };
    }

    try {
      setIsSubmitting(true);
      setPageError('');
      setSuccessMessage('');
      const closedSession = await posService.closeSession({
        tenantId: tenant.id,
        sessionId: selectedSession.id,
        closingBalance,
      });

      setOpenSessionsByConfigId((current) => {
        const next = { ...current };
        delete next[closedSession.posConfigId];
        return next;
      });
      setSelectedSession(closedSession);
      setActiveView('details');
      setIsCloseSessionSheetOpen(false);
      setSuccessMessage(t('pos.messages.closeSuccess'));
      await loadSessions();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: getTranslatedError(error, t, 'pos.messages.closeError') };
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderHeader = () => {
    if (activeView === 'list' || !selectedConfig) {
      return <span className="text-slate-950">{t('pos.locations.title')}</span>;
    }

    return (
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={resetToList}
          className="inline-flex items-center text-slate-500 transition hover:text-[#0f62fe] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
        >
          {t('pos.locations.title')}
        </button>
        <span className="text-slate-300">/</span>
        <span className="min-w-0 truncate text-slate-950">{selectedConfig.name}</span>
      </div>
    );
  };

  const renderList = () => {
    if (isLoading) {
      return <LoadingSpinner title="جاري تحميل نقاط البيع" />;
    }

    if (!configsWithSessions.length) {
      return (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-6 text-center">
          <div className="rounded-xl bg-blue-50 p-4 text-[#0f62fe]">
            <ShoppingCart className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-xl font-extrabold text-slate-950">{t('resources.pos.emptyTitle')}</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t('resources.pos.emptyDescription')}</p>
        </div>
      );
    }

    return (
      <div className="grid gap-3">
        {configsWithSessions.map((config) => {
          const isOpen = Boolean(config.openSession);

          return (
            <div key={config.id} className="rounded-xl border border-slate-200 bg-white px-5 py-4 transition hover:border-slate-300 hover:bg-slate-50">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center text-slate-700">
                    <Store className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-slate-950">{config.name}</h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {config.code ? <span className="text-sm font-medium text-slate-500">{config.code}</span> : null}
                      <Badge variant={isOpen ? 'success' : 'default'}>{isOpen ? t('pos.status.open') : t('pos.status.closed')}</Badge>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {isOpen ? (
                    <>
                      <Button size="sm" onClick={() => showSalePlaceholder(config, config.openSession)}>
                        <LogIn className="h-4 w-4" />
                        {t('pos.actions.enterSale')}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => showSessionDetails(config, config.openSession)}>
                        <Eye className="h-4 w-4" />
                        {t('pos.actions.viewSession')}
                      </Button>
                      <Button size="sm" variant="soft" onClick={() => startClosingSession(config, config.openSession)}>
                        <LockKeyhole className="h-4 w-4" />
                        {t('pos.actions.closeSession')}
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" onClick={() => startOpeningSession(config)}>
                      <Clock3 className="h-4 w-4" />
                      {t('pos.actions.openSession')}
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => showSessionsHistory(config)}>
                    <History className="h-4 w-4" />
                    {t('pos.actions.sessionsHistory')}
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderSessionDetails = () => {
    if (!selectedSession) {
      return null;
    }

    const difference =
      selectedSession.closingBalance === null || selectedSession.closingBalance === undefined
        ? null
        : Number(selectedSession.closingBalance) - Number(selectedSession.openingBalance ?? 0);

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xl font-extrabold text-slate-950">{t('pos.details.title')}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{selectedConfig?.name}</p>
          </div>
          {selectedSession.status === 'open' ? (
            <Button variant="soft" onClick={() => startClosingSession(selectedConfig, selectedSession)}>
              <LockKeyhole className="h-4 w-4" />
              {t('pos.actions.closeSession')}
            </Button>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <DetailCard label={t('pos.details.openingBalance')} value={formatMoney(selectedSession.openingBalance)} icon={Coins} />
          <DetailCard label={t('pos.details.closingBalance')} value={selectedSession.closingBalance === null ? '-' : formatMoney(selectedSession.closingBalance)} icon={Coins} />
          <DetailCard label={t('pos.details.status')} value={t(`pos.sessions.status.${selectedSession.status}`)} icon={Clock3} />
          <DetailCard label={t('pos.details.openedAt')} value={formatDate(selectedSession.openedAt, t('pos.sessions.noDate'))} icon={Clock3} />
          <DetailCard label={t('pos.details.closedAt')} value={formatDate(selectedSession.closedAt, '-')} icon={Clock3} />
          <DetailCard label={t('pos.details.difference')} value={difference === null ? '-' : formatMoney(difference)} icon={Coins} />
        </div>
      </div>
    );
  };

  const renderHistory = () => (
    <div className="space-y-4">
      <div>
        <h3 className="text-xl font-extrabold text-slate-950">{t('pos.history.title')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{selectedConfig?.name}</p>
      </div>

      {sessionsError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{sessionsError}</div>
      ) : isSessionsLoading ? (
        <LoadingSpinner title="جاري تحميل سجل الجلسات" />
      ) : sessions.length ? (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="hidden grid-cols-5 gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700 md:grid">
            <span>{t('pos.history.date')}</span>
            <span>{t('pos.history.user')}</span>
            <span>{t('pos.history.status')}</span>
            <span>{t('pos.history.openingBalance')}</span>
            <span>{t('pos.history.closingBalance')}</span>
          </div>
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              onClick={() => showSessionDetails(selectedConfig, session)}
              className="grid w-full grid-cols-1 gap-2 border-b border-slate-100 px-4 py-3 text-right text-sm transition last:border-b-0 hover:bg-slate-50 md:grid-cols-5 md:gap-3"
            >
              <span className="font-medium text-slate-950">{formatDate(session.openedAt, t('pos.sessions.noDate'))}</span>
              <span className="text-slate-600">{session.userName || session.userEmail || '-'}</span>
              <span className="text-slate-600">{t(`pos.sessions.status.${session.status}`)}</span>
              <span className="text-slate-600">{formatMoney(session.openingBalance)}</span>
              <span className="text-slate-600">{session.closingBalance === null ? '-' : formatMoney(session.closingBalance)}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-6 text-center">
          <div className="rounded-xl bg-blue-50 p-4 text-[#0f62fe]">
            <Clock3 className="h-7 w-7" />
          </div>
          <h3 className="mt-4 text-xl font-extrabold text-slate-950">{t('pos.sessions.emptyTitle')}</h3>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t('pos.sessions.emptyDescription')}</p>
        </div>
      )}
    </div>
  );

  const renderSalePlaceholder = () => (
    <div className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50/70 px-6 text-center">
      <div className="rounded-xl bg-blue-50 p-4 text-[#0f62fe]">
        <ShoppingCart className="h-8 w-8" />
      </div>
      <h3 className="mt-4 text-2xl font-extrabold text-slate-950">{t('pos.sale.title')}</h3>
      <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{t('pos.sale.description')}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {selectedOpenSession ? (
          <Button variant="secondary" onClick={() => showSessionDetails(selectedConfig, selectedOpenSession)}>
            <Eye className="h-4 w-4" />
            {t('pos.actions.viewSession')}
          </Button>
        ) : null}
        <Button variant="soft" onClick={resetToList}>
          {t('pos.actions.backToList')}
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <ResourcePageShell
        title={t('resources.pos.title')}
        description={t('resources.pos.description')}
        primaryAction={t('resources.pos.primaryAction')}
        icon={ShoppingCart}
        showSearch={false}
        showEmptyState={false}
        onPrimaryAction={() => setIsCreateSheetOpen(true)}
      >
        <div className="space-y-5" dir="rtl">
          <div className="-mx-5 -mt-5 rounded-t-[1.5rem] border-b border-slate-300/90 bg-slate-200/80 px-5 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]">
            <h2 className="flex min-w-0 items-center gap-2 text-base font-extrabold tracking-tight text-slate-950">{renderHeader()}</h2>
          </div>

          {successMessage ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div>
          ) : null}

          {pageError ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{pageError}</div> : null}

          {activeView === 'list' ? renderList() : null}
          {activeView === 'sale' ? renderSalePlaceholder() : null}
          {activeView === 'details' ? renderSessionDetails() : null}
          {activeView === 'history' ? renderHistory() : null}
        </div>
      </ResourcePageShell>

      <CreatePosLocationSheet
        open={isCreateSheetOpen}
        onOpenChange={setIsCreateSheetOpen}
        onSubmit={handleCreateConfig}
        isSubmitting={isSubmitting}
      />

      <OpenSessionSheet
        config={selectedConfig}
        open={isOpenSessionSheetOpen}
        onOpenChange={setIsOpenSessionSheetOpen}
        onSubmit={handleOpenSession}
        isSubmitting={isSubmitting}
      />

      <CloseSessionSheet
        session={selectedSession}
        open={isCloseSessionSheetOpen}
        onOpenChange={setIsCloseSessionSheetOpen}
        onSubmit={handleCloseSession}
        isSubmitting={isSubmitting}
      />
    </>
  );
}

function DetailCard({ label, value, icon: Icon }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="h-4 w-4 text-[#0f62fe]" />
        {label}
      </div>
      <div className="mt-2 text-lg font-extrabold text-slate-950">{value}</div>
    </div>
  );
}
