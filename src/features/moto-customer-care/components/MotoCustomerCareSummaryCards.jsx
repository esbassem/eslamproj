import { Banknote, CircleAlert, ClipboardList, WalletCards } from 'lucide-react';

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString('ar-EG-u-nu-latn', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ج.م`;
}

const summaryItems = [
  {
    key: 'count',
    label: 'إجمالي العمليات',
    format: (value) => Number(value || 0).toLocaleString('ar-EG'),
    icon: ClipboardList,
    tone: 'bg-slate-950 text-white',
  },
  {
    key: 'openCount',
    label: 'عمليات تحتاج متابعة',
    format: (value) => Number(value || 0).toLocaleString('ar-EG'),
    icon: CircleAlert,
    tone: 'bg-amber-500 text-white',
  },
  {
    key: 'paidAmount',
    label: 'إجمالي المدفوع',
    format: formatMoney,
    icon: WalletCards,
    tone: 'bg-emerald-600 text-white',
  },
  {
    key: 'remainingAmount',
    label: 'إجمالي المتبقي',
    format: formatMoney,
    icon: Banknote,
    tone: 'bg-red-600 text-white',
  },
];

export function MotoCustomerCareSummaryCards({ summary }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {summaryItems.map((item) => {
        const Icon = item.icon;

        return (
          <section key={item.key} className="rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-500">{item.label}</p>
                <p className="mt-3 truncate text-2xl font-black text-slate-950" dir="ltr">
                  {item.format(summary?.[item.key])}
                </p>
              </div>
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.tone}`}>
                <Icon className="h-5 w-5" />
              </span>
            </div>
          </section>
        );
      })}
    </div>
  );
}
