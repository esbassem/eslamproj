import { FileText } from 'lucide-react';
import { useParams } from 'react-router-dom';
import { SaleDetails } from '@/features/sales/components/SaleDetails';
import { SalesPageShell } from '@/features/sales/components/SalesPageShell';

export function SaleDetailsPage() {
  const { saleId = '' } = useParams();

  return (
    <SalesPageShell
      title="تفاصيل البيع"
      description="عرض تشغيلي موحد للبيانات التجارية والتسوية والتنفيذ."
      currentLabel="تفاصيل البيع"
      icon={FileText}
    >
      <SaleDetails saleId={saleId} />
    </SalesPageShell>
  );
}
