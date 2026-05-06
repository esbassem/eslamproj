import { Store } from 'lucide-react';
import { Badge } from '@/core/ui/badge';

export function PosConfig({ configs = [], isLoading = false, error = '' }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5" dir="rtl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">إعدادات نقاط البيع</h3>
          <p className="mt-1 text-sm text-muted-foreground">ملخص لتهيئة نقاط البيع الحالية داخل النظام.</p>
        </div>
        <Badge variant="accent">{configs.length}</Badge>
      </div>

      {error ? <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {isLoading ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">جار تحميل تهيئة نقاط البيع...</div>
      ) : null}

      {!isLoading && !configs.length ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          لا توجد نقاط بيع معرفة بعد.
        </div>
      ) : null}

      {!isLoading && configs.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {configs.map((config) => (
            <div key={config.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-emerald-50 p-2 text-emerald-700">
                    <Store className="h-4 w-4" />
                  </div>
                  <div className="font-semibold text-slate-950">{config.name}</div>
                </div>
                <Badge variant={config.isActive ? 'success' : 'warning'}>{config.isActive ? 'نشط' : 'غير نشط'}</Badge>
              </div>
              <div className="mt-3 text-xs text-slate-500" dir="ltr">{config.code || '—'}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
