import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { buttonVariants } from '@/core/ui/button';
import { ROUTES } from '@/core/config/routes.config';
import { cn } from '@/core/utils/cn';
import { posService } from '@/features/pos/api/pos.api';
import { PosConfig } from '@/features/settings/sections/pos/PosConfig';
import { PosPaymentMethods } from '@/features/settings/sections/pos/PosPaymentMethods';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function PosSettings() {
  const { tenant } = useWorkspace();
  const [configs, setConfigs] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;

    if (!tenant?.id) {
      setConfigs([]);
      setPaymentMethods([]);
      setIsLoading(false);
      return undefined;
    }

    setIsLoading(true);
    setError('');

    Promise.all([posService.listConfigs(tenant.id), posService.listPaymentMethods({ tenantId: tenant.id })])
      .then(([nextConfigs, nextMethods]) => {
        if (!mounted) return;
        setConfigs(nextConfigs);
        setPaymentMethods(nextMethods);
      })
      .catch((loadError) => {
        if (!mounted) return;
        setError(loadError.message || 'تعذر تحميل إعدادات نقاط البيع.');
      })
      .finally(() => {
        if (mounted) {
          setIsLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [tenant?.id]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5" dir="rtl">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-950">نقاط البيع</h2>
            <p className="mt-2 text-sm text-muted-foreground">قسم مستقل لإعدادات POS، بعيد عن إعدادات الدفع المحاسبية.</p>
          </div>
          <Link to={ROUTES.adminPos} className={cn(buttonVariants({ variant: 'secondary' }))}>
            فتح إدارة نقاط البيع
          </Link>
        </div>
      </div>

      <PosConfig configs={configs} isLoading={isLoading} error={error} />
      <PosPaymentMethods methods={paymentMethods} isLoading={isLoading} error={error} />
    </div>
  );
}
