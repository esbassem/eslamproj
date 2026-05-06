import { Plus } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { useI18n } from '@/core/i18n/useI18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/core/ui/card';

export function QuickActions({ actions }) {
  const { t } = useI18n();

  return (
    <Card className="bg-white/90">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{t('dashboard.quickActionsTitle')}</CardTitle>
        <Button size="sm">{t('common.actions.newAction')}</Button>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        {actions.map((action) => (
          <button
            key={action.title}
            className="rounded-2xl border border-border bg-slate-50/80 p-5 text-right transition hover:border-slate-300 hover:bg-white"
          >
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-sm">
              <Plus className="h-4 w-4 text-slate-600" />
            </div>
            <div className="space-y-2">
              <div className="font-medium text-slate-900">{action.title}</div>
              <div className="text-sm leading-6 text-muted-foreground">{action.description}</div>
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

