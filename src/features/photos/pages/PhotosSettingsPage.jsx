import { PhotosEmptyState } from '@/features/photos/components/PhotosEmptyState';

export function PhotosSettingsPage() {
  return (
    <section className="space-y-6 text-right" dir="rtl">
      <PhotosEmptyState
        tone="settings"
        title="إعدادات الصور"
        description="هذه صفحة placeholder فقط. القائمة غير مفعلة حاليًا في بيانات النظام، لذلك لا يتم الاعتماد عليها كمدخل ظاهر في الواجهة."
      />
    </section>
  );
}
