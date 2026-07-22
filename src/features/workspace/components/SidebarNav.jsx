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

function SidebarLink({ item, depth = 0, appColor, hasChildren = false, isExpanded = false, onToggle }) {
  const { t } = useI18n();
  const location = useLocation();
  const Icon = item.icon;
  const label = item.title || (item.titleKey ? t(item.titleKey) : '');
  const isActive = normalizeActivePath(location.pathname) === normalizeActivePath(item.href);
  const isDisabled = item.active === false;
  const content = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            depth > 0 && 'h-6 w-6 rounded-[5px]',
            isActive ? 'bg-white text-white' : 'bg-white/10 text-white',
            isDisabled && 'bg-white/6 text-white/55',
          )}
          style={isActive && !isDisabled ? { backgroundColor: appColor, color: 'white' } : {}}
        >
          <Icon className={cn('h-4 w-4', depth > 0 && 'h-3.5 w-3.5')} />
        </span>
        <span className="min-w-0 truncate">{label}</span>
      </span>
      {isDisabled ? (
        <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[0.68rem] font-black text-white/70">
          قريبًا
        </span>
      ) : null}
      {hasChildren && !isDisabled ? (
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 transition-transform duration-200', !isExpanded && '-rotate-90')}
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  if (isDisabled) {
    return (
      <div
        data-permission-key={item.permissionKey || undefined}
        className={cn(
          'flex w-full cursor-not-allowed items-center gap-3 rounded-lg bg-white/6 px-3 py-3 text-right text-sm font-bold text-white/60 opacity-55',
          depth > 0 && 'gap-2.5 rounded-md px-2.5 py-2 text-xs',
        )}
        aria-disabled="true"
        dir="rtl"
      >
        {content}
      </div>
    );
  }

  if (hasChildren) {
    return (
      <button
        type="button"
        data-permission-key={item.permissionKey || undefined}
        onClick={onToggle}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg bg-white/6 px-3 py-3 text-right text-sm font-bold text-white/86 transition hover:bg-white/10',
          depth > 0 && 'gap-2.5 rounded-md bg-white/[0.035] px-2.5 py-2 text-xs',
        )}
        aria-expanded={isExpanded}
        dir="rtl"
      >
        {content}
      </button>
    );
  }

  return (
    <NavLink
      to={item.href}
      end
      data-permission-key={item.permissionKey || undefined}
      onMouseEnter={() => preloadProtectedRoute(item.href)}
      onFocus={() => preloadProtectedRoute(item.href)}
      onTouchStart={() => preloadProtectedRoute(item.href)}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-right text-sm font-bold transition',
        depth > 0 && 'gap-2.5 rounded-md px-2.5 py-2 text-xs',
        isActive && 'bg-white text-white',
        !isActive && 'bg-white/6 text-white/86 hover:bg-white/10',
      )}
      style={isActive ? { color: appColor } : {}}
      dir="rtl"
    >
      {content}
    </NavLink>
  );
}

function SidebarMenuItem({ item, depth, appColor }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasChildren = item.children.length > 0;

  return (
    <div className="space-y-1">
      <SidebarLink
        item={item}
        depth={depth}
        appColor={appColor}
        hasChildren={hasChildren}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded((expanded) => !expanded)}
      />
      {hasChildren ? (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-300 ease-in-out',
            isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
          aria-hidden={!isExpanded}
          inert={!isExpanded}
        >
          <div className="min-h-0 overflow-hidden">
            <SidebarMenuItems items={item.children} depth={depth + 1} appColor={appColor} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SidebarMenuItems({ items, depth = 0, appColor }) {
  return (
    <div className={cn('space-y-1', depth > 0 && 'mr-4 border-r border-white/15 pr-3 pt-1')}>
      {items.map((item) => (
        <SidebarMenuItem key={item.id || item.href} item={item} depth={depth} appColor={appColor} />
      ))}
    </div>
  );
}

export function SidebarNav({ appColor = 'rgb(2 27 76)' }) {
  const { activeMenus, menusStatus } = useAppContext();
  const visibleMenus = activeMenus.length === 1 && activeMenus[0]?.children?.length ? activeMenus[0].children : activeMenus;
  const navigationItems = visibleMenus.map(getMenuNavigationItem).filter(Boolean);

  if (menusStatus === 'loading' || menusStatus === 'idle') {
    return (
      <nav className="space-y-2">
        <div className="rounded-lg bg-white/6 px-3 py-3 text-sm font-bold text-white/70">جاري تحميل القوائم...</div>
      </nav>
    );
  }

  if (menusStatus === 'error') {
    return (
      <nav className="space-y-2">
        <div className="rounded-lg bg-red-500/12 px-3 py-3 text-sm font-bold text-red-100">تعذر تحميل القوائم</div>
      </nav>
    );
  }

  if (!navigationItems.length) {
    return (
      <nav className="space-y-2">
        <div className="rounded-lg bg-white/6 px-3 py-3 text-sm font-bold text-white/70">لا توجد قوائم مثبتة</div>
      </nav>
    );
  }

  return (
    <nav className="mt-5 space-y-2">
      <SidebarMenuItems items={navigationItems} appColor={appColor} />
    </nav>
  );
}
