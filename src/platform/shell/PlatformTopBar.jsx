import { ArrowLeft, ChevronLeft, LayoutGrid } from 'lucide-react';
import { Link } from 'react-router-dom';

function Breadcrumbs({ items = [] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="مسار التنقل" className="min-w-0 overflow-hidden">
      <ol className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm font-semibold text-slate-500 sm:gap-2">
        {items.map((breadcrumb, index) => {
          const current = index === items.length - 1;
          return (
            <li key={`${breadcrumb.label}-${index}`} className={`${current ? 'flex' : 'hidden sm:flex'} min-w-0 items-center gap-1.5 sm:gap-2`}>
              {index ? <span aria-hidden="true" className="text-slate-300">/</span> : null}
              {breadcrumb.to && !current ? (
                <Link to={breadcrumb.to} className="max-w-40 truncate rounded-sm transition-colors hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 lg:max-w-48">{breadcrumb.label}</Link>
              ) : (
                <span className="max-w-32 truncate text-slate-800 sm:max-w-48 lg:max-w-56" aria-current={current ? 'page' : undefined}>{breadcrumb.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PlatformTopBar({
  home = { label: 'مركز التطبيقات', to: '/app' },
  app,
  breadcrumbs = [],
  globalActions,
  accountArea,
  navigationTrigger,
  contextualBack,
  showDivider = true,
  showAppIdentity = true,
}) {
  const visibleBreadcrumbs = breadcrumbs.filter((breadcrumb, index) => (
    !(index === 0 && breadcrumb.to === home.to)
    && !(breadcrumb.label === app?.name && (breadcrumb.to === app?.href || breadcrumb.to === app?.to))
  ));
  return (
    <header className={`sticky top-0 z-30 w-full bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur ${showDivider ? 'border-b border-slate-200' : ''}`}>
      <div className="flex min-h-14 w-full items-center justify-between gap-2 px-3 sm:gap-4 sm:px-6 lg:px-8">
        <div data-topbar-region="context" className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          {navigationTrigger ? <div className="shrink-0 lg:hidden">{navigationTrigger}</div> : null}
          {contextualBack ? (
            <Link
              to={contextualBack.to}
              aria-label={contextualBack.label}
              title={contextualBack.label}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2"
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.75} aria-hidden="true" />
            </Link>
          ) : null}
          <Link
            to={home.to}
            aria-label={home.label}
            title={home.label}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2"
          >
            <LayoutGrid className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </Link>
          {app && showAppIdentity ? <span className="hidden shrink-0 border-s border-slate-200 ps-3 text-sm font-bold text-slate-700 sm:inline">{app.name}</span> : null}
          {app && showAppIdentity && visibleBreadcrumbs.length ? (
            <ChevronLeft className="hidden h-3.5 w-3.5 shrink-0 text-slate-300 sm:block" strokeWidth={1.5} aria-hidden="true" />
          ) : null}
          <Breadcrumbs items={visibleBreadcrumbs} />
        </div>
        {globalActions || accountArea ? (
          <div data-topbar-region="utilities" className="flex shrink-0 items-center gap-0.5">
            {globalActions}
            {accountArea}
          </div>
        ) : null}
      </div>
    </header>
  );
}
