import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, User, Package, CheckCircle } from 'lucide-react';
import { useShowroomConfig } from '@/features/showroom/context/ShowroomConfigContext';
import { showroomService } from '@/features/showroom/services/showroom.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG')} EGP`;
}

const statusConfig = {
  completed: { label: 'مكتملة', color: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  pending: { label: 'معلقة', color: 'bg-amber-50 border-amber-200 text-amber-800' },
  pending_payment: { label: 'بانتظار الدفع', color: 'bg-amber-50 border-amber-200 text-amber-800' },
  cancelled: { label: 'ملغاة', color: 'bg-red-50 border-red-200 text-red-800' },
  confirmed: { label: 'مؤكدة', color: 'bg-emerald-50 border-emerald-200 text-emerald-800' },
  draft: { label: 'مسودة', color: 'bg-slate-50 border-slate-200 text-slate-600' },
};

export function ShowroomSaleDetailsPage() {
  const { saleId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { tenant } = useWorkspace();
  const { currentShowroomConfigId } = useShowroomConfig();
  const [sale, setSale] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let storageSale = null;
    try {
      const raw = sessionStorage.getItem('showroom:selectedSale');
      storageSale = raw ? JSON.parse(raw) : null;
    } catch {
      storageSale = null;
    }

    const stateSale = location.state?.sale ?? storageSale ?? null;

    // Fast path: when opening from showroom list, state already has sale data.
    if (stateSale) {
      setSale(stateSale);
    }

    const fetchDetails = async () => {
      if (!tenant?.id || !saleId || !currentShowroomConfigId) {
        setIsLoading(false);
        if (!stateSale) {
          setError('لا توجد بيانات الفاتورة');
        }
        return;
      }

      try {
        const details = await showroomService.getSaleDetails({
          tenantId: tenant.id,
          saleId,
          showroomConfigId: currentShowroomConfigId,
        });
        setSale(details);
      } catch (err) {
        if (!stateSale) {
          setError(err.message || 'لم يتم العثور على الفاتورة');
        }
      } finally {
        setIsLoading(false);
      }
    };

    fetchDetails();

    return () => {
      try {
        sessionStorage.removeItem('showroom:selectedSale');
      } catch {
        // Ignore storage cleanup failures.
      }
    };
  }, [currentShowroomConfigId, location.state, saleId, tenant?.id]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-2xl">
          <div className="space-y-4">
            <div className="h-12 w-24 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-32 w-full animate-pulse rounded-xl bg-slate-200" />
            <div className="h-48 w-full animate-pulse rounded-xl bg-slate-200" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !sale) {
    return (
      <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
        <div className="mx-auto max-w-2xl">
          <button
            onClick={() => navigate(-1)}
            className="mb-6 flex items-center gap-2 text-slate-600 hover:text-slate-800"
          >
            <ArrowRight className="h-5 w-5" />
            <span>رجوع</span>
          </button>
          <div className="rounded-lg border border-red-200 bg-red-50 p-8 text-center">
            <p className="text-red-700 font-bold">{error || 'لم يتم العثور على الفاتورة'}</p>
            <button
              onClick={() => navigate(-1)}
              className="mt-4 text-sm font-bold text-red-600 underline"
            >
              العودة
            </button>
          </div>
        </div>
      </div>
    );
  }

  const saleNumber = sale?.sale_number || sale?.invoice_number || sale?.id?.slice(0, 8).toUpperCase();
  const totalAmount = Number(sale?.total_amount ?? sale?.totalAmount ?? 0);
  const paidAmount = Number(sale?.paid_amount ?? sale?.paidAmount ?? 0);
  const remainingAmount = Number(sale?.remaining_amount ?? Math.max(totalAmount - paidAmount, 0));
  const items = Array.isArray(sale?.items) ? sale.items : [];
  const status = sale?.status;
  const statusInfo = statusConfig[status] || { label: status || '—', color: 'bg-slate-50 border-slate-200 text-slate-600' };
  const isPaid = remainingAmount <= 0;

  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8" dir="rtl">
      <div className="mx-auto max-w-2xl">
        {/* Header */}
        <button
          onClick={() => navigate(-1)}
          className="mb-6 flex items-center gap-2 text-slate-600 transition hover:text-slate-800"
        >
          <ArrowRight className="h-5 w-5" />
          <span className="font-bold">رجوع</span>
        </button>

        <div className="rounded-2xl bg-white p-6 shadow-sm">
          {/* Title section */}
          <div className="mb-6 border-b border-slate-100 pb-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-slate-400">عملية رقم</p>
                <h1 className="text-3xl font-black text-slate-800">#{saleNumber}</h1>
              </div>
              <span className="text-sm font-bold text-slate-400">
                {new Intl.DateTimeFormat('ar-EG', { dateStyle: 'long', timeStyle: 'short' }).format(
                  new Date(sale?.created_at || Date.now()),
                )}
              </span>
            </div>

            {/* Customer section */}
            <div className="mt-6 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
                <User className="h-5 w-5 text-slate-400" />
              </div>
              <div>
                <p className="text-sm text-slate-500">العميل</p>
                <h2 className="text-lg font-black text-slate-800">
                  {sale?.customer?.name || 'عميل غير محدد'}
                </h2>
                {sale?.customer?.phone && (
                  <p className="text-sm text-slate-400">{sale.customer.phone}</p>
                )}
              </div>
            </div>
          </div>

          {/* Status badge */}
          <div className="mb-6">
            {isPaid ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                <CheckCircle className="h-5 w-5 text-emerald-700" />
                <span className="font-bold text-emerald-800">مسددة بالكامل</span>
              </div>
            ) : (
              <div className={`flex items-center justify-between rounded-lg border p-4 ${statusInfo.color}`}>
                <span className="font-bold">{statusInfo.label}</span>
                <span className="font-mono text-lg font-black">{formatMoney(totalAmount)}</span>
              </div>
            )}
          </div>

          {/* Products section */}
          {items.length > 0 && (
            <div className="mb-6">
              <div className="mb-4 flex items-center gap-2">
                <Package className="h-5 w-5 text-slate-400" />
                <h3 className="font-bold text-slate-700">المنتجات</h3>
              </div>
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                {items.map((item, index) => {
                  const itemName = item?.displayName || item?.name || `منتج ${index + 1}`;
                  const itemPrice = Number(item?.price ?? 0);
                  const itemQty = Number(item?.quantity ?? 1);
                  const itemTotal = itemPrice * itemQty;

                  return (
                    <div key={item?.lineId || item?.lineUuid || index} className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3 last:border-b-0 last:pb-0">
                      <div className="flex-1">
                        <p className="font-bold text-slate-800">{itemName}</p>
                        {itemQty > 1 && (
                          <p className="text-sm text-slate-500">
                            {itemQty} × {formatMoney(itemPrice)}
                          </p>
                        )}
                        {item?.serialNumber && (
                          <p className="text-sm text-slate-400">رقم تسلسلي: {item.serialNumber}</p>
                        )}
                      </div>
                      <p className="shrink-0 font-mono font-bold text-slate-800">{formatMoney(itemTotal)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Summary section */}
          <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-600">الإجمالي</span>
              <span className="font-mono text-lg font-black text-slate-800">{formatMoney(totalAmount)}</span>
            </div>
            {paidAmount > 0 && (
              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-sm font-bold text-emerald-700">المدفوع</span>
                <span className="font-mono text-lg font-black text-emerald-700">{formatMoney(paidAmount)}</span>
              </div>
            )}
            {remainingAmount > 0 && (
              <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                <span className="text-sm font-bold text-red-600">المتبقي</span>
                <span className="font-mono text-lg font-black text-red-700">{formatMoney(remainingAmount)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
