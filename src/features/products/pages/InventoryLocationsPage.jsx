import { MapPin } from 'lucide-react';

export function InventoryLocationsPage() {
  return <Placeholder icon={MapPin} title="المواقع" description="لا يوجد حاليًا نموذج مواقع مستقل وآمن في قاعدة البيانات. تم تجهيز القسم لمرحلة إضافة المواقع دون افتراض بنية قد تتعارض مع حيازة القطع الحالية." />;
}

function Placeholder({ icon: Icon, title, description }) {
  return <div className="space-y-5" dir="rtl"><header><h1 className="text-2xl font-black text-slate-950">{title}</h1><p className="mt-1 text-sm font-semibold text-slate-500">إدارة مواقع وجود القطع الفعلية.</p></header><div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><Icon className="h-10 w-10 text-slate-300" /><h2 className="mt-4 text-lg font-black text-slate-900">القسم جاهز للمرحلة التالية</h2><p className="mt-2 max-w-xl text-sm font-semibold leading-7 text-slate-500">{description}</p></div></div>;
}
