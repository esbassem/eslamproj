const styles = {
  draft: 'bg-amber-50 text-amber-800 ring-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  cancelled: 'bg-red-50 text-red-800 ring-red-200',
  not_confirmed: 'bg-slate-100 text-slate-700 ring-slate-200',
  unpaid: 'bg-red-50 text-red-800 ring-red-200',
  partially_paid: 'bg-amber-50 text-amber-800 ring-amber-200',
  paid: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  unreserved: 'bg-slate-100 text-slate-700 ring-slate-200',
  reserved: 'bg-blue-50 text-blue-800 ring-blue-200',
  partially_delivered: 'bg-violet-50 text-violet-800 ring-violet-200',
  delivered: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  partially_returned: 'bg-orange-50 text-orange-800 ring-orange-200',
  fully_returned: 'bg-orange-100 text-orange-900 ring-orange-300',
  returned: 'bg-orange-100 text-orange-900 ring-orange-300',
  not_required: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export const SALE_STATUS_LABELS = Object.freeze({
  draft: 'مسودة', confirmed: 'مؤكد', cancelled: 'ملغاة',
  not_confirmed: 'لم يتم التأكيد', unpaid: 'غير مدفوع', partially_paid: 'مدفوع جزئيًا', paid: 'مدفوع بالكامل',
  unreserved: 'غير محجوز', reserved: 'محجوز', partially_delivered: 'تسليم جزئي', delivered: 'تم التسليم', not_required: 'لا يتطلب تسليم',
  partially_returned: 'مرتجع جزئيًا', fully_returned: 'مرتجع بالكامل', returned: 'مرتجع',
  unselected: 'لم تُحدد قطعة', selected: 'قطعة مختارة',
});

export function SaleStatusBadge({ status }) {
  return <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ring-1 ring-inset ${styles[status] || styles.unreserved}`}>{SALE_STATUS_LABELS[status] || status}</span>;
}
