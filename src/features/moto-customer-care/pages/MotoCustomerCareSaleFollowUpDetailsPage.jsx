import { Link, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { PageHeader } from '@/core/ui/page-header';
import { LoadingSpinner } from '@/core/ui/loading-spinner';
import { buttonVariants } from '@/core/ui/button';
import { MotoCustomerCareSaleDetailsCard } from '@/features/moto-customer-care/components/MotoCustomerCareSaleDetailsCard';
import { MOTO_CUSTOMER_CARE_ROUTES } from '@/features/moto-customer-care/routes/motoCustomerCareRoutes';
import { useMotoCustomerCareSaleDetails } from '@/features/moto-customer-care/hooks/useMotoCustomerCareSaleDetails';

export function MotoCustomerCareSaleFollowUpDetailsPage() {
  const { saleId } = useParams();
  const { sale, isLoading, error } = useMotoCustomerCareSaleDetails(saleId);

  if (isLoading) {
    return <LoadingSpinner title="جاري تحميل تفاصيل العملية" description="يتم تحميل بيانات البيع والعميل من Supabase." />;
  }

  return (
    <section className="space-y-6" dir="rtl">
      <PageHeader
        title={sale ? 'تفاصيل العملية' : 'تفاصيل عملية المتابعة'}
        description="عرض read only لبيانات عملية البيع وبيانات العميل المرتبطة بها."
        actions={(
          <Link to={MOTO_CUSTOMER_CARE_ROUTES.sales} className={buttonVariants({ variant: 'secondary' })}>
            <ArrowRight className="h-4 w-4" />
            العودة للقائمة
          </Link>
        )}
      />

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div>
      ) : null}

      {sale ? <MotoCustomerCareSaleDetailsCard sale={sale} /> : null}
    </section>
  );
}
