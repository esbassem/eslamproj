import { Outlet } from 'react-router-dom';

export function PublicLayout() {
  return (
    <div className="min-h-[100dvh] bg-transparent">
      <Outlet />
    </div>
  );
}

