import { memo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { useAppContext } from '@/contexts/AppContext';
import { SidebarNav } from '@/features/workspace/components/SidebarNav';

const APP_DESCRIPTIONS = {
  inventory: 'إضافة، بيع، وحركات بسيطة',
  products: 'تعريفات المنتجات وربطها بالنظام',
  accounting: 'قيود، مدفوعات، وتقارير مالية',
  accountant_app: 'تحصيلات وتوريدات يومية',
  sales: 'فواتير، عقود، ومتابعة المبيعات',
  pos: 'بيع سريع وإدارة نقاط البيع',
};

function parseColorChannels(color) {
  const value = String(color || '').trim();
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) {
    return [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
  }

  const rgb = value.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  return rgb ? rgb.slice(1, 4).map((channel) => Math.min(255, Number(channel))) : null;
}

function getRelativeLuminance([red, green, blue]) {
  const channels = [red, green, blue].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function getAccessibleAccentTextColor(color) {
  const channels = parseColorChannels(color);
  if (!channels) return '#0f172a';

  const slate = [15, 23, 42];
  let resolved = channels;

  for (let slateMix = 0; slateMix <= 0.8; slateMix += 0.05) {
    resolved = channels.map((channel, index) => Math.round((channel * (1 - slateMix)) + (slate[index] * slateMix)));
    const contrastOnWhite = 1.05 / (getRelativeLuminance(resolved) + 0.05);
    if (contrastOnWhite >= 4.5) break;
  }

  return `rgb(${resolved.join(' ')})`;
}

function SidebarContent({ mobile = false }) {
  const { activeApp, activeMenus } = useAppContext();
  const rootMenu = activeMenus[0] ?? null;
  const title = rootMenu?.name || activeApp?.name || 'التطبيق';
  const description = APP_DESCRIPTIONS[activeApp?.code] || 'قوائم وإجراءات التطبيق';
  const sidebarBgColor = activeApp?.iconColor || 'rgb(2 27 76)';
  const accentTextColor = getAccessibleAccentTextColor(sidebarBgColor);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden border-l border-slate-200 bg-white px-0 pb-8 pt-16 text-slate-950 shadow-[-12px_0_30px_rgba(15,23,42,0.06)] sm:pt-20 lg:px-7 lg:pb-0 lg:pt-14 xl:px-8">
      <div className="relative flex h-full flex-col">
        {mobile ? (
          <Dialog.Close asChild>
            <button
              type="button"
              aria-label="إغلاق قائمة التطبيق"
              className="absolute right-4 top-[-3rem] z-10 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-[0_6px_18px_rgba(15,23,42,0.08)] transition duration-100 active:scale-95 focus:outline-none focus:ring-4 focus:ring-slate-200 sm:right-8 sm:top-[-3.5rem]"
            >
              <X className="h-5 w-5" />
            </button>
          </Dialog.Close>
        ) : (
          <Link
            to={ROUTES.dashboard}
            aria-label="العودة للوحة التحكم"
            className="absolute right-4 top-[-3rem] z-10 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border bg-white shadow-[0_6px_18px_rgba(15,23,42,0.08)] transition duration-100 hover:-translate-y-px active:scale-95 focus:outline-none focus:ring-4 sm:right-8 sm:top-[-3.5rem] lg:right-0 lg:top-[-2rem]"
            style={{
              color: 'rgb(51 65 85)',
              borderColor: 'rgb(226 232 240)',
              '--tw-ring-color': 'rgb(226 232 240)',
            }}
          >
            <ArrowRight className="h-5 w-5" />
          </Link>
        )}
        <div className="relative mx-4 mt-4 text-right sm:mx-10 lg:mx-0 lg:mt-4" dir="rtl">
          <div className="min-w-0">
            <p className="mb-2 text-[11px] font-black text-slate-500">مساحة التطبيق</p>
            <div className="min-w-0">
              <h1 className="max-w-md truncate text-2xl font-black leading-tight sm:text-3xl" style={{ color: accentTextColor }}>{title}</h1>
              <p className="mt-2 max-w-md truncate text-xs font-semibold leading-5 text-slate-500 sm:text-sm sm:leading-6">{description}</p>
            </div>
          </div>
        </div>
        <SidebarNav />
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
          <Dialog.Content className="fixed inset-y-0 right-0 z-50 h-[100dvh] w-[min(90vw,24rem)] outline-none lg:hidden">
            <SidebarContent mobile />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <aside className="hidden h-screen w-[28rem] self-stretch lg:block xl:w-[30rem]">
      <div className="fixed inset-y-0 right-0 z-20 h-screen w-[28rem] xl:w-[30rem]">
        <SidebarContent />
      </div>
    </aside>
  );
}

export const AppSidebar = memo(AppSidebarComponent);
