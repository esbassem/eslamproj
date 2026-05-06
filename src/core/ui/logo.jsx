import { Hexagon } from 'lucide-react';
import { useI18n } from '@/core/i18n/useI18n';
import { cn } from '@/core/utils/cn';

export function Logo({ className, compact = false }) {
  const { t } = useI18n();

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
        <Hexagon className="h-5 w-5" />
      </div>
      {!compact ? (
        <div className="space-y-0.5">
          <div className="text-sm font-semibold tracking-wide text-slate-900">{t('brand.name')}</div>
          <div className="text-xs text-muted-foreground">{t('brand.tagline')}</div>
        </div>
      ) : null}
    </div>
  );
}

