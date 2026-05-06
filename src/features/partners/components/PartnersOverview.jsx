import { Users } from 'lucide-react';
import { useI18n } from '@/core/i18n/useI18n';
import { ResourcePageShell } from '@/core/ui/resource-page-shell';

export function PartnersOverview() {
  const { t } = useI18n();

  return (
    <ResourcePageShell
      title={t('resources.partners.title')}
      description={t('resources.partners.description')}
      primaryAction={t('resources.partners.primaryAction')}
      secondaryAction={t('resources.partners.secondaryAction')}
      searchPlaceholder={t('resources.partners.searchPlaceholder')}
      icon={Users}
      emptyTitle={t('resources.partners.emptyTitle')}
      emptyDescription={t('resources.partners.emptyDescription')}
      emptyAction={t('resources.partners.emptyAction')}
    />
  );
}

