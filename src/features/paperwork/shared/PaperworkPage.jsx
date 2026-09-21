import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '@/core/ui/page-header';
import { getCanonicalBreadcrumbs } from '@/core/navigation/platformNavigation';

export function PaperworkPage({ title, description, actions, showHeaderDivider = true, showTitle = true, children }) {
  const location = useLocation();
  const titleRef = useRef(null);
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);
  const canonicalBreadcrumbs = getCanonicalBreadcrumbs(location.pathname, { currentLabel: title });
  const breadcrumbs = location.pathname === '/apps/paperwork'
    ? [{ label: title }]
    : canonicalBreadcrumbs[0]?.label === 'إدارة أوراق الملكية'
      ? canonicalBreadcrumbs.slice(1)
      : canonicalBreadcrumbs;
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1500px] flex-col pb-10 pt-10">
      <PageHeader breadcrumbs={breadcrumbs} breadcrumbSize="large" title={title} description={description} actions={actions} titleRef={titleRef} showDivider={showHeaderDivider} showTitle={showTitle} />
      <div className={showTitle ? 'mt-6' : 'mt-2'} />
      {children}
    </div>
  );
}
