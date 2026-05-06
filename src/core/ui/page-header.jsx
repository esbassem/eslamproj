import { Button } from '@/core/ui/button';

export function PageHeader({ title, description, primaryAction, secondaryAction, actions }) {
  return (
    <div className="flex flex-col gap-5 border-b border-border pb-6 md:flex-row md:items-center md:justify-between">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {actions || primaryAction || secondaryAction ? (
        <div className="flex flex-wrap items-center gap-3">
          {secondaryAction ? <Button variant="secondary">{secondaryAction}</Button> : null}
          {primaryAction ? <Button>{primaryAction}</Button> : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

