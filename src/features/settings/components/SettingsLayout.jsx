import { Settings } from 'lucide-react';
import { ResourcePageShell } from '@/core/ui/resource-page-shell';
import { SettingsSectionNav } from '@/features/settings/components/SettingsSectionNav';

export function SettingsLayout({
  title,
  description,
  activeSection,
  activeAccountingTab,
  onSectionChange,
  onAccountingTabChange,
  children,
}) {
  return (
    <ResourcePageShell
      title={title}
      description={description}
      icon={Settings}
      showSearch={false}
      showEmptyState={false}
      sidebarContent={
        <SettingsSectionNav
          activeSection={activeSection}
          activeAccountingTab={activeAccountingTab}
          onSectionChange={onSectionChange}
          onAccountingTabChange={onAccountingTabChange}
        />
      }
    >
      {children}
    </ResourcePageShell>
  );
}
