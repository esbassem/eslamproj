import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/core/ui/dropdown-menu';
import { useI18n } from '@/core/i18n/useI18n';

function TeamMemberStatusBadge({ isActive, t }) {
  return (
    <Badge variant={isActive ? 'success' : 'default'}>
      {isActive ? t('team.status.active') : t('team.status.inactive')}
    </Badge>
  );
}

export function TeamMembersTable({
  members,
  canCreateFinancialPartner = false,
  processingMemberId = null,
  onCreateFinancialPartner,
  onViewFinancialPartner,
}) {
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="hidden grid-cols-[1.3fr_1.1fr_0.8fr_0.8fr_1fr_52px] items-center gap-4 border-b border-border bg-slate-50/80 px-5 py-4 text-sm font-semibold text-slate-600 md:grid">
        <div>{t('team.table.name')}</div>
        <div>{t('team.table.email')}</div>
        <div>{t('team.table.role')}</div>
        <div>{t('team.table.status')}</div>
        <div>{t('team.table.financialProfile')}</div>
        <div className="text-left">{t('team.table.actions')}</div>
      </div>

      <div className="divide-y divide-border bg-white">
        {members.map((member) => (
          <div
            key={member.id}
            className="grid gap-3 px-5 py-4 md:grid-cols-[1.3fr_1.1fr_0.8fr_0.8fr_1fr_52px] md:items-center md:gap-4"
          >
            <div className="space-y-1">
              <div className="font-semibold text-slate-950">{member.fullName}</div>
              {member.phone ? <div className="ltr-content text-sm text-muted-foreground">{member.phone}</div> : null}
            </div>
            <div className="ltr-content text-sm text-slate-700">{member.email}</div>
            <div>
              <Badge variant="accent">{t(`team.roles.${member.role}`)}</Badge>
            </div>
            <div>
              <TeamMemberStatusBadge isActive={member.isActive} t={t} />
            </div>
            <div>
              <Badge variant={member.partnerId ? 'success' : 'warning'}>
                {member.partnerId ? t('team.financialProfile.linked') : t('team.financialProfile.unlinked')}
              </Badge>
            </div>
            <div className="flex justify-end md:justify-start">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {member.partnerId ? (
                    <DropdownMenuItem onSelect={() => onViewFinancialPartner?.(member)}>
                      {t('team.actions.viewFinancialProfile')}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      disabled={!canCreateFinancialPartner || processingMemberId === member.id}
                      onSelect={() => onCreateFinancialPartner?.(member)}
                    >
                      {processingMemberId === member.id
                        ? t('team.actions.creatingFinancialProfile')
                        : t('team.actions.createFinancialProfile')}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
