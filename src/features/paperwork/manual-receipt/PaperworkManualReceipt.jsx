import { lazy, Suspense, useEffect, useRef } from 'react';
import { FilePlus2 } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { PAPERWORK_PERMISSIONS } from '@/features/paperwork/authorization/paperworkPermissions';
import { usePaperworkTenant } from '@/features/paperwork/hooks/usePaperworkQuery';
import { clearManualReceiptDraft, hasManualReceiptDraft } from '@/features/paperwork/manual-receipt/manualReceiptDraft';
import { PAPERWORK_TASK_ROUTES } from '@/features/paperwork/routes/paperworkRoutes';

const ManualReceipt = lazy(() => import('./ManualReceiptFlow').then((module) => ({ default: module.ManualReceiptFlow })));

export function PaperworkManualReceipt({ showTrigger = false, onSaved }) {
  const tenantId = usePaperworkTenant();
  const { tenant_user: tenantUser } = useAuth();
  const { can } = useAuthorization();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const receiptOpen = params.get('flow') === 'manual-receipt';
  const previousReceiptOpen = useRef(receiptOpen);
  const draftIdentity = { tenantId, userId: tenantUser?.id };
  const canReceive = can(PAPERWORK_PERMISSIONS.RECEIVE);

  const navigateWithReceiptState = (nextOpen, { replace = false } = {}) => {
    const nextParams = new URLSearchParams(params);
    if (nextOpen) nextParams.set('flow', 'manual-receipt');
    else nextParams.delete('flow');
    const search = nextParams.toString();
    navigate(`${location.pathname}${search ? `?${search}` : ''}`, {
      replace,
      state: nextOpen ? location.state : null,
    });
  };

  const setReceiptOpen = (nextOpen) => {
    if (!nextOpen && hasManualReceiptDraft(draftIdentity)) {
      const discard = window.confirm('لديك بيانات غير محفوظة في استلام الورق. هل تريد إلغاء العملية وحذف المسودة؟');
      if (!discard) return;
      clearManualReceiptDraft(draftIdentity);
    }
    navigateWithReceiptState(nextOpen, { replace: !nextOpen });
  };

  useEffect(() => {
    const leftWithBrowserNavigation = previousReceiptOpen.current && !receiptOpen && hasManualReceiptDraft(draftIdentity);
    previousReceiptOpen.current = receiptOpen;
    if (!leftWithBrowserNavigation) return;
    const discard = window.confirm('لديك بيانات غير محفوظة في استلام الورق. هل تريد مغادرة العملية وحذف المسودة؟');
    if (discard) clearManualReceiptDraft(draftIdentity);
    else navigate(PAPERWORK_TASK_ROUTES.manualReceipt(), { replace: true });
  }, [receiptOpen, tenantId, tenantUser?.id]);

  if (!canReceive) return null;

  return (
    <>
      {showTrigger ? (
        <button type="button" onClick={() => setReceiptOpen(true)} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-black text-white hover:bg-blue-700">
          <FilePlus2 className="h-4 w-4" />استلام ورق جديد
        </button>
      ) : null}
      {receiptOpen ? (
        <Suspense fallback={null}>
          <ManualReceipt
            open
            onOpenChange={setReceiptOpen}
            tenantId={tenantId}
            userId={tenantUser?.id}
            restoredUnit={location.state?.paperworkTrackingUnit || null}
            onSaved={onSaved}
          />
        </Suspense>
      ) : null}
    </>
  );
}
