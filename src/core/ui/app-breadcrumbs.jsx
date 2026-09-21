import { Link } from 'react-router-dom';

export function AppBreadcrumbs({ items = [], className = '', size = 'default' }) {
  if (!items.length) return null;

  const sizeClasses = size === 'large'
    ? 'gap-3 text-lg font-black sm:text-xl'
    : 'gap-1.5 text-xs text-slate-500';

  return (
    <nav aria-label="مسار التنقل" className={`min-w-0 overflow-hidden ${className}`}>
      <ol className={`flex min-w-0 items-center overflow-hidden font-bold ${sizeClasses}`}>
        {items.map((item, index) => {
          const current = index === items.length - 1;
          const compactHidden = items.length > 2 && index < items.length - 2;
          return (
            <li
              key={`${item.label}-${index}`}
              className={`min-w-0 items-center gap-1.5 ${compactHidden ? 'hidden sm:flex' : 'flex'} ${size === 'large' && items.length > 1 && index === 0 ? 'text-base sm:text-lg' : ''}`}
            >
              {index ? <span aria-hidden="true" className={`${index === Math.max(0, items.length - 2) ? 'hidden sm:inline' : ''} text-slate-300`}>/</span> : null}
              {item.to && !current ? (
                <Link to={item.to} className={`max-w-44 truncate transition ${size === 'large' ? 'text-slate-500 hover:text-slate-800' : 'hover:text-blue-700'}`}>{item.label}</Link>
              ) : (
                <span aria-current={current ? 'page' : undefined} className={`max-w-52 truncate ${size === 'large' ? 'text-slate-950' : 'text-slate-700'}`}>{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
