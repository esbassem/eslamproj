import { Outlet } from 'react-router-dom';
import { PlatformHomeLink } from '@/core/ui/platform-home-link';
import { ShowroomConfigProvider } from '@/features/showroom/context/ShowroomConfigContext';

export function ShowroomWorkspaceLayout() {
  return (
    <ShowroomConfigProvider>
      <div className="min-h-screen bg-[linear-gradient(160deg,#f8fbff_0%,#edf4fb_42%,#f7fafc_100%)] text-slate-950" dir="rtl">
        <PlatformHomeLink className="fixed right-4 top-4 z-[90] border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-200 sm:right-6 sm:top-6" />
        <Outlet />
      </div>
    </ShowroomConfigProvider>
  );
}
