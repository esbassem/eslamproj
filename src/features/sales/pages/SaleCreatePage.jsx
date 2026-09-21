import { PlusCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { SaleDraftEditor } from '@/features/sales/create/SaleDraftEditor';
import { SalesPageShell } from '@/features/sales/components/SalesPageShell';
import { SALES_ROUTES } from '@/features/sales/routes/salesRoutes';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function SaleCreatePage() {
  const { tenant } = useWorkspace();
  const { can } = useAuthorization();
  const navigate = useNavigate();
  const canCreate = can('sales.create');
  return (
    <SalesPageShell
      title="بيع جديد"
      description="مساحة إنشاء مسودة بيع جديدة."
      icon={PlusCircle}
    >
      {canCreate ? (
        <SaleDraftEditor
          tenantId={tenant?.id}
          canBackdate={can('sales.backdate')}
          onSaved={({ saleId }) => navigate(SALES_ROUTES.details(saleId), { replace: true })}
        />
      ) : (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center font-bold text-red-900">
          ليس لديك صلاحية إنشاء مسودة بيع.
        </div>
      )}
    </SalesPageShell>
  );
}
