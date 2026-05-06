import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/core/ui/card';
import { useI18n } from '@/core/i18n/useI18n';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function InfoCard({ label, value }) {
  return (
    <div className="rounded-lg border border-border bg-slate-50/80 p-5">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-lg font-semibold text-slate-950">{value || '—'}</div>
    </div>
  );
}

export function CompanySettings() {
  const { t } = useI18n();
  const { tenant } = useWorkspace();

  return (
    <div className="space-y-6" dir="rtl">
      <Card className="bg-white/90">
        <CardContent className="grid gap-4 p-6 md:grid-cols-3">
          <InfoCard label={t('settings.workspaceName')} value={tenant?.name} />
          <InfoCard
            label={t('settings.businessType')}
            value={tenant?.businessType ? t(`common.businessTypes.${tenant.businessType}`) : '—'}
          />
          <InfoCard
            label={t('settings.defaultCurrency')}
            value={tenant?.currency ? t(`common.currencies.${tenant.currency}`) : '—'}
          />
        </CardContent>
      </Card>

      <Card className="bg-white/90">
        <CardHeader>
          <CardTitle>الإعدادات العامة</CardTitle>
          <CardDescription>هذا القسم مخصص لبيانات الشركة والإعدادات العامة على مستوى مساحة العمل.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-5 text-sm text-muted-foreground">
            مكان موحد لإعدادات الشركة العامة داخل `settings`.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
