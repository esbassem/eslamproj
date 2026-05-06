import { useLocation } from 'react-router-dom';
import { PageHeader } from '@/core/ui/page-header';
import { resolveMenuComponent } from '@/app/router/menuRouteResolver';

function MenuPageNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader title="Page Not Found" description="لا توجد صفحة مرتبطة بهذا المسار." />
    </div>
  );
}

export function DynamicAppPage() {
  const location = useLocation();
  const Component = resolveMenuComponent(location.pathname) ?? MenuPageNotFound;

  return <Component />;
}
