import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Card, CardContent } from '@/core/ui/card';
import { CRM_NAV_ITEMS } from '@/features/crm/constants/navigation';

export function CrmHomePage() {
  return <section><div className="mb-7 max-w-3xl"><h2 className="text-2xl font-black sm:text-3xl">متابعة العملاء المحتملين</h2><p className="mt-2 text-sm leading-7 text-slate-600 sm:text-base">تسجيل العملاء المحتملين ومتابعتهم وربطهم بموظفي المبيعات وطلبات التقسيط.</p></div><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{CRM_NAV_ITEMS.slice(1).map(({ label, href, icon: Icon }) => <Link key={href} to={href} className="group"><Card className="h-full border-slate-200 bg-white"><CardContent className="flex h-full flex-col p-5"><span className="mb-5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Icon className="h-5 w-5" /></span><h3 className="font-black">{label}</h3><span className="mt-4 inline-flex items-center gap-1 text-sm font-bold text-blue-700">فتح القسم <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /></span></CardContent></Card></Link>)}</div></section>;
}
