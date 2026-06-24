import { Button } from '@/core/ui/button';

function getTypeLabel(partner) {
  if (partner.contactType === 'contact') return 'جهة تابعة';
  if (partner.isCompany) return partner.companyType || 'شركة';
  if (partner.isCustomer && partner.isSupplier) return 'عميل ومورد';
  if (partner.isCustomer) return 'عميل';
  if (partner.isSupplier) return 'مورد';
  return 'غير محدد';
}

function formatMoney(value) {
  return `${Number(value ?? 0).toLocaleString()} EGP`;
}

function canHaveChildContacts(partner) {
  return Boolean(partner?.isCompany || partner?.isSupplier || partner?.companyType);
}

function getDisplayName(partner) {
  if (partner.parentName) {
    return `${partner.name || 'بدون اسم'} — تابع لـ ${partner.parentName}`;
  }

  return partner.name || 'بدون اسم';
}

export function PartnerCard({
  partner,
  onEdit,
  onArchive,
  childContacts = [],
  onAddChild,
  onEditChild,
}) {
  return (
    <article className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-900">{getDisplayName(partner)}</h3>
          {partner.functionTitle ? <p className="text-xs font-semibold text-slate-500">{partner.functionTitle}</p> : null}
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

      {canHaveChildContacts(partner) ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-black text-slate-900">جهات الاتصال التابعة</h4>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-black text-slate-700"
              onClick={() => onAddChild?.(partner)}
            >
              إضافة
            </button>
          </div>
          {childContacts.length ? (
            <div className="mt-2 grid gap-2">
              {childContacts.map((contact) => (
                <div key={contact.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-slate-900">{contact.name || '-'}</p>
                      <p className="mt-0.5 text-xs font-semibold text-slate-500">
                        {[contact.functionTitle, contact.phone].filter(Boolean).join(' - ') || 'لا توجد بيانات إضافية'}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700"
                      onClick={() => onEditChild?.(contact, partner)}
                    >
                      تعديل
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-500">
              لا توجد جهات تابعة بعد.
            </p>
          )}
        </div>
      ) : null}
    </article>
  );
}
