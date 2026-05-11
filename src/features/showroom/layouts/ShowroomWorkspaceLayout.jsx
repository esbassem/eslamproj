import { Outlet } from 'react-router-dom';
import { ShowroomConfigProvider } from '@/features/showroom/context/ShowroomConfigContext';

export function ShowroomWorkspaceLayout() {
  return (
    <ShowroomConfigProvider>
      <div className="min-h-screen bg-[linear-gradient(160deg,#f8fbff_0%,#edf4fb_42%,#f7fafc_100%)] text-slate-950" dir="rtl">
        <Outlet />
      </div>
    </ShowroomConfigProvider>
  );
}
