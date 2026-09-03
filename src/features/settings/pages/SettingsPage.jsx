import { useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { useI18n } from '@/core/i18n/useI18n';
import { SettingsLayout } from '@/features/settings/components/SettingsLayout';
import { AccountingSettings } from '@/features/settings/sections/accounting/AccountingSettings';
import { BranchesSettings } from '@/features/settings/sections/branches/BranchesSettings';
import { CompanySettings } from '@/features/settings/sections/general/CompanySettings';
import { AccessControlSettings } from '@/features/settings/sections/access-control';
import { PosSettings } from '@/features/settings/sections/pos/PosSettings';
import { FinancialSetup } from '@/features/settings/sections/financial/FinancialSetup';
import { TeamManagementPage } from '@/features/team/pages/TeamManagementPage';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';
import { useAppContext } from '@/contexts/AppContext';
import {
  getSettingsMenuHref,
  getSettingsNavigationItems,
  getSettingsSectionKey,
  resolveActiveSettingsMenu,
} from '@/features/settings/settingsNavigation';

const validAccountingTabs = new Set(['methods', 'rules', 'journals', 'journal-methods']);

export function SettingsPage() {
  const { t } = useI18n();
  const { tenant, tenantUser } = useWorkspace();
  const { activeMenus } = useAppContext();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOwner = tenantUser?.role === 'owner';
  const requestedTab = searchParams.get('tab');
  const navigationItems = getSettingsNavigationItems(activeMenus, { isOwner });
  const activeMenu = resolveActiveSettingsMenu(navigationItems, location);
  const activeSection = getSettingsSectionKey(activeMenu) ?? 'general';
  const activeAccountingTab = validAccountingTabs.has(requestedTab) ? requestedTab : 'methods';

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    let shouldReplace = false;
    const requestedSection = nextParams.get('section');

    if (location.pathname !== ROUTES.settings && (requestedSection || requestedTab)) {
      nextParams.delete('section');
      nextParams.delete('tab');
      shouldReplace = true;
    } else if (requestedSection === 'payments') {
      nextParams.set('section', 'accounting');
      shouldReplace = true;
    } else if (requestedSection && activeMenu?.code === 'settings.general' && requestedSection !== 'general') {
      nextParams.delete('section');
      shouldReplace = true;
    }

    if (activeSection === 'accounting') {
      if (!requestedTab || !validAccountingTabs.has(requestedTab)) {
        nextParams.set('section', 'accounting');
        nextParams.set('tab', 'methods');
        shouldReplace = true;
      }
    } else if (requestedTab) {
      nextParams.delete('tab');
      shouldReplace = true;
    }

    if (shouldReplace) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [activeMenu?.code, activeSection, location.pathname, requestedTab, searchParams, setSearchParams]);

  const handleMenuSelect = (menu) => {
    const href = getSettingsMenuHref(menu);
    if (href) navigate(href);
  };

  const handleAccountingTabChange = (tab) => {
    if (!validAccountingTabs.has(tab)) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', 'accounting');
    nextParams.set('tab', tab);
    setSearchParams(nextParams);
  };

  const pageTitle =
    activeSection === 'financial_setup'
      ? 'الإعداد المالي'
      : activeSection === 'branches'
      ? 'الفروع'
      : activeSection === 'accounting'
        ? 'إعدادات المحاسبة'
        : activeSection === 'pos'
          ? 'إعدادات نقاط البيع'
          : activeSection === 'team'
            ? 'المستخدمون والفريق'
            : activeSection === 'permissions'
              ? 'الأدوار والصلاحيات'
              : t('settings.title');
  const pageDescription =
    activeSection === 'financial_setup'
      ? 'تحقق من جاهزية الأساس المالي وما يحتاج إلى إعداد قبل بدء التشغيل.'
      : activeSection === 'branches'
      ? 'إدارة تعريف فروع الشركة الحالية دون ربطها بالمخزون.'
      : activeSection === 'accounting'
        ? 'إعدادات الدفع المحاسبية داخل settings كمصدر واحد.'
        : activeSection === 'pos'
          ? 'إعدادات نقاط البيع منفصلة عن المحاسبة.'
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
      activeMenuId={activeMenu?.id ?? null}
      activeAccountingTab={activeAccountingTab}
      onMenuSelect={handleMenuSelect}
      onAccountingTabChange={handleAccountingTabChange}
    >
      {activeSection === 'financial_setup' ? <FinancialSetup tenantId={tenant?.id ?? null} /> : null}
      {activeSection === 'accounting' ? <AccountingSettings activeTab={activeAccountingTab} onTabChange={handleAccountingTabChange} /> : null}
      {activeSection === 'branches' ? <BranchesSettings /> : null}
      {activeSection === 'pos' ? <PosSettings /> : null}
      {activeSection === 'team' ? <TeamManagementPage embedded /> : null}
      {activeSection === 'permissions' ? <AccessControlSettings /> : null}
      {activeSection === 'general' ? <CompanySettings /> : null}
    </SettingsLayout>
  );
}

