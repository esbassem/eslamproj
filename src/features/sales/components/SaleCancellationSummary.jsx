import { Ban } from 'lucide-react';

const releaseLabels = { released: 'تم تحرير الحجز', not_required: 'لا يوجد حجز مطلوب' };

export function SaleCancellationSummary({ cancellation }) {
  if (!cancellation) return null;
  return <section className="rounded-2xl border border-red-200 bg-red-50/50 p-5"><div className="flex items-center gap-2 text-red-800"><Ban className="h-5 w-5" /><h2 className="font-black">بيانات إلغاء البيع</h2></div><dl className="mt-4 grid gap-3 sm:grid-cols-2"><div><dt className="text-xs font-bold text-slate-500">سبب الإلغاء</dt><dd className="mt-1 whitespace-pre-wrap font-bold text-slate-950">{cancellation.reason || 'غير محدد'}</dd></div><div><dt className="text-xs font-bold text-slate-500">تاريخ الإلغاء</dt><dd className="mt-1 font-bold text-slate-950">{cancellation.cancelledAt ? new Date(cancellation.cancelledAt).toLocaleString('ar-EG') : '—'}</dd></div><div><dt className="text-xs font-bold text-slate-500">نفذ الإلغاء</dt><dd className="mt-1 font-bold text-slate-950">{cancellation.cancelledByName || 'غير محدد'}</dd></div><div><dt className="text-xs font-bold text-slate-500">الأثر الناتج</dt><dd className="mt-1 font-bold text-slate-950">عكس مالي {cancellation.financialReversalReference ? `(${cancellation.financialReversalReference})` : ''} · {releaseLabels[cancellation.inventoryReleaseState] || 'تمت معالجة الحجز'}</dd></div></dl></section>;
}
