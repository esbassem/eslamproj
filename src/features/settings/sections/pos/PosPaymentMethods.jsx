import { WalletCards } from 'lucide-react';
import { Badge } from '@/core/ui/badge';

export function PosPaymentMethods({ methods = [], isLoading = false, error = '' }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5" dir="rtl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">طرق دفع نقاط البيع</h3>
          <p className="mt-1 text-sm text-muted-foreground">هذه الطرق تخص POS فقط، وليست نفس طرق الدفع المحاسبية.</p>
        </div>
        <Badge variant="accent">{methods.length}</Badge>
      </div>

      {error ? <div className="mt-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      {isLoading ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-600">جار تحميل طرق دفع POS...</div>
      ) : null}

      {!isLoading && !methods.length ? (
        <div className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          لا توجد طرق دفع POS مفعلة حاليًا.
        </div>
      ) : null}

      {!isLoading && methods.length ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {methods.map((method) => (
            <div key={method.id} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="rounded-md bg-blue-50 p-2 text-blue-700">
                    <WalletCards className="h-4 w-4" />
                  </div>
                  <div className="font-semibold text-slate-950">{method.name}</div>
                </div>
                <Badge variant={method.isActive ? 'success' : 'warning'}>{method.isActive ? 'نشط' : 'غير نشط'}</Badge>
              </div>
              <div className="mt-3 text-xs text-slate-500" dir="ltr">{method.code || '—'}</div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
