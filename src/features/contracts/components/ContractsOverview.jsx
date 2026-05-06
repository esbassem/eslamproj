import { FileSignature } from 'lucide-react';
import { useI18n } from '@/core/i18n/useI18n';
import { ResourcePageShell } from '@/core/ui/resource-page-shell';

export function ContractsOverview() {
  const { t } = useI18n();

  return (
    <ResourcePageShell
      title={t('resources.contracts.title')}
      description={t('resources.contracts.description')}
      primaryAction={t('resources.contracts.primaryAction')}
      secondaryAction={t('resources.contracts.secondaryAction')}
      searchPlaceholder={t('resources.contracts.searchPlaceholder')}
      icon={FileSignature}
      emptyTitle={t('resources.contracts.emptyTitle')}
      emptyDescription={t('resources.contracts.emptyDescription')}
      emptyAction={t('resources.contracts.emptyAction')}
    />
  );
}

