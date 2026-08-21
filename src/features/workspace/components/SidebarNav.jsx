import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { preloadProtectedRoute } from '@/app/router/lazyRoutes';
import { useI18n } from '@/core/i18n/useI18n';
import { cn } from '@/core/utils/cn';
import { useAppContext } from '@/contexts/AppContext';
import { getFirstChildRoutePath, resolveModuleIcon } from '@/features/modules/modules.navigation';

function getMenuNavigationItem(menu) {
  const children = menu.children ?? [];
  const href = menu.href || menu.routePath || getFirstChildRoutePath(children);

  if (!href) {
    return null;
  }

  return {
    id: menu.id,
    title: menu.name,
    titleKey: menu.titleKey,
    href,
    icon: resolveModuleIcon(menu.icon),
    permissionKey: menu.permissionKey,
    sortOrder: menu.sortOrder,
    active: menu.active !== false,
    children: children.map(getMenuNavigationItem).filter(Boolean),
  };
}

function normalizeActivePath(path = '') {
  const pathname = String(path).split('#')[0].split('?')[0].replace(/\/+$/, '');
  return pathname || '/';
}

function SidebarLink({ item, activeHref, depth = 0, hasChildren = false, isExpanded = false, onToggle }) {
  const { t } = useI18n();
  const Icon = item.icon;
  const label = item.title || (item.titleKey ? t(item.titleKey) : '');
  const isActive = normalizeActivePath(item.href) === activeHref;
  const isDisabled = item.active === false;
  const description = hasChildren ? `${item.children.length.toLocaleString('ar-EG')} ${item.children.length === 1 ? 'قسم فرعي' : 'أقسام فرعية'}` : depth > 0 ? 'فتح الصفحة' : 'قائمة وإجراءات التطبيق';
  const content = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition', depth > 0 && 'h-8 w-8', isActive ? 'border border-slate-200 bg-white text-slate-700' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200/70', isDisabled && 'bg-slate-100 text-slate-400 group-hover:bg-slate-100')}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-black">{label}</span>
          <span className="mt-0.5 block truncate text-[10px] font-bold text-slate-500">{description}</span>
        </span>
      </span>
      {isDisabled ? <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[0.68rem] font-black text-slate-500">قريبًا</span> : null}
      {hasChildren && !isDisabled ? <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform duration-200', !isExpanded && '-rotate-90')} aria-hidden="true" /> : null}
    </>
  );

  if (isDisabled) {
    return (
      <div data-permission-key={item.permissionKey || undefined} className={cn('group flex w-full cursor-not-allowed items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-right text-slate-500 opacity-55', depth > 0 && 'py-2')} aria-disabled="true" dir="rtl">
        {content}
      </div>
    );
  }

  if (hasChildren) {
    return (
      <button type="button" data-permission-key={item.permissionKey || undefined} onClick={onToggle} className={cn('group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right transition active:scale-[0.99]', depth > 0 && 'py-2', isActive ? 'border-slate-200 bg-slate-100 text-slate-950' : 'border-transparent bg-transparent text-slate-700 hover:bg-slate-100')} aria-expanded={isExpanded} dir="rtl">
        {content}
      </button>
    );
  }

  return (
    <NavLink to={item.href} end data-permission-key={item.permissionKey || undefined} onMouseEnter={() => preloadProtectedRoute(item.href)} onFocus={() => preloadProtectedRoute(item.href)} onTouchStart={() => preloadProtectedRoute(item.href)} className={cn('group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-right transition active:scale-[0.99]', depth > 0 && 'py-2', isActive && 'border-slate-200 bg-slate-100 text-slate-950', !isActive && 'border-transparent bg-transparent text-slate-700 hover:bg-slate-100')} dir="rtl">
      {content}
    </NavLink>
  );
}

function SidebarMenuItem({ item, activeHref, depth }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = item.children.length > 0;

  return (
    <div className="space-y-1">
      <SidebarLink item={item} activeHref={activeHref} depth={depth} hasChildren={hasChildren} isExpanded={isExpanded} onToggle={() => setIsExpanded((expanded) => !expanded)} />
      {hasChildren ? (
        <div className={cn('grid transition-[grid-template-rows,opacity] duration-300 ease-in-out', isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')} aria-hidden={!isExpanded} inert={!isExpanded}>
          <div className="min-h-0 overflow-hidden">
            <SidebarMenuItems items={item.children} activeHref={activeHref} depth={depth + 1} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SidebarMenuItems({ items, activeHref, depth = 0 }) {
  return (
    <div className={cn('grid gap-1', depth > 0 && 'mr-4 border-r border-slate-200 pr-3 pt-1')}>
      {items.map((item) => (
        <SidebarMenuItem key={item.id || item.href} item={item} activeHref={activeHref} depth={depth} />
      ))}
    </div>
  );
}

export function SidebarNav() {
  const { activeMenus, menusStatus } = useAppContext();
  const location = useLocation();
  const visibleMenus = activeMenus.length === 1 && activeMenus[0]?.children?.length ? activeMenus[0].children : activeMenus;
  const navigationItems = visibleMenus.map(getMenuNavigationItem).filter(Boolean);
  const currentPath = normalizeActivePath(location.pathname);
  const routeItems = [];
  const collectRouteItems = (items) =>
    items.forEach((item) => {
      routeItems.push(item);
      collectRouteItems(item.children);
    });
  collectRouteItems(navigationItems);
  const activeHref =
    routeItems
      .map((item) => normalizeActivePath(item.href))
      .filter((href) => currentPath === href || currentPath.startsWith(`${href}/`))
      .sort((left, right) => right.length - left.length)[0] || '';

  if (menusStatus === 'loading' || menusStatus === 'idle') {
    return (
      <nav className="mt-7 border-t border-slate-200 pt-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">جاري تحميل القوائم...</div>
      </nav>
    );
  }

  if (menusStatus === 'error') {
    return (
      <nav className="mt-7 border-t border-slate-200 pt-5">
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm font-bold text-red-700">تعذر تحميل القوائم</div>
      </nav>
    );
  }

  if (!navigationItems.length) {
    return (
      <nav className="mt-7 border-t border-slate-200 pt-5">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-bold text-slate-500">لا توجد قوائم مثبتة</div>
      </nav>
    );
  }

  return (
    <nav className="mt-7 min-h-0 flex-1 overflow-y-auto border-t border-slate-200 pt-5 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.45)_transparent]">
      <div className="mb-2 flex items-center gap-2 px-2 text-[10px] font-black tracking-wide text-slate-600">
        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" aria-hidden="true" />
        التنقل الرئيسي
      </div>
      <SidebarMenuItems items={navigationItems} activeHref={activeHref} />
    </nav>
  );
}
