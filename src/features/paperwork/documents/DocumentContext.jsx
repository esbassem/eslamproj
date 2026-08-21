import { Link } from 'react-router-dom';
import { paperworkReadService } from '@/features/paperwork/services/queries/paperworkRead.service';
import { usePaperworkQuery } from '@/features/paperwork/hooks/usePaperworkQuery';
import { PAPERWORK_ROUTES } from '@/features/paperwork/routes/paperworkRoutes';

export function DocumentContext({ tenantId, requestId }) {
  const query = usePaperworkQuery(() => paperworkReadService.getDocumentContext({ tenantId, requestId }), [tenantId, requestId]);
  if (!requestId) return <p className="text-sm text-slate-500">مستند مستقل غير مرتبط بطلب.</p>;
  if (query.loading) return <div className="h-16 animate-pulse rounded-xl bg-slate-100" />;
  if (query.error) return <button onClick={query.retry} className="text-sm font-black text-red-700">تعذر تحميل بيانات الربط — إعادة المحاولة</button>;
  return <div className="space-y-3 text-sm"><div className="flex justify-between"><span className="font-bold text-slate-500">الطلب المرتبط</span><Link to={PAPERWORK_ROUTES.requestDetails(requestId)} className="font-black text-blue-700">#{requestId.slice(0, 8).toUpperCase()}</Link></div><div className="flex justify-between"><span className="font-bold text-slate-500">مرجع البيع</span><strong>{query.data?.saleNumber || '—'}</strong></div></div>;
}
