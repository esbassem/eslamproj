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
      className="relative h-screen overflow-hidden bg-[#1f5f9f] text-white [background-image:radial-gradient(circle_at_34%_18%,rgba(147,197,253,0.42)_0%,rgba(37,99,235,0.18)_28%,transparent_48%),linear-gradient(135deg,#3d82ca_0%,#2669af_52%,#1d4f89_100%)]"
      dir="rtl"
    >
      <style>{`
        @keyframes customerCareFadeUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes customerCareAppContentIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .customer-care-fade-up { animation: customerCareFadeUp 0.24s ease both; }
        .customer-care-app-content-in { animation: customerCareAppContentIn 0.28s cubic-bezier(0.16, 1, 0.3, 1) 0.04s both; }
        @media (max-width: 1023px) {
          html.customer-care-section-open .customer-care-app-back-button,
          body.customer-care-section-open .customer-care-app-back-button {
            display: none !important;
          }
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0 hidden sm:block">
        <span className="absolute left-[8%] top-[18%] h-7 w-7 rounded-md bg-white/20 shadow-[7px_34px_0_rgba(255,255,255,0.16),14px_68px_0_rgba(191,219,254,0.14)]" />
        <span className="absolute right-[9%] top-[28%] h-12 w-12 rounded-lg bg-white/16 shadow-[-34px_92px_0_rgba(255,255,255,0.14),28px_224px_0_rgba(191,219,254,0.12)]" />
        <span className="absolute bottom-[12%] left-[14%] h-5 w-5 rounded bg-white/18 shadow-[270px_-6px_0_rgba(255,255,255,0.16),288px_18px_0_rgba(191,219,254,0.14)]" />
        <span className="absolute right-[17%] top-[11%] h-4 w-4 rounded bg-white/20 shadow-[28px_-18px_0_rgba(255,255,255,0.16)]" />
        <span className="absolute left-[18%] top-[9%] h-24 w-24 rounded-[1.75rem] border border-white/20 bg-white/10 shadow-[0_22px_55px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-sm" />
        <span className="absolute right-[20%] bottom-[18%] h-20 w-20 rounded-[1.5rem] border border-white/20 bg-white/10 shadow-[0_20px_48px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-sm" />
        <span className="absolute left-[7%] bottom-[28%] h-11 w-11 rounded-xl bg-sky-400/18 shadow-[24px_-82px_0_rgba(56,189,248,0.14),92px_120px_0_rgba(37,99,235,0.10)]" />
        <span className="absolute right-[7%] top-[47%] h-9 w-9 rounded-lg bg-blue-500/16 shadow-[-66px_-120px_0_rgba(59,130,246,0.12),-18px_156px_0_rgba(14,165,233,0.10)]" />
        <span className="absolute left-[32%] top-[24%] h-px w-44 rotate-12 bg-gradient-to-r from-transparent via-sky-400/45 to-transparent" />
        <span className="absolute right-[25%] top-[16%] h-px w-36 -rotate-12 bg-gradient-to-r from-transparent via-blue-400/40 to-transparent" />
        <span className="absolute bottom-[9%] right-[36%] h-px w-52 rotate-6 bg-gradient-to-r from-transparent via-sky-300/35 to-transparent" />
      </div>
      <button
        type="button"
        onClick={handleBack}
        className="customer-care-app-back-button customer-care-fade-up absolute right-4 top-4 z-[90] inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-white/75 bg-white/75 text-blue-700 shadow-[0_12px_30px_rgba(37,99,235,0.12)] backdrop-blur-md transition hover:bg-white focus:outline-none focus:ring-4 focus:ring-sky-100 sm:right-8 sm:top-6"
        aria-label="رجوع"
      >
        <ArrowRight className="h-5 w-5" />
      </button>
      <div className="relative z-30 mx-auto flex h-full min-h-0 w-full flex-col px-0 pb-0 pt-0">
        <main className="customer-care-app-content-in flex min-h-0 min-w-0 flex-1 flex-col pt-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
