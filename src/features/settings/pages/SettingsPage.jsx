import { useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { useI18n } from '@/core/i18n/useI18n';
import { SettingsLayout } from '@/features/settings/components/SettingsLayout';
import { BranchesSettings } from '@/features/settings/sections/branches/BranchesSettings';
import { CompanySettings } from '@/features/settings/sections/general/CompanySettings';
import { AccessControlSettings } from '@/features/settings/sections/access-control';
import { PosSettings } from '@/features/settings/sections/pos/PosSettings';
import { FinancialSetup } from '@/features/settings/sections/financial/FinancialSetup';
import { MoneyDestinationsSettings } from '@/features/settings/sections/financial/MoneyDestinationsSettings';
import { PaymentMethodsSettings } from '@/features/settings/sections/financial/PaymentMethodsSettings';
import { TeamManagementPage } from '@/features/team/pages/TeamManagementPage';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { useAppContext } from '@/contexts/AppContext';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import {
  getSettingsMenuHref,
  getSettingsNavigationItems,
  getSettingsSectionKey,
  resolveActiveSettingsMenu,
} from '@/features/settings/settingsNavigation';

export function SettingsPage() {
  const { t } = useI18n();
  const { tenant, tenantUser } = useWorkspace();
  const { activeMenus } = useAppContext();
  const { can } = useAuthorization();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = tenantUser?.role === 'owner';
  const requestedTab = searchParams.get('tab');
  const navigationItems = getSettingsNavigationItems(activeMenus, { isOwner });
  const activeMenu = resolveActiveSettingsMenu(navigationItems, location);
  const activeChildMenu = navigationItems
    .flatMap((menu) => menu.children ?? [])
    .find((menu) => getSettingsMenuHref(menu).split('?')[0] === location.pathname);
  const activeSection = getSettingsSectionKey(activeMenu) ?? 'general';
  const showingMoneyDestinations = location.pathname === ROUTES.settingsMoneyDestinations;
  const showingPaymentMethods = location.pathname === ROUTES.settingsPaymentMethods;

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    let shouldReplace = false;
    const requestedSection = nextParams.get('section');

    if (location.pathname !== ROUTES.settings && (requestedSection || requestedTab)) {
      nextParams.delete('section');
      nextParams.delete('tab');
      shouldReplace = true;
    } else if (requestedSection && activeMenu?.code === 'settings.general' && requestedSection !== 'general') {
      nextParams.delete('section');
      shouldReplace = true;
    }

    if (requestedTab) {
      nextParams.delete('tab');
      shouldReplace = true;
    }

    if (shouldReplace) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeMenu?.code, location.pathname, requestedTab, searchParams, setSearchParams]);

  const handleMenuSelect = (menu) => {
    const href = getSettingsMenuHref(menu);
    if (href) navigate(href);
  };

  const pageTitle =
    activeSection === 'financial_setup'
      ? showingMoneyDestinations ? 'أماكن الأموال' : showingPaymentMethods ? 'طرق الدفع' : 'الإعداد المالي'
      : activeSection === 'branches'
        ? 'الفروع'
      : activeSection === 'pos'
        ? 'إعدادات نقاط البيع'
        : activeSection === 'team'
          ? 'المستخدمون والفريق'
          : activeSection === 'permissions'
            ? 'الأدوار والصلاحيات'
            : t('settings.title');
  const pageDescription =
    activeSection === 'financial_setup'
      ? showingMoneyDestinations ? 'إدارة أماكن الاحتفاظ بأموال النشاط وربطها المالي التلقائي.' : showingPaymentMethods ? 'حدد طرق الدفع التي يمكن استخدامها في العمليات المالية.' : 'تحقق من جاهزية الأساس المالي وما يحتاج إلى إعداد قبل بدء التشغيل.'
      : activeSection === 'branches'
        ? 'إدارة تعريف فروع الشركة الحالية دون ربطها بالمخزون.'
      : activeSection === 'pos'
        ? 'إعدادات نقاط البيع مستقلة عن بقية إعدادات النظام.'
        : activeSection === 'team'
          ? 'إدارة المستخدمين وأعضاء الفريق داخل تطبيق الإعدادات.'
          : activeSection === 'permissions'
            ? 'إدارة أدوار المستخدمين ونطاق العمل والإعدادات الافتراضية.'
            : t('settings.description');

  return (
    <SettingsLayout
      title={pageTitle}
      description={pageDescription}
      navigationItems={navigationItems}
      activeMenuId={activeChildMenu?.id ?? activeMenu?.id ?? null}
      onMenuSelect={handleMenuSelect}
    >
      {activeSection === 'financial_setup' && !showingMoneyDestinations && !showingPaymentMethods ? <FinancialSetup tenantId={tenant?.id ?? null} /> : null}
      {activeSection === 'financial_setup' && showingMoneyDestinations ? <MoneyDestinationsSettings tenantId={tenant?.id ?? null} canManage={can('financial.destination.manage')} /> : null}
      {activeSection === 'financial_setup' && showingPaymentMethods ? <PaymentMethodsSettings tenantId={tenant?.id ?? null} canManage={can('financial.payment_method.manage')} /> : null}
      {activeSection === 'branches' ? <BranchesSettings /> : null}
      {activeSection === 'pos' ? <PosSettings /> : null}
      {activeSection === 'team' ? <TeamManagementPage embedded /> : null}
      {activeSection === 'permissions' ? <AccessControlSettings /> : null}
      {activeSection === 'general' ? <CompanySettings /> : null}
    </SettingsLayout>
  );
}

