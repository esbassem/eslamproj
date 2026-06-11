import { Settings } from 'lucide-react';
import { ResourcePageShell } from '@/core/ui/resource-page-shell';
import { SettingsSectionNav } from '@/features/settings/components/SettingsSectionNav';

export function SettingsLayout({
  title,
  description,
  activeSection,
  activeAccountingTab,
  canManagePermissions,
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
          canManagePermissions={canManagePermissions}
          onSectionChange={onSectionChange}
          onAccountingTabChange={onAccountingTabChange}
        />
      }
    >
      {children}
    </ResourcePageShell>
  );
}
