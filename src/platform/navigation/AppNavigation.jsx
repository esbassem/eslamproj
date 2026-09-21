import { NavLink } from 'react-router-dom';
import { resolveActiveNavigationItem } from './navigationResolver.js';

function NavigationItems({ items, pathname, onNavigate }) {
  const activeItem = resolveActiveNavigationItem(items, pathname);
  return (
    <ul className="space-y-1">
      {items.map((navigationItem) => {
        const to = navigationItem.to ?? navigationItem.href;
        const Icon = typeof navigationItem.icon === 'function' ? navigationItem.icon : null;
        if (!to || navigationItem.visible === false || navigationItem.active === false) return null;
        return (
          <li key={navigationItem.id ?? to}>
            <NavLink
              to={to}
              end={navigationItem.end}
              onClick={onNavigate}
              className={`flex min-h-10 items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition ${activeItem === navigationItem ? 'bg-slate-100 text-slate-950' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'}`}
            >
              {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
              <span className="truncate">{navigationItem.label ?? navigationItem.name}</span>
            </NavLink>
            {navigationItem.children?.length ? (
              <div className="mr-4 border-r border-slate-200 pr-3 pt-1">
                <NavigationItems items={navigationItem.children} pathname={pathname} onNavigate={onNavigate} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function AppNavigation({ app, items = [], pathname = '/', onNavigate }) {
  return (
    <nav aria-label={app?.name ? `التنقل داخل ${app.name}` : 'التنقل داخل التطبيق'} dir="rtl">
      {app ? <div className="mb-5 border-b border-slate-200 pb-4"><p className="text-xs font-bold text-slate-500">مساحة التطبيق</p><h2 className="mt-1 text-lg font-black text-slate-950">{app.name}</h2></div> : null}
      <NavigationItems items={items} pathname={pathname} onNavigate={onNavigate} />
    </nav>
  );
}
