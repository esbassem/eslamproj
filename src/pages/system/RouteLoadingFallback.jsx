import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { Logo } from '@/core/ui/logo';
import { useLocation } from 'react-router-dom';

function MotoCustomerCareLoadingFallback() {
  return (
    <div
      className="relative flex min-h-screen overflow-hidden bg-[#1f5f9f] text-white [background-image:radial-gradient(circle_at_34%_18%,rgba(147,197,253,0.42)_0%,rgba(37,99,235,0.18)_28%,transparent_48%),linear-gradient(135deg,#3d82ca_0%,#2669af_52%,#1d4f89_100%)]"
      dir="rtl"
    >
      <style>{`
        @keyframes customerCareBootFade {
          from { opacity: 0; transform: translateY(14px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .customer-care-boot-fade {
          animation: customerCareBootFade 0.28s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0 hidden sm:block">
        <span className="absolute left-[8%] top-[18%] h-7 w-7 rounded-md bg-white/20 shadow-[7px_34px_0_rgba(255,255,255,0.16),14px_68px_0_rgba(191,219,254,0.14)]" />
        <span className="absolute right-[9%] top-[28%] h-12 w-12 rounded-lg bg-white/16 shadow-[-34px_92px_0_rgba(255,255,255,0.14),28px_224px_0_rgba(191,219,254,0.12)]" />
        <span className="absolute bottom-[12%] left-[14%] h-5 w-5 rounded bg-white/18 shadow-[270px_-6px_0_rgba(255,255,255,0.16),288px_18px_0_rgba(191,219,254,0.14)]" />
        <span className="absolute left-[18%] top-[9%] h-24 w-24 rounded-[1.75rem] border border-white/20 bg-white/10 shadow-[0_22px_55px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-sm" />
        <span className="absolute right-[20%] bottom-[18%] h-20 w-20 rounded-[1.5rem] border border-white/20 bg-white/10 shadow-[0_20px_48px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-sm" />
      </div>
      <div className="customer-care-boot-fade relative z-10 mx-auto flex w-full max-w-md flex-col justify-center px-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-white/25 bg-white/15 shadow-[0_26px_70px_rgba(15,23,42,0.18)] backdrop-blur-md">
          <span className="h-6 w-6 animate-spin rounded-full border-4 border-white/25 border-t-white" />
        </div>
        <h1 className="mt-5 text-2xl font-black text-white">خدمات ما بعد البيع</h1>
        <p className="mt-2 text-sm font-bold text-blue-100/85">جاري تجهيز مساحة المتابعة والأوراق...</p>
        <div className="mx-auto mt-6 h-1.5 w-44 overflow-hidden rounded-full bg-white/18">
          <div className="h-full w-1/2 animate-pulse rounded-full bg-white/70" />
        </div>
      </div>
    </div>
  );
}

export function RouteLoadingFallback() {
  const location = useLocation();
  const pathname = location.pathname || '';

  if (pathname.includes('moto-customer-care') || pathname.includes('moto_customer_care')) {
    return <MotoCustomerCareLoadingFallback />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6">
      <Logo />
      <LoadingSpinner title="جاري تحميل التطبيق" className="min-h-0" />
    </div>
  );
}
