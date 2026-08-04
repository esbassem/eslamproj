import { EmptyState } from '@/core/ui/empty-state';
import { CRM_SECTIONS } from '@/features/crm/constants/navigation';

export function CrmPlaceholderPage({ section }) {
  const page = CRM_SECTIONS[section] ?? CRM_SECTIONS.leads;
  return <section><div className="mb-6"><h2 className="text-2xl font-black sm:text-3xl">{page.title}</h2><p className="mt-2 text-sm leading-7 text-slate-600">{page.description}</p></div><EmptyState icon={page.icon} title="لا توجد بيانات بعد" description="هذا القسم جاهز لإضافة وظائفه في المرحلة التالية من تطوير التطبيق." /></section>;
}
