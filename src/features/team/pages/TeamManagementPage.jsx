import { useCallback, useEffect, useMemo, useState } from 'react';
import { Users2 } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { EmptyState } from '@/core/ui/empty-state';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { ResourcePageShell } from '@/core/ui/resource-page-shell';
import { useI18n } from '@/core/i18n/useI18n';
import { teamService } from '@/features/team/api/team.api';
import { CreateTeamMemberSheet } from '@/features/team/components/CreateTeamMemberSheet';
import { FinancialPartnerSheet } from '@/features/team/components/FinancialPartnerSheet';
import { TeamMembersTable } from '@/features/team/components/TeamMembersTable';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function TeamManagementPage({ embedded = false }) {
  const { t } = useI18n();
  const { tenant, tenantUser } = useWorkspace();
  const [members, setMembers] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingMemberId, setProcessingMemberId] = useState(null);
  const [isBulkCreating, setIsBulkCreating] = useState(false);
  const [isFinancialPartnerOpen, setIsFinancialPartnerOpen] = useState(false);
  const [financialPartner, setFinancialPartner] = useState(null);
  const [isFinancialPartnerLoading, setIsFinancialPartnerLoading] = useState(false);
  const [financialPartnerError, setFinancialPartnerError] = useState('');

  const isOwner = tenantUser?.role === 'owner';
  const unlinkedMembersCount = useMemo(
    () => members.filter((member) => !member.partnerId).length,
    [members],
  );

  const loadMembers = useCallback(async () => {
    if (!tenant?.id) {
      setMembers([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setPageError('');

    try {
      setMembers(await teamService.listTeamMembers(tenant.id));
    } catch (error) {
      setPageError(error.message || t('team.messages.loadError'));
    } finally {
      setIsLoading(false);
    }
  }, [t, tenant?.id]);

  useEffect(() => {
    let mounted = true;

    if (!tenant?.id) {
      setMembers([]);
      setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);
    setPageError('');

    teamService
      .listTeamMembers(tenant.id)
      .then((nextMembers) => {
        if (!mounted) {
          return;
        }

        setMembers(nextMembers);
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }

        setPageError(error.message || t('team.messages.loadError'));
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [t, tenant?.id]);

  const handleCreateFinancialPartner = async (member) => {
    if (!member?.id || member.partnerId || !isOwner) return;

    try {
      setProcessingMemberId(member.id);
      setPageError('');
      setSuccessMessage('');
      const result = await teamService.createFinancialPartner(member.id);
      setMembers((current) => current.map((item) => (
        item.id === member.id ? { ...item, partnerId: result.partnerId } : item
      )));
      setSuccessMessage(t('team.messages.financialProfileCreateSuccess'));
    } catch (error) {
      setPageError(error.message || t('team.messages.financialProfileCreateError'));
    } finally {
      setProcessingMemberId(null);
    }
  };

  const handleBulkCreateFinancialPartners = async () => {
    if (!tenant?.id || !isOwner || !unlinkedMembersCount) return;

    try {
      setIsBulkCreating(true);
      setPageError('');
      setSuccessMessage('');
      const createdCount = await teamService.createFinancialPartnersForUnlinkedUsers(tenant.id);
      await loadMembers();
      setSuccessMessage(t('team.messages.financialProfilesBulkSuccess', { count: String(createdCount) }));
    } catch (error) {
      setPageError(error.message || t('team.messages.financialProfilesBulkError'));
    } finally {
      setIsBulkCreating(false);
    }
  };

  const handleViewFinancialPartner = async (member) => {
    if (!tenant?.id || !member?.partnerId) return;

    setIsFinancialPartnerOpen(true);
    setIsFinancialPartnerLoading(true);
    setFinancialPartner(null);
    setFinancialPartnerError('');

    try {
      const partner = await teamService.getFinancialPartner({
        tenantId: tenant.id,
        partnerId: member.partnerId,
      });
      if (!partner) throw new Error(t('team.messages.financialProfileNotFound'));
      setFinancialPartner(partner);
    } catch (error) {
      setFinancialPartnerError(error.message || t('team.messages.financialProfileLoadError'));
    } finally {
      setIsFinancialPartnerLoading(false);
    }
  };

  const handleCreateMember = async (payload) => {
    console.log('[Team] handleCreateMember called', {
      tenantId: tenant?.id,
      tenantUserRole: tenantUser?.role,
      payload: {
        fullName: payload.fullName,
        email: payload.email,
        role: payload.role,
        phone: payload.phone,
        passwordLength: payload.password?.length ?? 0,
      },
    });

    if (!tenant?.id) {
      console.log('[Team] handleCreateMember stopped: missing tenant.id');
      return { ok: false, error: t('team.messages.loadError') };
    }

    try {
      setIsSubmitting(true);
      setPageError('');
      setSuccessMessage('');
      console.log('[Team] calling teamService.createTeamMember');
      const createdMember = await teamService.createTeamMember({
        tenantId: tenant.id,
        ...payload,
      });

      console.log('[Team] teamService.createTeamMember success', createdMember);
      setMembers((current) => [createdMember, ...current]);
      setSuccessMessage(t('team.messages.createSuccess'));
      setIsSheetOpen(false);
      return { ok: true };
    } catch (error) {
      console.error('[Team] handleCreateMember failed', error);
      return { ok: false, error: error.message || t('team.messages.createError') };
    } finally {
      setIsSubmitting(false);
    }
  };

  const content = (
    <div className="space-y-6">
      {successMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</div>
      ) : null}

      {pageError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{pageError}</div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="text-lg font-semibold text-slate-950">{t('team.listTitle')}</div>
          <div className="text-sm text-muted-foreground">{t('team.listDescription')}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="accent">{t('team.membersCount', { count: String(members.length) })}</Badge>
          {embedded && isOwner ? (
            <Button type="button" size="sm" onClick={() => setIsSheetOpen(true)}>
              {t('team.actions.addEmployee')}
            </Button>
          ) : null}
          {isOwner ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!unlinkedMembersCount || isBulkCreating}
              onClick={handleBulkCreateFinancialPartners}
            >
              {isBulkCreating
                ? t('team.actions.bulkCreatingFinancialProfiles')
                : t('team.actions.bulkCreateFinancialProfiles')}
            </Button>
          ) : null}
        </div>
      </div>

      {!isOwner ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {t('team.messages.ownerOnly')}
        </div>
      ) : null}

      {isLoading ? (
        <LoadingSpinner title="جاري تحميل الفريق" />
      ) : members.length ? (
        <TeamMembersTable
          members={members}
          canCreateFinancialPartner={isOwner}
          processingMemberId={processingMemberId}
          onCreateFinancialPartner={handleCreateFinancialPartner}
          onViewFinancialPartner={handleViewFinancialPartner}
        />
      ) : (
        <EmptyState
          icon={Users2}
          title={t('team.emptyTitle')}
          description={t('team.emptyDescription')}
          actionLabel={t('team.actions.addEmployee')}
          onAction={() => setIsSheetOpen(true)}
          actionDisabled={!isOwner}
        />
      )}

      {isOwner ? (
        <CreateTeamMemberSheet
          open={isSheetOpen}
          onOpenChange={setIsSheetOpen}
          onSubmit={handleCreateMember}
          isSubmitting={isSubmitting}
        />
      ) : null}

      <FinancialPartnerSheet
        open={isFinancialPartnerOpen}
        onOpenChange={setIsFinancialPartnerOpen}
        partner={financialPartner}
        isLoading={isFinancialPartnerLoading}
        errorMessage={financialPartnerError}
      />
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <ResourcePageShell
      title={t('team.title')}
      description={t('team.description')}
      icon={Users2}
      showSearch={false}
      showEmptyState={false}
      primaryAction={isOwner ? t('team.actions.addEmployee') : null}
      onPrimaryAction={() => setIsSheetOpen(true)}
    >
      {content}
    </ResourcePageShell>
  );
}
