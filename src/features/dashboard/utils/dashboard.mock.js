import { formatCurrency } from '@/core/i18n/formatters';

export function getDashboardStats(t) {
  const currencyLabel = t('common.currencies.EGP');

  return [
    {
      label: t('dashboard.stats.monthlyRevenue'),
      value: formatCurrency(48200, currencyLabel),
      change: t('dashboard.stats.revenueChange'),
      tone: 'success',
    },
    {
      label: t('dashboard.stats.openInvoices'),
      value: '128',
      change: t('dashboard.stats.openInvoicesChange'),
      tone: 'default',
    },
    {
      label: t('dashboard.stats.collectedPayments'),
      value: formatCurrency(36900, currencyLabel),
      change: t('dashboard.stats.collectedPaymentsChange'),
      tone: 'success',
    },
    {
      label: t('dashboard.stats.activeContracts'),
      value: '42',
      change: t('dashboard.stats.activeContractsChange'),
      tone: 'warning',
    },
  ];
}

export function getRecentActivity(t) {
  return [
    {
      id: 1,
      title: t('dashboard.recentActivity.invoiceCreatedTitle'),
      description: t('dashboard.recentActivity.invoiceCreatedDescription'),
      time: t('dashboard.recentActivity.time5m'),
    },
    {
      id: 2,
      title: t('dashboard.recentActivity.paymentReceivedTitle'),
      description: t('dashboard.recentActivity.paymentReceivedDescription'),
      time: t('dashboard.recentActivity.time18m'),
    },
    {
      id: 3,
      title: t('dashboard.recentActivity.partnerAddedTitle'),
      description: t('dashboard.recentActivity.partnerAddedDescription'),
      time: t('dashboard.recentActivity.time1h'),
    },
    {
      id: 4,
      title: t('dashboard.recentActivity.contractDueTitle'),
      description: t('dashboard.recentActivity.contractDueDescription'),
      time: t('dashboard.recentActivity.today'),
    },
  ];
}

export function getQuickActions(t) {
  return [
    {
      title: t('dashboard.quickActions.createInvoiceTitle'),
      description: t('dashboard.quickActions.createInvoiceDescription'),
    },
    {
      title: t('dashboard.quickActions.addProductTitle'),
      description: t('dashboard.quickActions.addProductDescription'),
    },
    {
      title: t('dashboard.quickActions.inviteTeammateTitle'),
      description: t('dashboard.quickActions.inviteTeammateDescription'),
    },
  ];
}

