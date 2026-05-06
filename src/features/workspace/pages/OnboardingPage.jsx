import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Building2, ChevronLeft } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/core/ui/card';
import { useI18n } from '@/core/i18n/useI18n';
import { Input } from '@/core/ui/input';
import { Label } from '@/core/ui/label';
import { businessTypes } from '@/core/config/app.config';
import { ROUTES } from '@/core/config/routes.config';
import { useWorkspace } from '@/features/workspace/hooks/useWorkspace';

function buildWorkspaceSlug(name) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/(^-|-$)/g, '');
}

export function OnboardingPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { saveWorkspace } = useWorkspace();
  const [formState, setFormState] = useState({
    name: '',
    businessType: 'distribution',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();

    try {
      setIsSubmitting(true);
      setSubmitError('');
      await saveWorkspace({
        name: formState.name,
        slug: buildWorkspaceSlug(formState.name),
      });
      navigate(ROUTES.dashboard);
    } catch (error) {
      setSubmitError(error.message || t('onboarding.messages.error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10 sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="w-full max-w-4xl"
      >
        <Card className="overflow-hidden border-white/70 bg-white/95">
          <div className="grid lg:grid-cols-[0.9fr_1.1fr]">
            <div className="border-b border-border bg-slate-100/80 p-8 lg:border-b-0 lg:border-l">
              <div className="space-y-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-primary text-primary-foreground">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="space-y-3">
                  <div className="text-sm font-semibold tracking-[0.12em] text-slate-400">{t('brand.name')}</div>
                  <h1 className="text-3xl font-semibold leading-tight text-slate-950">{t('onboarding.sideTitle')}</h1>
                  <p className="text-sm leading-7 text-muted-foreground">
                    {t('onboarding.sideDescription')}
                  </p>
                </div>
              </div>
            </div>

            <div className="p-8 sm:p-10">
              <CardHeader className="px-0 pt-0">
                <CardTitle>{t('onboarding.formTitle')}</CardTitle>
                <CardDescription>{t('onboarding.formDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                <form className="space-y-5" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label htmlFor="workspaceName">{t('common.labels.workspaceName')}</Label>
                    <Input
                      id="workspaceName"
                      placeholder={t('common.placeholders.workspaceName')}
                      value={formState.name}
                      onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="businessType">{t('common.labels.businessType')}</Label>
                    <select
                      id="businessType"
                      value={formState.businessType}
                      onChange={(event) => setFormState((current) => ({ ...current, businessType: event.target.value }))}
                      className="h-11 w-full rounded-xl border border-border bg-white px-4 text-right text-sm outline-none focus:border-slate-300 focus:ring-4 focus:ring-slate-100"
                    >
                      {businessTypes.map((item) => (
                        <option key={item} value={item}>
                          {t(`common.businessTypes.${item}`)}
                        </option>
                      ))}
                    </select>
                  </div>

                  {submitError ? (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {submitError}
                    </div>
                  ) : null}

                  <Button className="w-full sm:w-auto" disabled={isSubmitting}>
                    {isSubmitting ? t('onboarding.submitting') : t('onboarding.submit')}
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </form>
              </CardContent>
            </div>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

