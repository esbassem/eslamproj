import { PaymentSettings } from '@/features/settings/sections/accounting/payment/PaymentSettings';

export function AccountingSettings({ activeTab, onTabChange }) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-5" dir="rtl">
        <h2 className="text-xl font-bold text-slate-950">المحاسبة</h2>
        <p className="mt-2 text-sm text-muted-foreground">كل إعدادات الدفع المحاسبية موجودة هنا، منفصلة عن إعدادات نقاط البيع.</p>
      </div>

      <PaymentSettings activeTab={activeTab} onActiveTabChange={onTabChange} showTabs={false} />
    </div>
  );
}
