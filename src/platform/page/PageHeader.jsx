import { Link } from 'react-router-dom';

function PageBreadcrumbs({ items = [] }) {
  if (!items.length) return null;
  return (
    <nav aria-label="مسار التنقل" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 overflow-hidden text-xs font-bold text-slate-500">
        {items.map((breadcrumb, index) => {
          const current = index === items.length - 1;
          return <li key={`${breadcrumb.label}-${index}`} className="flex min-w-0 items-center gap-2">{index ? <span aria-hidden="true">/</span> : null}{breadcrumb.to && !current ? <Link to={breadcrumb.to} className="truncate hover:text-slate-950">{breadcrumb.label}</Link> : <span aria-current={current ? 'page' : undefined} className="truncate text-slate-800">{breadcrumb.label}</span>}</li>;
        })}
      </ol>
    </nav>
  );
}

export function PageHeader({ title, description, actions, breadcrumbs = [], contextualBack }) {
  return (
    <header className="border-b border-slate-200 pb-5">
      {contextualBack || breadcrumbs.length ? <div className="mb-4 flex min-w-0 items-center gap-2">{contextualBack}<PageBreadcrumbs items={breadcrumbs} /></div> : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {title ? <h1 className="text-2xl font-black tracking-tight text-slate-950">{title}</h1> : null}
          {description ? <p className="mt-2 max-w-3xl text-sm font-semibold leading-6 text-slate-500">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
