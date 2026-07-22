import { Badge } from '@/core/ui/badge';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetDismissButton,
  SheetHeader,
  SheetTitle,
} from '@/core/ui/sheet';
import { useI18n } from '@/core/i18n/useI18n';

function DetailRow({ label, value, ltr = false }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={ltr ? 'ltr-content text-sm font-medium text-slate-900' : 'text-sm font-medium text-slate-900'}>
        {value || '-'}
      </span>
    </div>
  );
}

export function FinancialPartnerSheet({ open, onOpenChange, partner, isLoading, errorMessage }) {
  const { t } = useI18n();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-lg">
        <SheetDismissButton />
        <SheetHeader>
          <SheetTitle>{t('team.financialProfile.title')}</SheetTitle>
          <SheetDescription>{t('team.financialProfile.description')}</SheetDescription>
        </SheetHeader>

        <SheetBody>
          {isLoading ? <LoadingSpinner title={t('team.financialProfile.loading')} /> : null}

          {!isLoading && errorMessage ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : null}

          {!isLoading && !errorMessage && partner ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">{t('team.financialProfile.internalPartner')}</Badge>
                <Badge variant={partner.isActive ? 'accent' : 'default'}>
                  {partner.isActive ? t('team.status.active') : t('team.status.inactive')}
                </Badge>
              </div>

              <div className="rounded-2xl border border-border bg-white px-4">
                <DetailRow label={t('team.table.name')} value={partner.name} />
                <DetailRow label={t('team.form.phone')} value={partner.phone} ltr />
                <DetailRow label={t('team.table.email')} value={partner.email} ltr />
                <DetailRow label={t('team.financialProfile.partnerId')} value={partner.id} ltr />
              </div>
            </div>
          ) : null}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
