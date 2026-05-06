import { ArrowDownRight, ArrowUpRight, CreditCard, MoreHorizontal, Power } from 'lucide-react';
import { Badge } from '@/core/ui/badge';
import { Button } from '@/core/ui/button';
import { Card, CardContent } from '@/core/ui/card';

const typeLabels = {
  inbound: 'وارد',
  outbound: 'صادر',
};

export function PaymentMethodCard({ method, onEdit, onToggle, isSaving }) {
  const isActive = method.isActive ?? method.active ?? false;
  const paymentType = method.paymentType ?? method.payment_type ?? 'inbound';
  const TypeIcon = paymentType === 'outbound' ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="bg-white/95">
      <CardContent className="p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700">
              <CreditCard className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-950">{method.name}</h3>
                <Badge variant={isActive ? 'success' : 'warning'}>{isActive ? 'مفعلة' : 'معطلة'}</Badge>
                {method.isSystem ? <Badge variant="accent">نظامية</Badge> : null}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-sm text-muted-foreground">
                <span className="rounded-full bg-slate-100 px-3 py-1 font-medium text-slate-700" dir="ltr">
                  {method.code}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1">
                  <TypeIcon className="h-3.5 w-3.5" />
                  {typeLabels[paymentType] || paymentType}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 self-start">
            <Button type="button" variant="secondary" size="sm" onClick={() => onEdit?.(method)}>
              <MoreHorizontal className="h-4 w-4" />
              تعديل
            </Button>
            <Button type="button" variant="soft" size="sm" disabled={isSaving} onClick={() => onToggle?.(method, !isActive)}>
              <Power className="h-4 w-4" />
              {isActive ? 'تعطيل' : 'تفعيل'}
            </Button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <InfoItem label="النوع" value={typeLabels[paymentType] || paymentType} />
          <InfoItem label="الحالة" value={isActive ? 'جاهزة للربط المحاسبي' : 'متوقفة مؤقتًا'} />
          <InfoItem label="الطبيعة" value={method.isSystem ? 'طريقة نظامية' : 'طريقة عادية'} />
        </div>
        {method.notes ? <p className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">{method.notes}</p> : null}
      </CardContent>
    </Card>
  );
}

function InfoItem({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <span className="text-sm font-semibold text-slate-950">{value}</span>
    </div>
  );
}
