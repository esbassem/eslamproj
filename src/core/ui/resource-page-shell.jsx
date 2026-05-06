import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { SearchFilterBar } from '@/core/ui/search-filter-bar';
import { EmptyState } from '@/core/ui/empty-state';
import { Button } from '@/core/ui/button';
import { useI18n } from '@/core/i18n/useI18n';

export function ResourcePageShell({
  title,
  description,
  primaryAction,
  secondaryAction,
  searchPlaceholder,
  icon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  showSearch = true,
  showEmptyState = true,
  sidebarContent,
  onPrimaryAction,
  onSecondaryAction,
  children,
}) {
  const { t } = useI18n();
  const hasContent = showSearch || showEmptyState;
  const content = (
    <div className="space-y-5">
      {showSearch ? <SearchFilterBar searchPlaceholder={searchPlaceholder} /> : null}
      {showEmptyState ? (
        <EmptyState
          icon={icon}
          title={emptyTitle}
          description={emptyDescription}
          actionLabel={emptyAction}
          surface="plain"
        />
      ) : null}
    </div>
  );

  return (
    <div className="min-h-[calc(100vh-6.75rem)]">
      <section className="h-full min-h-[calc(100vh-6.75rem)] rounded-[1.5rem] border border-white/80 bg-white/78 p-5 shadow-[0_28px_70px_-58px_rgba(15,23,42,0.42)] backdrop-blur-xl">
        {children ?? (hasContent ? content : null)}
      </section>
    </div>
  );
}

