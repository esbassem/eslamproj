import { Link } from 'react-router-dom';
import { Button } from '@/core/ui/button';
import { useI18n } from '@/core/i18n/useI18n';
import { Card, CardContent } from '@/core/ui/card';
import { ROUTES } from '@/core/config/routes.config';

export function NotFoundPage() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-xl bg-white/95">
        <CardContent className="space-y-6 p-10 text-center">
          <div className="space-y-3">
            <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400">404</div>
            <h1 className="text-3xl font-semibold text-slate-950">{t('system.notFoundTitle')}</h1>
            <p className="text-sm leading-7 text-muted-foreground">
              {t('system.notFoundDescription')}
            </p>
          </div>
          <Link to={ROUTES.landing}>
            <Button>{t('common.actions.backToHome')}</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

