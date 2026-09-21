import { PackageCheck } from 'lucide-react';
import { SaleStatusBadge } from '@/features/sales/components/SaleStatusBadge';

export function SaleFulfillmentSummary({ fulfillment, returnedQuantity = 0 }) {
  const returned = Number(returnedQuantity || 0);
  const withCustomer = Math.max(Number(fulfillment.deliveredQuantity || 0) - returned, 0);
  const cards = [
    ['المطلوب', fulfillment.requiredQuantity],
    ['المختار', fulfillment.selectedQuantity],
    ['محجوز حاليًا', fulfillment.reservedQuantity],
    ['تم تسليمه إجماليًا', fulfillment.deliveredQuantity],
    ['مع العميل', withCustomer],
  ];
  return <section className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><PackageCheck className="h-5 w-5 text-blue-600" /><h2 className="font-black">ملخص التنفيذ</h2></div><SaleStatusBadge status={fulfillment.status} /></div>{fulfillment.status === 'not_required' ? <p className="mt-4 text-sm text-slate-600">بنود البيع لا تتطلب تنفيذًا مخزنيًا.</p> : <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">{cards.map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-lg font-black">{Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 4 })}</p></div>)}</div>}{returned > 0 ? <p className="mt-3 text-xs font-bold text-orange-700">مرتجع إلى المخزون: {returned.toLocaleString('ar-EG', { maximumFractionDigits: 4 })} — الكمية «مع العميل» صافية بعد المرتجعات.</p> : null}{fulfillment.location ? <p className="mt-3 text-xs text-slate-500">موقع المخزون: {fulfillment.location.name}</p> : null}</section>;
}
