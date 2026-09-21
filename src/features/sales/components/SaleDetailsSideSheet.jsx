import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { PlatformSideSheet } from '@/platform';
import {
  clearSaleSideSheetState,
  getSaleSideSheetId,
  SALE_SIDE_SHEET_HISTORY_KEY,
  setSaleSideSheetParam,
} from '@/features/sales/routes/salesSideSheetNavigation';
import { createSaleDetailsSurfaceMetadata } from './saleDetailsSurfaceMetadata.js';

let saleDetailsModulePromise;

function loadSaleDetailsModule() {
  saleDetailsModulePromise ??= import('./SaleDetails').then((module) => ({ default: module.SaleDetails }));
  return saleDetailsModulePromise;
}

const LazySaleDetails = lazy(loadSaleDetailsModule);

function SaleDetailsModuleFallback() {
  return (
    <div role="status" aria-label="جاري تحميل تفاصيل البيع" className="space-y-3">
      <div className="h-4 w-32 rounded bg-slate-100" />
      <div className="h-20 rounded-xl bg-slate-100" />
      <div className="h-20 rounded-xl bg-slate-100" />
    </div>
  );
}

export function SaleDetailsSideSheet() {
  const location = useLocation();
  const navigate = useNavigate();
  const saleId = getSaleSideSheetId(location.search);
  const openedFromList = location.state?.[SALE_SIDE_SHEET_HISTORY_KEY] === true;
  const [mountedSaleId, setMountedSaleId] = useState('');
  const [resolvedHeader, setResolvedHeader] = useState(null);

  const handleDetailsStateChange = useCallback(({ status, sale, notice }) => {
    if (status === 'ready' && sale) {
      const historicalNotice = sale.isHistorical
        ? 'فاتورة تاريخية للعرض فقط — الإجراءات التشغيلية غير متاحة.'
        : '';
      setResolvedHeader({
        saleId,
        ...createSaleDetailsSurfaceMetadata(sale),
        notice: notice || historicalNotice,
        noticeTone: notice ? 'warning' : historicalNotice ? 'info' : '',
      });
      return;
    }

    if (status === 'error') {
      setResolvedHeader({
        saleId,
        title: 'فاتورة بيع',
        description: 'تعذر تحميل بيانات الفاتورة. يمكنك إعادة المحاولة من داخل النافذة.',
      });
    }
  }, [saleId]);

  useEffect(() => {
    if (!saleId) {
      setMountedSaleId('');
      return undefined;
    }

    // Start downloading immediately after the shell commits. Two animation
    // frames guarantee one paint opportunity before cached feature code mounts.
    void loadSaleDetailsModule();
    let contentFrameId;
    const shellFrameId = window.requestAnimationFrame(() => {
      contentFrameId = window.requestAnimationFrame(() => setMountedSaleId(saleId));
    });
    return () => {
      window.cancelAnimationFrame(shellFrameId);
      if (contentFrameId) window.cancelAnimationFrame(contentFrameId);
    };
  }, [saleId]);

  const close = useCallback(() => {
    if (openedFromList) {
      navigate(-1);
      return;
    }

    navigate({
      pathname: location.pathname,
      search: setSaleSideSheetParam(location.search, ''),
      hash: location.hash,
    }, {
      replace: true,
      state: clearSaleSideSheetState(location.state),
    });
  }, [location.hash, location.pathname, location.search, location.state, navigate, openedFromList]);

  const activeHeader = resolvedHeader?.saleId === saleId
    ? resolvedHeader
    : { title: 'فاتورة بيع', description: 'جاري تحميل بيانات الفاتورة.' };

  return (
    <PlatformSideSheet
      open={Boolean(saleId)}
      onOpenChange={(nextOpen) => { if (!nextOpen) close(); }}
      placement="end"
      size="xl"
      density="compact"
      title={activeHeader.title}
      description={activeHeader.description}
      headerNotice={activeHeader.notice ? (
        <span
          role="status"
          title={activeHeader.notice}
          className={`flex min-w-0 basis-72 items-center gap-1.5 overflow-hidden rounded-full px-2 py-0.5 text-[11px] font-bold leading-4 ${
            activeHeader.noticeTone === 'warning'
              ? 'bg-amber-50 text-amber-800'
              : 'bg-sky-50 text-sky-800'
          }`}
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-70" aria-hidden="true" />
          <span className="truncate">{activeHeader.notice}</span>
        </span>
      ) : null}
    >
      {saleId && mountedSaleId === saleId ? (
        <Suspense fallback={<SaleDetailsModuleFallback />}>
          <LazySaleDetails
            key={saleId}
            saleId={saleId}
            compact
            onDetailsStateChange={handleDetailsStateChange}
          />
        </Suspense>
      ) : <SaleDetailsModuleFallback />}
    </PlatformSideSheet>
  );
}
