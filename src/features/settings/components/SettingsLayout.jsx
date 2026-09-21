import { Settings } from 'lucide-react';
import { ResourcePageShell } from '@/core/ui/resource-page-shell';
import { SettingsSectionNav } from '@/features/settings/components/SettingsSectionNav';

export function SettingsLayout({
  title,
  description,
  navigationItems,
  activeMenuId,
  onMenuSelect,
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
          items={navigationItems}
          activeMenuId={activeMenuId}
          onMenuSelect={onMenuSelect}
        />
      }
    >
      {children}
    </ResourcePageShell>
  );
}
