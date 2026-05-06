import { Button } from '@/core/ui/button';

function getTypeLabel(partner) {
  if (partner.isCustomer && partner.isSupplier) return 'عميل ومورد';
  if (partner.isCustomer) return 'عميل';
  if (partner.isSupplier) return 'مورد';
  return 'غير محدد';
}

function formatMoney(value) {
  return `${Number(value ?? 0).toLocaleString()} EGP`;
}

export function PartnerCard({ partner, onEdit, onArchive }) {
  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{partner.name || 'بدون اسم'}</h3>
          <p className="text-sm text-slate-500">{partner.phone || 'لا يوجد هاتف'}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${partner.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}
        >
          {partner.isActive ? 'نشط' : 'مؤرشف'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <div className="text-slate-500">النوع</div>
          <div className="font-medium text-slate-800">{getTypeLabel(partner)}</div>
        </div>
        <div>
          <div className="text-slate-500">الرصيد</div>
          <div className="font-medium text-slate-800">{formatMoney(partner.balance)}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" className="h-8" onClick={() => onEdit(partner)}>
          تعديل
        </Button>
        {partner.isActive ? (
          <Button variant="ghost" className="h-8 text-red-600 hover:text-red-700" onClick={() => onArchive(partner)}>
            أرشفة
          </Button>
        ) : null}
      </div>
    </article>
  );
}
