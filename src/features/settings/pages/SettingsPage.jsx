import { useEffect } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { useI18n } from '@/core/i18n/useI18n';
import { SettingsLayout } from '@/features/settings/components/SettingsLayout';
import { AccountingSettings } from '@/features/settings/sections/accounting/AccountingSettings';
import { CompanySettings } from '@/features/settings/sections/general/CompanySettings';
import { PosSettings } from '@/features/settings/sections/pos/PosSettings';
import { TeamManagementPage } from '@/features/team/pages/TeamManagementPage';

const validSections = new Set(['general', 'accounting', 'pos', 'payments', 'team']);
const validAccountingTabs = new Set(['methods', 'rules', 'journals', 'journal-methods']);

export function SettingsPage() {
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isTeamPath = location.pathname.replace(/\/+$/, '') === ROUTES.settingsTeam;
  const requestedSection = searchParams.get('section');
  const requestedTab = searchParams.get('tab');
  const normalizedRequestedSection = requestedSection === 'payments' ? 'accounting' : requestedSection;
  const activeSection = isTeamPath ? 'team' : validSections.has(requestedSection) ? normalizedRequestedSection : 'general';
  const activeAccountingTab = validAccountingTabs.has(requestedTab) ? requestedTab : 'methods';

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    let shouldReplace = false;

    if (isTeamPath && (requestedSection || requestedTab)) {
      nextParams.delete('section');
      nextParams.delete('tab');
      shouldReplace = true;
    } else if (requestedSection && !validSections.has(requestedSection)) {
      nextParams.set('section', 'general');
      nextParams.delete('tab');
      shouldReplace = true;
    }

    if (requestedSection === 'payments') {
      nextParams.set('section', 'accounting');
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
  }, [activeSection, isTeamPath, requestedSection, requestedTab, searchParams, setSearchParams]);

  const handleSectionChange = (section) => {
    if (!['general', 'accounting', 'pos', 'team'].includes(section)) return;

    if (section === 'team') {
      navigate(ROUTES.settingsTeam);
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', section);

    if (section === 'accounting') {
      const nextTab = validAccountingTabs.has(searchParams.get('tab')) ? searchParams.get('tab') : 'methods';
      nextParams.set('tab', nextTab);
    } else {
      nextParams.delete('tab');
    }

    if (isTeamPath) {
      navigate(`${ROUTES.settings}?${nextParams.toString()}`);
    } else {
      setSearchParams(nextParams);
    }
  };

  const handleAccountingTabChange = (tab) => {
    if (!validAccountingTabs.has(tab)) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', 'accounting');
    nextParams.set('tab', tab);
    setSearchParams(nextParams);
  };

  const pageTitle =
    activeSection === 'accounting'
      ? 'إعدادات المحاسبة'
      : activeSection === 'pos'
        ? 'إعدادات نقاط البيع'
        : activeSection === 'team'
          ? 'المستخدمون والفريق'
          : t('settings.title');
  const pageDescription =
    activeSection === 'accounting'
      ? 'إعدادات الدفع المحاسبية داخل settings كمصدر واحد.'
      : activeSection === 'pos'
        ? 'إعدادات نقاط البيع منفصلة عن المحاسبة.'
        : activeSection === 'team'
          ? 'إدارة المستخدمين وأعضاء الفريق داخل تطبيق الإعدادات.'
          : t('settings.description');

  return (
    <SettingsLayout
      title={pageTitle}
      description={pageDescription}
      activeSection={activeSection}
      activeAccountingTab={activeAccountingTab}
      onSectionChange={handleSectionChange}
      onAccountingTabChange={handleAccountingTabChange}
    >
      {activeSection === 'accounting' ? <AccountingSettings activeTab={activeAccountingTab} onTabChange={handleAccountingTabChange} /> : null}
      {activeSection === 'pos' ? <PosSettings /> : null}
      {activeSection === 'team' ? <TeamManagementPage embedded /> : null}
      {activeSection === 'general' ? <CompanySettings /> : null}
    </SettingsLayout>
  );
}

