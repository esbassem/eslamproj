import { ArrowLeft, Repeat2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const money = (value, currency) => `${Number(value || 0).toLocaleString('ar-EG', { maximumFractionDigits: 2 })} ${currency}`;
const STATUS = Object.freeze({
  replacement_draft: 'مسودة البديل',
  replacement_confirmed: 'تم تأكيد البديل',
  completed: 'مكتمل',
  return_completed_replacement_cancelled: 'اكتمل المرتجع وأُلغي البديل',
});

export function SaleExchangeSourceBanner({ source }) {
  if (!source?.originalSaleId) return null;
  return <aside className="rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-950"><div className="flex items-start gap-3"><Repeat2 className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="font-black">هذا البيع ناتج عن استبدال</p><p className="mt-1 text-sm">البيع الأصلي: {source.originalSaleNumber || 'بيع مؤكد'} · المرتجع: {source.returnNumber}</p><Link className="mt-2 inline-flex items-center gap-1 text-sm font-black underline" to={`/app/sales/${source.originalSaleId}`}>فتح البيع الأصلي<ArrowLeft className="h-4 w-4" /></Link></div></div></aside>;
}

export function SaleExchangesSection({ eligibility }) {
  if (!eligibility?.exchanges?.length) return null;
  return <section className="space-y-3" aria-labelledby="sale-exchanges-title"><div className="flex items-center gap-2"><Repeat2 className="h-5 w-5 text-violet-700" /><div><h2 id="sale-exchanges-title" className="text-lg font-black">الاستبدالات</h2><p className="text-sm text-slate-500">كل استبدال يحتفظ بمرتجعه وبيع البديل كوقائع مستقلة.</p></div></div><div className="space-y-3">{eligibility.exchanges.map((exchange) => <article key={exchange.id} className="rounded-2xl border border-violet-100 bg-white p-4"><header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black">{STATUS[exchange.status] || exchange.status}</h3><p className="mt-1 text-xs text-slate-500">{exchange.createdAt ? new Date(exchange.createdAt).toLocaleString('ar-EG') : '—'} · {exchange.reason}</p></div><span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-black text-violet-700">{exchange.returnNumber}</span></header><div className="mt-3 grid gap-2 text-sm sm:grid-cols-2"><p className="rounded-xl bg-orange-50 p-3">قيمة المرتجع: <strong>{money(exchange.returnAmount, eligibility.currencyCode)}</strong></p><p className="rounded-xl bg-violet-50 p-3">قيمة البيع البديل: <strong>{money(exchange.replacementTotal, eligibility.currencyCode)}</strong></p></div><div className="mt-3 space-y-1 text-sm text-slate-700">{exchange.returnedItems.map((item, index) => <p key={`${item.description}:${item.trackingNumber}:${index}`}>{item.description} — {item.quantity.toLocaleString('ar-EG', { maximumFractionDigits: 4 })}{item.chassisNumber ? ` · شاسيه ${item.chassisNumber}` : ''}{item.engineNumber ? ` · موتور ${item.engineNumber}` : ''}</p>)}</div><Link className="mt-3 inline-flex items-center gap-1 text-sm font-black text-violet-700 underline" to={`/app/sales/${exchange.replacementSaleId}`}>{exchange.replacementSaleNumber || 'فتح مسودة البيع البديل'}<ArrowLeft className="h-4 w-4" /></Link></article>)}</div></section>;
}
