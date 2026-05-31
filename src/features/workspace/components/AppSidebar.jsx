import { memo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { useAppContext } from '@/contexts/AppContext';
import { SidebarNav } from '@/features/workspace/components/SidebarNav';

const APP_DESCRIPTIONS = {
  inventory: 'إضافة، بيع، وحركات بسيطة',
  products: 'تعريفات المنتجات وربطها بالنظام',
  accounting: 'قيود، مدفوعات، وتقارير مالية',
  sales: 'فواتير، عقود، ومتابعة المبيعات',
  pos: 'بيع سريع وإدارة نقاط البيع',
};

function SidebarContent() {
  const { activeApp, activeMenus } = useAppContext();
  const rootMenu = activeMenus[0] ?? null;
  const title = rootMenu?.name || activeApp?.name || 'التطبيق';
  const description = APP_DESCRIPTIONS[activeApp?.code] || 'قوائم وإجراءات التطبيق';
  const sidebarBgColor = activeApp?.iconColor || 'rgb(2 27 76)';

  return (
    <div className="h-[calc(100vh-2rem)] w-[310px] rounded-xl border border-[rgba(255,255,255,0.08)] p-4 text-white shadow-[0_16px_36px_-28px_rgba(15,23,42,0.58)] relative" style={{ backgroundColor: sidebarBgColor }}>
      <div className="absolute inset-0 rounded-xl bg-black/25 pointer-events-none" />
      <div className="relative flex h-full flex-col">
        <div className="px-1 pt-1">
          <div className="flex items-center gap-3" dir="rtl">
            <Link
              to={ROUTES.dashboard}
              aria-label="العودة للوحة التحكم"
              className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-white/16 bg-white/8 text-white transition hover:bg-white hover:text-white"
              style={{ color: 'inherit' }}
            >
              <ChevronRight className="h-6 w-6" strokeWidth={2.6} />
            </Link>
            <div className="min-w-0">
              <h1 className="truncate text-3xl font-extrabold tracking-tight text-white">{title}</h1>
              <p className="mt-1 truncate text-sm font-semibold text-white/70">{description}</p>
            </div>
          </div>
        </div>
        <SidebarNav appColor={sidebarBgColor} />
      </div>
    </div>
  );
}

function AppSidebarComponent({ mobile = false, open = false, onOpenChange = () => {} }) {
  if (mobile) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden" />
          <Dialog.Content className="fixed right-4 top-4 z-50 h-[calc(100vh-2rem)] w-[88vw] max-w-sm outline-none lg:hidden">
            <SidebarContent />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <aside className="hidden w-[310px] self-start lg:block">
      <div className="fixed top-4 z-10">
        <SidebarContent />
      </div>
    </aside>
  );
}

export const AppSidebar = memo(AppSidebarComponent);
