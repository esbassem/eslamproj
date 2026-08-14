import { ClipboardCheck } from 'lucide-react';

export function InventoryCountsPage() {
  return <div className="space-y-5" dir="rtl"><header><h1 className="text-2xl font-black text-slate-950">الجرد</h1><p className="mt-1 text-sm font-semibold text-slate-500">مطابقة الموجود فعليًا مع الرصيد المسجل في النظام.</p></header><div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><ClipboardCheck className="h-10 w-10 text-slate-300" /><h2 className="mt-4 text-lg font-black text-slate-900">لا توجد دورة جرد مفعّلة حاليًا</h2><p className="mt-2 max-w-xl text-sm font-semibold leading-7 text-slate-500">لم يتم إنشاء جداول أو عمليات موازية. سيُبنى تدفق الجرد في مرحلة مستقلة بعد تحديد المواقع وسياسة التسويات والموافقات.</p></div></div>;
}
