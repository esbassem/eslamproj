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
    children: children.map(getMenuNavigationItem).filter(Boolean),
  };
}

function normalizeActivePath(path = '') {
  const pathname = String(path).split('#')[0].split('?')[0].replace(/\/+$/, '');
  return pathname || '/';
}

function SidebarLink({ item, depth = 0, appColor }) {
  const { t } = useI18n();
  const location = useLocation();
  const Icon = item.icon;
  const label = item.title || (item.titleKey ? t(item.titleKey) : '');
  const isActive = normalizeActivePath(location.pathname) === normalizeActivePath(item.href);

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
        depth > 0 && 'py-2.5 text-sm',
        isActive && 'bg-white text-white',
        !isActive && 'bg-white/6 text-white/86 hover:bg-white/10',
      )}
      style={isActive ? { color: appColor } : {}}
      dir="rtl"
    >
      <span className="flex w-full items-center gap-3">
        <span
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-md',
            depth > 0 && 'h-7 w-7',
            isActive ? 'bg-white text-white' : 'bg-white/10 text-white',
          )}
          style={isActive ? { backgroundColor: appColor, color: 'white' } : {}}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span>{label}</span>
      </span>
    </NavLink>
  );
}

function SidebarMenuItems({ items, depth = 0, appColor }) {
  return (
    <div className={cn('space-y-1', depth > 0 && 'border-r border-white/10 pr-2')}>
      {items.map((item) => (
        <div key={item.id || item.href} className="space-y-1">
          <SidebarLink item={item} depth={depth} appColor={appColor} />
          {item.children.length ? <SidebarMenuItems items={item.children} depth={depth + 1} appColor={appColor} /> : null}
        </div>
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
