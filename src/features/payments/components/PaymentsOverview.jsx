import { WalletCards } from 'lucide-react';
import { useI18n } from '@/core/i18n/useI18n';
import { ResourcePageShell } from '@/core/ui/resource-page-shell';

export function PaymentsOverview() {
  const { t } = useI18n();

  return (
    <ResourcePageShell
      title={t('resources.payments.title')}
      description={t('resources.payments.description')}
      primaryAction={t('resources.payments.primaryAction')}
      secondaryAction={t('resources.payments.secondaryAction')}
      searchPlaceholder={t('resources.payments.searchPlaceholder')}
      icon={WalletCards}
      emptyTitle={t('resources.payments.emptyTitle')}
      emptyDescription={t('resources.payments.emptyDescription')}
      emptyAction={t('resources.payments.emptyAction')}
    />
  );
}

