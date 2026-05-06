import { ReceiptText } from 'lucide-react';
import { useI18n } from '@/core/i18n/useI18n';
import { ResourcePageShell } from '@/core/ui/resource-page-shell';

export function InvoicesOverview() {
  const { t } = useI18n();

  return (
    <ResourcePageShell
      title={t('resources.invoices.title')}
      description={t('resources.invoices.description')}
      primaryAction={t('resources.invoices.primaryAction')}
      secondaryAction={t('resources.invoices.secondaryAction')}
      searchPlaceholder={t('resources.invoices.searchPlaceholder')}
      icon={ReceiptText}
      emptyTitle={t('resources.invoices.emptyTitle')}
      emptyDescription={t('resources.invoices.emptyDescription')}
      emptyAction={t('resources.invoices.emptyAction')}
    />
  );
}

