import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ShowroomSalesCard } from '@/features/showroom/components/ShowroomSalesCard';
import { ShowroomInvoicesCard } from '@/features/showroom/components/ShowroomInvoicesCard';
import { ShowroomSaleViewSheet } from '@/features/showroom/components/ShowroomSaleViewSheet';
import { showroomService } from '@/features/showroom/services/showroom.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function ShowroomSellPage() {
  const navigate = useNavigate();
  const { tenant } = useWorkspace();
  const [sales, setSales] = useState([]);
  const [isSalesLoading, setIsSalesLoading] = useState(false);
  const [salesError, setSalesError] = useState('');
  const [selectedSale, setSelectedSale] = useState(null);

  const loadSales = useCallback(async () => {
    if (!tenant?.id) {
      setSales([]);
      setIsSalesLoading(false);
      return;
    }

    setIsSalesLoading(true);
    setSalesError('');

    try {
      const nextSales = await showroomService.getSales({ tenantId: tenant.id });
      setSales(nextSales);
    } catch (error) {
      setSales([]);
      setSalesError(error.message || 'تعذر تحميل عمليات البيع.');
    } finally {
      setIsSalesLoading(false);
    }
  }, [tenant?.id]);

  useEffect(() => {
    loadSales();
  }, [loadSales]);

  const salesStats = useMemo(() => {
    const total = sales.reduce((sum, sale) => sum + Number(sale.total_amount || sale.totalAmount || 0), 0);
    return {
      count: sales.length,
      total,
    };
  }, [sales]);

  const handleSaleCreated = async (sale) => {
    if (!tenant?.id) {
      return { ok: false, error: 'لا توجد شركة نشطة.' };
    }

    try {
      const savedSale = await showroomService.createSale({
        tenantId: tenant.id,
        customerId: sale.customer?.id || null,
        items: sale.items,
        totalAmount: sale.totalAmount,
        paidAmount: sale.paidAmount,
        paymentMethodId: sale.paymentMethodId,
        contractNote: sale.contractNote,
      });

      setSales((current) => [savedSale, ...current.filter((item) => item.id !== savedSale.id)]);
      return { ok: true, sale: savedSale };
    } catch (error) {
      return { ok: false, error: error.message || 'تعذر حفظ عملية البيع.' };
    }
  };

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-[#3f93d7] px-4 py-5 text-slate-950 [background-image:linear-gradient(135deg,#58aae8_0%,#3f93d7_46%,#2f78bd_100%)] sm:px-6 lg:px-10"
      dir="rtl"
    >
      <style>{`
        @keyframes showroomBackdropIn {
          from { opacity: 0; transform: scale(1.025); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes showroomHeaderIn {
          from { opacity: 0; transform: translateY(-14px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes showroomPanelIn {
          from { opacity: 0; transform: translateY(26px) scale(0.985); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .showroom-backdrop-in { animation: showroomBackdropIn 0.32s ease-out both; }
        .showroom-header-in { animation: showroomHeaderIn 0.28s cubic-bezier(0.22, 1, 0.36, 1) both; }
        .showroom-panel-in { animation: showroomPanelIn 0.34s cubic-bezier(0.22, 1, 0.36, 1) both; }
      `}</style>
      <div className="pointer-events-none absolute inset-0 opacity-55 [background-image:radial-gradient(rgba(255,255,255,0.28)_1px,transparent_1px)] [background-size:18px_18px]" />
      <div className="showroom-backdrop-in pointer-events-none absolute -right-24 top-20 h-56 w-[42rem] -rotate-12 rounded-[32px] bg-white/12" />
      <div className="showroom-backdrop-in pointer-events-none absolute -left-28 top-36 h-44 w-[34rem] rotate-12 rounded-[32px] bg-[#f06b63]/18" style={{ animationDelay: '0.03s' }} />
      <div className="showroom-backdrop-in pointer-events-none absolute bottom-[-4rem] right-12 h-36 w-[34rem] -rotate-6 rounded-[28px] bg-white/10" style={{ animationDelay: '0.06s' }} />
      <div className="showroom-backdrop-in pointer-events-none absolute left-10 top-12 hidden h-28 w-44 rounded-[22px] border border-white/30 bg-white/10 backdrop-blur-sm md:block" style={{ animationDelay: '0.08s' }} />
      <div className="pointer-events-none absolute left-16 top-20 hidden h-2.5 w-12 rounded-full bg-[#f06b63] md:block" />
      <div className="pointer-events-none absolute left-16 top-32 hidden grid-cols-2 gap-3 md:grid">
        <span className="h-12 w-16 rounded-xl border border-white/24 bg-white/10" />
        <span className="h-12 w-16 rounded-xl border border-white/20 bg-white/8" />
        <span className="h-12 w-16 rounded-xl border border-white/20 bg-white/8" />
        <span className="h-12 w-16 rounded-xl border border-white/20 bg-white/8" />
      </div>
      <div className="pointer-events-none absolute bottom-12 right-10 hidden h-px w-80 bg-white/55 md:block" />
      <div className="pointer-events-none absolute bottom-16 right-16 hidden h-px w-48 bg-[#f4d35e]/70 md:block" />
      <main className="relative z-10 mx-auto w-full max-w-[1280px]">
        <header className="showroom-header-in mb-5 flex items-center justify-between gap-4 text-white">
          <div className="flex min-w-0 items-center gap-3 text-right">
            <button
              type="button"
              aria-label="رجوع"
              onClick={() => navigate(-1)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/45 bg-white/12 text-white shadow-[0_16px_34px_-24px_rgba(21,66,116,0.9)] backdrop-blur transition hover:bg-white/20 focus:outline-none focus:ring-4 focus:ring-white/20"
            >
              <ArrowRight className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl font-black leading-tight sm:text-3xl">نقطة المعرض</h1>
              <p className="text-xs font-bold text-white/78 sm:text-sm">بيع سريع وفواتير واضحة</p>
            </div>
          </div>
        </header>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px] xl:gap-7">
          <div className="showroom-panel-in overflow-hidden rounded-[18px] border border-white/55 bg-[#edf5fc] shadow-[0_30px_60px_-34px_rgba(28,73,123,0.9)] xl:col-start-1">
            <ShowroomSalesCard onSaleCreated={handleSaleCreated} />
          </div>
          <div className="showroom-panel-in overflow-hidden rounded-[18px] border border-white/55 bg-[#edf5fc] shadow-[0_30px_60px_-34px_rgba(28,73,123,0.9)] xl:col-start-2" style={{ animationDelay: '0.04s' }}>
            <ShowroomInvoicesCard
              invoices={sales}
              stats={salesStats}
              isLoading={isSalesLoading}
              error={salesError}
              onInvoiceSelect={setSelectedSale}
            />
          </div>
        </div>
      </main>
      <ShowroomSaleViewSheet
        sale={selectedSale}
        isOpen={Boolean(selectedSale)}
        onClose={() => setSelectedSale(null)}
      />
    </div>
  );
}
