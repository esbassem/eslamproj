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
      <div className="grid gap-4 md:grid-cols-3">
        <InfoCard label={t('settings.workspaceName')} value={tenant?.name} />
        <InfoCard
          label={t('settings.businessType')}
          value={tenant?.businessType ? t(`common.businessTypes.${tenant.businessType}`) : '—'}
        />
        <InfoCard
          label={t('settings.defaultCurrency')}
          value={tenant?.currency ? t(`common.currencies.${tenant.currency}`) : '—'}
        />
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">الإعدادات العامة</h2>
          <p className="mt-1 text-sm text-muted-foreground">هذا القسم مخصص لبيانات الشركة والإعدادات العامة على مستوى مساحة العمل.</p>
        </div>
        <div className="rounded-lg border border-dashed border-border bg-slate-50 px-4 py-5 text-sm text-muted-foreground">
          مكان موحد لإعدادات الشركة العامة داخل `settings`.
        </div>
      </section>
    </div>
  );
}
