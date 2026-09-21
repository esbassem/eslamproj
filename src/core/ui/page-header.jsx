import { Button } from '@/core/ui/button';
import { AppBreadcrumbs } from '@/core/ui/app-breadcrumbs';

export function PageHeader({ title, description, breadcrumbs, breadcrumbSize = 'default', contextualBack, primaryAction, secondaryAction, actions, titleRef, showDivider = true, showTitle = true }) {
  return (
    <header className={`flex flex-col gap-4 ${showTitle ? 'pb-6' : 'pb-2'} ${showDivider ? 'border-b border-border' : ''}`}>
      {contextualBack || breadcrumbs?.length ? (
        <div className="flex min-w-0 items-center gap-2">
          {contextualBack ? <div className="flex-none">{contextualBack}</div> : null}
          <AppBreadcrumbs items={breadcrumbs} className="flex-1" size={breadcrumbSize} />
        </div>
      ) : null}
      {showTitle || description || actions || primaryAction || secondaryAction ? (
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          {showTitle || description ? (
            <div className="space-y-2">
              {showTitle ? <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="min-w-0 truncate text-2xl font-black tracking-tight text-slate-950 outline-none">{title}</h1> : null}
              {description ? <p className="max-w-2xl text-sm font-semibold leading-6 text-muted-foreground">{description}</p> : null}
            </div>
          ) : null}
        {actions || primaryAction || secondaryAction ? (
          <div className="flex flex-wrap items-center gap-3">
            {secondaryAction ? <Button variant="secondary">{secondaryAction}</Button> : null}
            {primaryAction ? <Button>{primaryAction}</Button> : null}
            {actions}
          </div>
        ) : null}
        </div>
      ) : null}
    </header>
  );
}

