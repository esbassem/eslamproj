import { LoadingSpinner } from '@/core/ui/loading-spinner';

function MotoCustomerCareContentFallback() {
  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#1f5f9f] text-white [background-image:radial-gradient(circle_at_34%_18%,rgba(147,197,253,0.42)_0%,rgba(37,99,235,0.18)_28%,transparent_48%),linear-gradient(135deg,#3d82ca_0%,#2669af_52%,#1d4f89_100%)]"
      dir="rtl"
    >
      <style>{`
        @keyframes customerCareFallbackIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .customer-care-fallback-in {
          animation: customerCareFallbackIn 0.24s cubic-bezier(0.22, 1, 0.36, 1) both;
        }
      `}</style>
      <div className="pointer-events-none absolute inset-0 hidden sm:block">
        <span className="absolute left-[8%] top-[18%] h-7 w-7 rounded-md bg-white/20 shadow-[7px_34px_0_rgba(255,255,255,0.16),14px_68px_0_rgba(191,219,254,0.14)]" />
        <span className="absolute right-[9%] top-[28%] h-12 w-12 rounded-lg bg-white/16 shadow-[-34px_92px_0_rgba(255,255,255,0.14),28px_224px_0_rgba(191,219,254,0.12)]" />
        <span className="absolute left-[18%] top-[9%] h-24 w-24 rounded-[1.75rem] border border-white/20 bg-white/10 shadow-[0_22px_55px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.16)] backdrop-blur-sm" />
      </div>
      <div className="customer-care-fallback-in relative z-10 flex min-h-screen flex-col items-center justify-center px-6 text-center">
        <span className="h-12 w-12 animate-spin rounded-full border-4 border-white/25 border-t-white" />
        <h1 className="mt-5 text-xl font-black text-white">خدمات ما بعد البيع</h1>
        <p className="mt-2 text-sm font-bold text-blue-100/85">جاري فتح التطبيق...</p>
      </div>
    </div>
  );
}

export function AppContentFallback({ pathname = '' } = {}) {
  if (String(pathname).includes('moto-customer-care') || String(pathname).includes('moto_customer_care')) {
    return <MotoCustomerCareContentFallback />;
  }

  return <LoadingSpinner title="جاري تحميل الصفحة" className="min-h-[calc(100vh-4rem)]" />;
}
