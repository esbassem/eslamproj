import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useI18n } from '@/core/i18n/useI18n';
import { SettingsLayout } from '@/features/settings/components/SettingsLayout';
import { AccountingSettings } from '@/features/settings/sections/accounting/AccountingSettings';
import { CompanySettings } from '@/features/settings/sections/general/CompanySettings';
import { PosSettings } from '@/features/settings/sections/pos/PosSettings';

const validSections = new Set(['general', 'accounting', 'pos', 'payments']);
const validAccountingTabs = new Set(['methods', 'rules', 'journals', 'journal-methods']);

export function SettingsPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSection = searchParams.get('section');
  const requestedTab = searchParams.get('tab');
  const normalizedRequestedSection = requestedSection === 'payments' ? 'accounting' : requestedSection;
  const activeSection = validSections.has(requestedSection) ? normalizedRequestedSection : 'general';
  const activeAccountingTab = validAccountingTabs.has(requestedTab) ? requestedTab : 'methods';

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams);
    let shouldReplace = false;

    if (requestedSection && !validSections.has(requestedSection)) {
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
  }, [activeSection, requestedSection, requestedTab, searchParams, setSearchParams]);

  const handleSectionChange = (section) => {
    if (!['general', 'accounting', 'pos'].includes(section)) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', section);

    if (section === 'accounting') {
      const nextTab = validAccountingTabs.has(searchParams.get('tab')) ? searchParams.get('tab') : 'methods';
      nextParams.set('tab', nextTab);
    } else {
      nextParams.delete('tab');
    }

    setSearchParams(nextParams);
  };

  const handleAccountingTabChange = (tab) => {
    if (!validAccountingTabs.has(tab)) return;

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('section', 'accounting');
    nextParams.set('tab', tab);
    setSearchParams(nextParams);
  };

  const pageTitle =
    activeSection === 'accounting' ? 'إعدادات المحاسبة' : activeSection === 'pos' ? 'إعدادات نقاط البيع' : t('settings.title');
  const pageDescription =
    activeSection === 'accounting'
      ? 'إعدادات الدفع المحاسبية داخل settings كمصدر واحد.'
      : activeSection === 'pos'
        ? 'إعدادات نقاط البيع منفصلة عن المحاسبة.'
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
      {activeSection === 'general' ? <CompanySettings /> : null}
    </SettingsLayout>
  );
}

