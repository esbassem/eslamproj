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

export function TeamMembersTable({ members }) {
  const { t } = useI18n();

  return (
    <div className="overflow-hidden rounded-2xl border border-border">
      <div className="hidden grid-cols-[1.4fr_1.2fr_0.9fr_0.8fr_52px] items-center gap-4 border-b border-border bg-slate-50/80 px-5 py-4 text-sm font-semibold text-slate-600 md:grid">
        <div>{t('team.table.name')}</div>
        <div>{t('team.table.email')}</div>
        <div>{t('team.table.role')}</div>
        <div>{t('team.table.status')}</div>
        <div className="text-left">{t('team.table.actions')}</div>
      </div>

      <div className="divide-y divide-border bg-white">
        {members.map((member) => (
          <div
            key={member.id}
            className="grid gap-3 px-5 py-4 md:grid-cols-[1.4fr_1.2fr_0.9fr_0.8fr_52px] md:items-center md:gap-4"
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
            <div className="flex justify-end md:justify-start">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="rounded-full">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem disabled>{t('team.actions.comingSoon')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
