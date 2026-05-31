const STATUS_META = {
  completed: { label: 'مكتملة', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  confirmed: { label: 'مؤكدة', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  pending: { label: 'قيد المتابعة', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  draft: { label: 'مسودة', className: 'border-slate-200 bg-slate-100 text-slate-600' },
  cancelled: { label: 'ملغاة', className: 'border-red-200 bg-red-50 text-red-700' },
};

export function getMotoCustomerCareStatusMeta(status) {
  return STATUS_META[status] ?? {
    label: status || 'غير معروف',
    className: 'border-slate-200 bg-slate-100 text-slate-600',
  };
}

export function MotoCustomerCareStatusBadge({ status }) {
  const meta = getMotoCustomerCareStatusMeta(status);

  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  );
}
