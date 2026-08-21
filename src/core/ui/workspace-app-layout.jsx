import { ArrowRight } from 'lucide-react';
import { Outlet, useNavigate } from 'react-router-dom';

export function WorkspaceAppLayout() {
  const navigate = useNavigate();
  const handleBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/app'));

  return (
    <div className="relative h-screen overflow-hidden bg-[#f8fafc] text-slate-950" dir="rtl">
      <style>{`
        @keyframes workspaceAppFadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes workspaceAppContentIn { from { opacity: 0; } to { opacity: 1; } }
        .workspace-app-fade-up { animation: workspaceAppFadeUp 0.24s ease both; }
        .workspace-app-content-in { animation: workspaceAppContentIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) 0.04s both; }
        html.workspace-app-section-open .workspace-app-back-button,
        body.workspace-app-section-open .workspace-app-back-button,
        html.customer-care-section-open .workspace-app-back-button,
        body.customer-care-section-open .workspace-app-back-button { display: none !important; }
      `}</style>
      <button
        type="button"
        onClick={handleBack}
        className="workspace-app-back-button workspace-app-fade-up absolute right-4 top-4 z-[90] inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-blue-700 shadow-[0_6px_18px_rgba(15,23,42,0.10)] transition hover:border-blue-200 hover:bg-blue-50 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:right-8 sm:top-6"
        aria-label="رجوع"
      >
        <ArrowRight className="h-5 w-5" />
      </button>
      <div className="relative z-30 mx-auto flex h-full min-h-0 w-full flex-col">
        <main className="workspace-app-content-in flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
