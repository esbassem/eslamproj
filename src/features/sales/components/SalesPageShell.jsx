import { useEffect } from 'react';
import { PageHeader } from '@/core/ui/page-header';
import { useOptionalPlatformShell } from '@/platform';

export function SalesPageShell({ title, description, icon: Icon, currentLabel, actions, children }) {
  const platformShell = useOptionalPlatformShell();
  useEffect(() => {
    if (!currentLabel || !platformShell?.publishRouteContext) return undefined;
    platformShell.publishRouteContext({ currentLabel });
    return () => platformShell.publishRouteContext({});
  }, [currentLabel, platformShell?.publishRouteContext]);

  return (
    <section className="space-y-6" dir="rtl">
      <PageHeader title={title} description={description} actions={actions} />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-4">
          {Icon ? (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
              <Icon className="h-6 w-6" aria-hidden="true" />
            </span>
          ) : null}
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </section>
  );
}
