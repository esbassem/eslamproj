import { ContactRound } from 'lucide-react';
import { Outlet } from 'react-router-dom';
import { PlatformHomeLink } from '@/core/ui/platform-home-link';
import { CrmNavigation } from '@/features/crm/components/CrmNavigation';

export function CrmWorkspaceLayout() {
  return <div className="min-h-screen bg-slate-50 text-slate-950" dir="rtl"><header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-4 sm:px-6"><PlatformHomeLink className="border border-slate-200 text-slate-700 hover:bg-slate-50" /><span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white"><ContactRound className="h-6 w-6" /></span><div><p className="text-xs font-bold text-blue-700">العملاء المحتملون</p><h1 className="text-lg font-black sm:text-xl">متابعة العملاء المحتملين</h1></div></div></header><CrmNavigation /><main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8"><Outlet /></main></div>;
}
