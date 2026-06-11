import { ArrowRight } from 'lucide-react';
import { Outlet, useNavigate } from 'react-router-dom';

export function MotoCustomerCareWorkspaceLayout() {
  const navigate = useNavigate();

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/app');
  };

  return (
    <div
      className="relative h-screen overflow-hidden bg-[#f4f7fb] px-4 pb-0 pt-5 text-slate-950 lg:bg-[#2669af] lg:[background-image:linear-gradient(135deg,#3d82ca_0%,#2669af_52%,#1d4f89_100%)] lg:pl-4 lg:pr-10"
      dir="rtl"
    >
      <style>{`
        @keyframes showroomBackdropIn {
          from { opacity: 0; transform: scale(1.025); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes customerCareAppHeaderIn {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes customerCareAppContentIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .showroom-backdrop-in { animation: showroomBackdropIn 0.32s ease-out both; }
        .customer-care-app-header-in { animation: customerCareAppHeaderIn 0.24s cubic-bezier(0.16, 1, 0.3, 1) both; }
        .customer-care-app-content-in { animation: customerCareAppContentIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) 0.04s both; }
      `}</style>
      <div className="pointer-events-none absolute inset-0 hidden opacity-55 [background-image:radial-gradient(rgba(255,255,255,0.28)_1px,transparent_1px)] [background-size:18px_18px] lg:block" />
      <div className="showroom-backdrop-in pointer-events-none absolute -right-24 top-20 hidden h-56 w-[42rem] -rotate-12 rounded-[32px] bg-white/12 lg:block" />
      <div className="showroom-backdrop-in pointer-events-none absolute -left-28 top-36 hidden h-44 w-[34rem] rotate-12 rounded-[32px] bg-[#bfdbfe]/18 lg:block" style={{ animationDelay: '0.03s' }} />
      <div className="showroom-backdrop-in pointer-events-none absolute bottom-[-4rem] right-12 hidden h-36 w-[34rem] -rotate-6 rounded-[28px] bg-white/10 lg:block" style={{ animationDelay: '0.06s' }} />
      <div className="showroom-backdrop-in pointer-events-none absolute left-4 top-10 hidden h-20 w-32 rounded-[20px] border border-white/24 bg-white/8 opacity-70 backdrop-blur-sm sm:left-10 sm:top-12 sm:h-28 sm:w-44 sm:rounded-[22px] md:opacity-100 lg:block" style={{ animationDelay: '0.08s' }} />
      <div className="pointer-events-none absolute left-8 top-16 hidden h-2 w-10 rounded-full bg-[#93c5fd]/80 sm:left-16 sm:top-20 sm:h-2.5 sm:w-12 sm:bg-[#93c5fd] lg:block" />
      <div className="pointer-events-none absolute left-8 top-28 hidden grid-cols-2 gap-2 opacity-70 sm:left-16 sm:top-32 sm:gap-3 md:opacity-100 lg:grid">
        <span className="h-9 w-12 rounded-xl border border-white/20 bg-white/8 sm:h-12 sm:w-16 sm:border-white/24 sm:bg-white/10" />
        <span className="h-9 w-12 rounded-xl border border-white/18 bg-white/7 sm:h-12 sm:w-16 sm:border-white/20 sm:bg-white/8" />
        <span className="h-9 w-12 rounded-xl border border-white/18 bg-white/7 sm:h-12 sm:w-16 sm:border-white/20 sm:bg-white/8" />
        <span className="h-9 w-12 rounded-xl border border-white/18 bg-white/7 sm:h-12 sm:w-16 sm:border-white/20 sm:bg-white/8" />
      </div>
      <div className="pointer-events-none absolute bottom-10 right-6 hidden h-px w-48 bg-white/35 sm:bottom-12 sm:right-10 sm:w-80 sm:bg-white/55 lg:block" />
      <div className="pointer-events-none absolute bottom-14 right-10 hidden h-px w-32 bg-[#bfdbfe]/45 sm:bottom-16 sm:right-16 sm:w-48 sm:bg-[#bfdbfe]/70 lg:block" />
      <div className="relative z-10 mx-auto flex h-full min-h-0 w-full max-w-none flex-col">
        <header className="customer-care-app-header-in mb-6 flex items-center justify-between gap-4 text-slate-950 lg:text-white">
          <div className="flex min-w-0 max-w-[430px] items-start gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="mt-1 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-200 lg:border-white/25 lg:bg-white/12 lg:text-white lg:shadow-none lg:hover:bg-white/20 lg:focus:ring-white/20"
              aria-label="رجوع"
            >
              <ArrowRight className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500 lg:text-blue-100/90">Customer Care</p>
              <h1 className="mt-2 text-3xl font-black text-slate-950 lg:text-white">خدمة عملاء الموتوسيكلات</h1>
              <p className="mt-2 max-w-[360px] text-sm font-bold leading-7 text-slate-600 lg:text-blue-50/95">
                متابعة العملاء بعد البيع وتجهيز إجراءات التواصل والتسليم والتحصيل من مكان واحد.
              </p>
            </div>
          </div>
        </header>
        <main className="customer-care-app-content-in flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
