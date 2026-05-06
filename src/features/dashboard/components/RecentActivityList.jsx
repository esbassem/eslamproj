import { useI18n } from '@/core/i18n/useI18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/core/ui/card';

export function RecentActivityList({ items }) {
  const { t } = useI18n();

  return (
    <Card className="bg-white/90">
      <CardHeader>
        <CardTitle>{t('dashboard.recentActivityTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-4 rounded-2xl border border-border bg-slate-50/70 p-4">
            <div className="space-y-1">
              <div className="font-medium text-slate-900">{item.title}</div>
              <div className="text-sm text-muted-foreground">{item.description}</div>
            </div>
            <div className="whitespace-nowrap text-xs font-medium text-slate-400">{item.time}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

