import { useEffect, useState } from 'react';
import { CheckCircle2, WalletCards } from 'lucide-react';
import { showroomService } from '@/features/showroom/services/showroom.service';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

export function useEmployeeCashDestination(enabled = true) {
  const { tenant } = useWorkspace();
  const [destination, setDestination] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !tenant?.id) return undefined;

    let mounted = true;
    setIsLoading(true);
    setError('');

    showroomService.ensureCurrentUserFinancialPartner({ tenantId: tenant.id })
      .then((nextDestination) => {
        if (mounted) setDestination(nextDestination);
      })
      .catch((nextError) => {
        if (!mounted) return;
        setDestination(null);
        setError(nextError.message || 'تعذر تحديد حساب تحصيل الموظف.');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [enabled, tenant?.id]);

  return { destination, isLoading, error };
}

export function EmployeeCashDestinationNotice({ destination, isLoading, error }) {
  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold text-slate-500">
        جارٍ تحديد حساب النقدية وملف الموظف...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-bold leading-6 text-red-700">
        {error}
      </div>
    );
  }

  if (!destination?.accountId) return null;

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <WalletCards className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black text-emerald-700">سيتم إيداع التحصيل في</p>
          <p className="mt-1 text-sm font-black text-slate-900">
            {destination.accountCode} — {destination.accountName}
          </p>
          <div className="mt-2 flex items-center gap-1.5 text-xs font-bold text-slate-700">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span>الموظف: {destination.employeeName || destination.partnerName}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
